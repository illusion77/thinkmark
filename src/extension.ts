import * as vscode from 'vscode';
import { ImageCleanup } from './imageCleanup';
import { liveSessions, MindmapEditorProvider, VIEW_TYPES } from './mindmapEditor';

const TEMPLATE = `# Central Topic

## Main Topic 1

- Subtopic 1
- Subtopic 2

## Main Topic 2

## Main Topic 3
`;

export function activate(context: vscode.ExtensionContext) {
  // tests set THINKMARK_TEST_NO_TRASH so they don't fill the real Trash
  const cleanup = new ImageCleanup(process.env.THINKMARK_TEST_NO_TRASH !== '1');
  const { provider, disposable } = MindmapEditorProvider.register(context);
  context.subscriptions.push(disposable);

  const targetUri = (uri?: vscode.Uri) => {
    if (uri instanceof vscode.Uri) return uri;
    return vscode.window.activeTextEditor?.document.uri ?? provider.activeDocument?.uri;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('thinkmark.openAsMindMap', async (uri?: vscode.Uri) => {
      const target = targetUri(uri);
      if (!target) return vscode.window.showInformationMessage('Thinkmark: open a Markdown file first.');
      await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPES[0]);
    }),
    vscode.commands.registerCommand('thinkmark.openToSide', async (uri?: vscode.Uri) => {
      const target = targetUri(uri);
      if (!target) return vscode.window.showInformationMessage('Thinkmark: open a Markdown file first.');
      await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPES[0], vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand('thinkmark.openSource', async (uri?: vscode.Uri) => {
      const target = uri instanceof vscode.Uri ? uri : provider.activeDocument?.uri;
      if (!target) return;
      await vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand('thinkmark.cleanupImages', (uri?: vscode.Uri) =>
      cleanup.cleanupCommand(uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri ?? provider.activeDocument?.uri),
    ),
    vscode.commands.registerCommand('thinkmark.newMindMap', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uri = await vscode.window.showSaveDialog({
        defaultUri: folder ? vscode.Uri.joinPath(folder, 'mindmap.md') : undefined,
        filters: { Markdown: ['md'] },
        saveLabel: 'Create Mind Map',
      });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(TEMPLATE, 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPES[0]);
    }),
  );
  return { liveSessions, cleanup };
}

export function deactivate() {}
