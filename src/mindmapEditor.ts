import * as vscode from 'vscode';
import * as path from 'path';
import { minimalSplice } from './shared/diff';
import type { FromWebview, MindConfig, ToWebview } from './shared/protocol';
import { SpellService } from './spellService';

export const VIEW_TYPES = ['thinkmark.editor', 'thinkmark.editor.default'] as const;

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

/** Open mind map editors (exposed to the integration test through the extension's exports). */
export const liveSessions = new Set<EditorSession>();

export function readConfig(): MindConfig {
  const c = vscode.workspace.getConfiguration('thinkmark');
  return {
    defaultLayout: c.get('defaultLayout', 'map'),
    defaultTheme: c.get('defaultTheme', 'auto'),
    defaultLineStyle: c.get('defaultLineStyle', 'curve'),
    headingLevels: c.get('headingLevels', 2),
    syncSelection: c.get('syncSelection', true),
    topicMaxWidth: {
      central: c.get('topicMaxWidth.centralTopic', 26),
      main: c.get('topicMaxWidth.mainTopics', 32),
      sub: c.get('topicMaxWidth.subtopics', 44),
    },
    spellCheck: c.get('spellCheck.enabled', true),
  };
}

export class MindmapEditorProvider implements vscode.CustomTextEditorProvider {
  /** Document shown in the most recently focused mind map. */
  public activeDocument: vscode.TextDocument | undefined;
  readonly spell: SpellService;

  static register(context: vscode.ExtensionContext): { provider: MindmapEditorProvider; disposable: vscode.Disposable } {
    const provider = new MindmapEditorProvider(context);
    const disposable = vscode.Disposable.from(
      ...VIEW_TYPES.map(vt =>
        vscode.window.registerCustomEditorProvider(vt, provider, {
          webviewOptions: { retainContextWhenHidden: true },
          supportsMultipleEditorsPerDocument: true,
        }),
      ),
    );
    return { provider, disposable };
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    this.spell = new SpellService(vscode.Uri.joinPath(context.extensionUri, 'dist', 'dict'));
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const docDir = document.uri.scheme === 'untitled' ? undefined : vscode.Uri.joinPath(document.uri, '..');
    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media'), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri)];
    if (docDir) roots.push(docDir);
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    panel.webview.html = this.html(panel.webview);
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tab-icon.svg');
    new EditorSession(this, document, panel, docDir);
  }

  private html(webview: vscode.Webview): string {
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('webview.css')}">
<title>Mind Map</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body>
</html>`;
  }
}

class EditorSession {
  private readonly disposables: vscode.Disposable[] = [];
  private applying = 0;
  public queue: Promise<unknown> = Promise.resolve();
  /** Set once the webview script has started and asked for the document. */
  public webviewReady = false;

  constructor(
    private readonly provider: MindmapEditorProvider,
    readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly docDir: vscode.Uri | undefined,
  ) {
    const d = this.disposables;
    d.push(panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m)));
    d.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === document && e.contentChanges.length && !this.applying) this.post({ type: 'update', text: document.getText() });
      }),
    );
    d.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('thinkmark')) this.post({ type: 'config', config: readConfig() });
      }),
    );
    d.push(
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor.document !== document || e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
        if (!readConfig().syncSelection || !panel.visible) return;
        this.post({ type: 'selectLine', line: e.selections[0].active.line });
      }),
    );
    d.push(
      panel.onDidChangeViewState(() => {
        if (panel.active) provider.activeDocument = document;
      }),
    );
    if (panel.active) provider.activeDocument = document;
    liveSessions.add(this);
    panel.onDidDispose(() => {
      liveSessions.delete(this);
      if (provider.activeDocument === document) provider.activeDocument = undefined;
      d.forEach(x => x.dispose());
    });
  }

  private post(msg: ToWebview) {
    void this.panel.webview.postMessage(msg);
  }

  async onMessage(m: FromWebview) {
    try {
      switch (m.type) {
        case 'ready':
          this.webviewReady = true;
          this.post({
            type: 'init',
            text: this.document.getText(),
            baseUri: this.docDir ? this.panel.webview.asWebviewUri(this.docDir).toString() + '/' : null,
            fileName: path.basename(this.document.uri.path).replace(/\.(mm\.md|mindmap\.md|md|markdown)$/i, ''),
            config: readConfig(),
            lang: vscode.env.language,
            canSaveImages: !!this.docDir,
          });
          break;
        case 'edit': {
          const text = m.text;
          this.queue = this.queue
            .then(() => this.applyText(text))
            .catch(err => vscode.window.showErrorMessage(`Thinkmark: could not update the file: ${err}`))
            .then(() => this.post({ type: 'ack', text: this.document.getText() }));
          break;
        }
        case 'pickImage':
          await this.pickImage(m.nodeId);
          break;
        case 'saveImage':
          await this.saveImage(m.nodeId, m.name, m.mime, m.data);
          break;
        case 'linkImages': {
          const uri = m.uris.map(u => vscode.Uri.parse(u)).find(u => IMAGE_EXT.includes(ext(u.path)));
          if (!uri) {
            vscode.window.showWarningMessage('Thinkmark: drop an image file (png, jpg, gif, svg, webp…).');
            break;
          }
          const src = await this.importImage(uri);
          if (src) this.post({ type: 'imageReady', nodeId: m.nodeId, src });
          break;
        }
        case 'openLink':
          await this.openLink(m.href);
          break;
        case 'openImage': {
          const uri = this.resolveLocal(m.src);
          if (uri) await vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside);
          else if (/^https?:/i.test(m.src)) await vscode.env.openExternal(vscode.Uri.parse(m.src));
          break;
        }
        case 'cleanupImages':
          await vscode.commands.executeCommand('thinkmark.cleanupImages', this.document.uri);
          break;
        case 'openSource':
          await vscode.commands.executeCommand('vscode.openWith', this.document.uri, 'default', vscode.ViewColumn.Beside);
          break;
        case 'revealLine':
          this.revealLine(m.line);
          break;
        case 'spellCheck':
          this.post({ type: 'spellResult', words: m.words, bad: await this.provider.spell.check(m.words) });
          break;
        case 'spellSuggest':
          this.post({ type: 'spellSuggestions', word: m.word, suggestions: await this.provider.spell.suggest(m.word) });
          break;
        case 'spellAdd':
          await this.provider.spell.addWord(m.word);
          break;
        case 'notify': {
          const fn = m.level === 'error' ? vscode.window.showErrorMessage : m.level === 'warn' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
          fn(`Thinkmark: ${m.message}`);
          break;
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Thinkmark: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Replace only the changed span so cursors in side-by-side text editors stay put. */
  private async applyText(newText: string) {
    const doc = this.document;
    const splice = minimalSplice(doc.getText(), newText);
    if (!splice) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(splice.start), doc.positionAt(splice.end)), splice.text);
    this.applying++;
    try {
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) throw new Error('the edit was rejected');
    } finally {
      this.applying--;
    }
  }

  private revealLine(line: number) {
    if (!readConfig().syncSelection) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document !== this.document) continue;
      const l = Math.min(line, this.document.lineCount - 1);
      const range = this.document.lineAt(l).range;
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private imageFolder(): vscode.Uri | undefined {
    if (!this.docDir) return undefined;
    const folder = vscode.workspace.getConfiguration('thinkmark', this.document.uri).get('imageFolder', 'assets');
    return vscode.Uri.joinPath(this.docDir, folder);
  }

  private async pickImage(nodeId: string) {
    if (!this.docDir) {
      vscode.window.showWarningMessage('Thinkmark: save the Markdown file first, then insert images.');
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: this.docDir,
      openLabel: 'Insert Image',
      filters: { Images: IMAGE_EXT },
    });
    if (!picked?.length) return;
    const src = await this.importImage(picked[0]);
    if (src) this.post({ type: 'imageReady', nodeId, src });
  }

  /** Images inside the document's folder or workspace are linked; anything else is copied into the image folder. */
  private async importImage(uri: vscode.Uri): Promise<string | undefined> {
    if (!this.docDir) return undefined;
    const ws = vscode.workspace.getWorkspaceFolder(this.document.uri);
    const inside = (base: vscode.Uri) => uri.scheme === base.scheme && (uri.path + '/').startsWith(base.path.replace(/\/?$/, '/'));
    let target = uri;
    if (!inside(this.docDir) && !(ws && inside(ws.uri))) {
      const folder = this.imageFolder()!;
      await vscode.workspace.fs.createDirectory(folder);
      target = await uniqueUri(folder, path.posix.basename(uri.path));
      await vscode.workspace.fs.copy(uri, target, { overwrite: false });
    }
    return toMarkdownPath(path.posix.relative(this.docDir.path, target.path));
  }

  private async saveImage(nodeId: string, name: string, mime: string, data: string) {
    const folder = this.imageFolder();
    if (!folder) {
      vscode.window.showWarningMessage('Thinkmark: save the Markdown file first, then paste images.');
      return;
    }
    await vscode.workspace.fs.createDirectory(folder);
    const extension = mimeExt(mime) ?? (ext(name) || 'png');
    let base = name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
    if (!base || /^image$/i.test(base)) base = `image-${timestamp()}`;
    const target = await uniqueUri(folder, `${base}.${extension}`);
    await vscode.workspace.fs.writeFile(target, Buffer.from(data, 'base64'));
    this.post({ type: 'imageReady', nodeId, src: toMarkdownPath(path.posix.relative(this.docDir!.path, target.path)) });
  }

  private resolveLocal(src: string): vscode.Uri | undefined {
    const s = src.replace(/^<|>$/g, '');
    if (/^[a-z][\w+.-]*:/i.test(s) && !/^[a-zA-Z]:[\\/]/.test(s)) return s.startsWith('file:') ? vscode.Uri.parse(s) : undefined;
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      /* keep as is */
    }
    if (path.posix.isAbsolute(decoded) || /^[a-zA-Z]:[\\/]/.test(decoded)) return vscode.Uri.file(decoded);
    return this.docDir ? vscode.Uri.joinPath(this.docDir, decoded.split('#')[0]) : undefined;
  }

  private async openLink(href: string) {
    if (!href || href.startsWith('#')) return;
    if (/^(https?|mailto|vscode):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const uri = this.resolveLocal(href);
    if (uri) await vscode.commands.executeCommand('vscode.open', uri);
  }
}

function ext(p: string) {
  const m = /\.([^./]+)$/.exec(p);
  return m ? m[1].toLowerCase() : '';
}

function mimeExt(mime: string): string | undefined {
  const m = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/i.exec(mime);
  if (!m) return undefined;
  const e = m[1].toLowerCase();
  return e === 'svg+xml' ? 'svg' : e === 'jpeg' ? 'jpg' : e;
}

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function uniqueUri(folder: vscode.Uri, fileName: string): Promise<vscode.Uri> {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const suffix = dot > 0 ? fileName.slice(dot) : '';
  for (let i = 0; ; i++) {
    const candidate = vscode.Uri.joinPath(folder, i ? `${stem}-${i}${suffix}` : fileName);
    try {
      await vscode.workspace.fs.stat(candidate);
    } catch {
      return candidate;
    }
  }
}

/** Relative path usable inside ![](...): keep unicode, escape what breaks the link. */
function toMarkdownPath(rel: string): string {
  return rel.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
