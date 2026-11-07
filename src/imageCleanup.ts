import * as vscode from 'vscode';
import * as path from 'path';
import { fileNameSpellings } from './shared/links';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const IMAGE_GLOB = '*.{png,jpg,jpeg,gif,webp,svg,bmp,avif,PNG,JPG,JPEG,GIF,WEBP,SVG}';
/** Files that may link to an image: an image is only "unused" if none of these mention it. */
const TEXT_RE = /\.(md|markdown|mdx|html?|txt|rst|adoc|org|tex)$/i;
const TEXT_GLOB = '**/*.{md,markdown,mdx,html,htm,txt,rst,adoc,org,tex,MD}';
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**}';
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const zh = /^zh/i.test(vscode.env.language);
const L = (en: string, cn: string) => (zh ? cn : en);
const status = (text: string) => vscode.window.setStatusBarMessage(`Thinkmark: ${text}`, 6000);

/**
 * "Thinkmark: Clean Up Unused Images…": lists images in image folders (`thinkmark.imageFolder`)
 * that no Markdown / HTML / text file mentions, and moves the ones you keep checked to the Trash.
 * Nothing is ever deleted automatically.
 */
export class ImageCleanup {
  constructor(private readonly useTrash = true) {}

  /** Images in image folders that no Markdown / HTML / text file mentions. */
  async findUnusedImages(docUri?: vscode.Uri): Promise<vscode.Uri[]> {
    const folderName = vscode.workspace.getConfiguration('thinkmark', docUri).get('imageFolder', 'assets').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    const images = new Map<string, vscode.Uri>();
    for (const f of await vscode.workspace.findFiles(`**/${folderName}/**/${IMAGE_GLOB}`, EXCLUDE_GLOB, 20000)) images.set(f.fsPath, f);
    // the document's own folder may be outside the workspace
    const docDir = docUri?.scheme === 'file' ? vscode.Uri.file(path.dirname(docUri.fsPath)) : undefined;
    if (docDir) for (const f of await listImages(vscode.Uri.joinPath(docDir, folderName))) images.set(f.fsPath, f);
    if (!images.size) return [];
    const texts = await textCorpus(docDir);
    return [...images.values()].filter(f => !mentioned(texts, f.fsPath)).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  async cleanupCommand(docUri?: vscode.Uri) {
    if (!vscode.workspace.workspaceFolders?.length && !docUri) {
      status(L('open a folder or a Markdown file first', '请先打开一个文件夹或 Markdown 文件'));
      return;
    }
    const unused = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: L('Looking for unused images…', '正在查找未使用的图片…') },
      () => this.findUnusedImages(docUri),
    );
    if (!unused.length) {
      status(L('no unused images', '没有未使用的图片'));
      return;
    }
    const items = await Promise.all(
      unused.map(async uri => {
        let size = '';
        try {
          size = formatSize((await vscode.workspace.fs.stat(uri)).size);
        } catch {
          /* ignore */
        }
        return { label: `$(file-media) ${path.basename(uri.fsPath)}`, description: vscode.workspace.asRelativePath(path.dirname(uri.fsPath)), detail: size, picked: true, uri };
      }),
    );
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: L(`${unused.length} unused image${unused.length > 1 ? 's' : ''} — the checked ones go to the Trash`, `找到 ${unused.length} 张未使用的图片，勾选的会移到废纸篓`),
      placeHolder: L('No Markdown, HTML or text file in the workspace mentions these files', '工作区里没有任何 Markdown、HTML 或文本文件提到这些图片'),
      ignoreFocusOut: true,
    });
    if (!picked?.length) return;
    const { removed, failed } = await this.trashFiles(picked.map(i => i.uri));
    const parts: string[] = [];
    if (removed.length) parts.push(this.useTrash ? L(`moved ${removed.length} image(s) to the Trash`, `已将 ${removed.length} 张图片移到废纸篓`) : L(`deleted ${removed.length} image(s)`, `已删除 ${removed.length} 张图片`));
    if (failed.length) parts.push(L(`could not move ${failed.join(', ')}`, `无法移动：${failed.join('、')}`));
    status(parts.join(L('; ', '；')));
  }

  /** Move files to the Trash; never deletes permanently when the Trash is unavailable. */
  async trashFiles(uris: vscode.Uri[]) {
    const removed: string[] = [];
    const failed: string[] = [];
    for (const uri of uris) {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: this.useTrash });
        removed.push(path.basename(uri.fsPath));
      } catch {
        if (await exists(uri)) failed.push(path.basename(uri.fsPath));
      }
    }
    return { removed, failed };
  }
}

/** Text of every open document and every text file in the workspace (and the given folder). */
async function textCorpus(extraDir?: vscode.Uri): Promise<string[]> {
  const texts: string[] = [];
  const done = new Set<string>();
  for (const d of vscode.workspace.textDocuments) {
    if (d.uri.scheme !== 'file' || done.has(d.uri.fsPath)) continue;
    if (!(TEXT_RE.test(d.uri.fsPath) || d.languageId === 'markdown')) continue;
    done.add(d.uri.fsPath);
    texts.push(d.getText());
  }
  const files = await vscode.workspace.findFiles(TEXT_GLOB, EXCLUDE_GLOB, 20000);
  if (extraDir) {
    try {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(extraDir))
        if (type === vscode.FileType.File && TEXT_RE.test(name)) files.push(vscode.Uri.joinPath(extraDir, name));
    } catch {
      /* ignore */
    }
  }
  for (const f of files) {
    if (done.has(f.fsPath)) continue;
    done.add(f.fsPath);
    try {
      const data = await vscode.workspace.fs.readFile(f);
      if (data.byteLength < MAX_TEXT_BYTES) texts.push(Buffer.from(data).toString('utf8'));
    } catch {
      /* ignore unreadable files */
    }
  }
  return texts;
}

function mentioned(texts: string[], file: string) {
  const spellings = fileNameSpellings(path.basename(file));
  return texts.some(text => spellings.some(s => text.includes(s)));
}

async function listImages(dir: vscode.Uri, depth = 0): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = [];
  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
      const uri = vscode.Uri.joinPath(dir, name);
      if (type === vscode.FileType.File && IMAGE_RE.test(name)) out.push(uri);
      else if (type === vscode.FileType.Directory && depth < 4) out.push(...(await listImages(uri, depth + 1)));
    }
  } catch {
    /* folder missing */
  }
  return out;
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function exists(uri: vscode.Uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
