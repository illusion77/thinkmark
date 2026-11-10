// Runs inside a real VS Code extension host (see test/vscode/run.sh).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error('timed out waiting for ' + fn.toString());
}

exports.run = async function run() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const dir = process.env.THINKMARK_TEST_DIR;
  const out = path.join(dir, 'results.json');
  try {
    const mdPath = path.join(dir, 'notes', 'test map.md');
    const original = '# Root\n\n## A\n\n- a1\n';
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, original);
    const uri = vscode.Uri.file(mdPath);

    const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'thinkmark');
    const api = await ext.activate();
    check('extension activates', ext.isActive);
    const cmds = await vscode.commands.getCommands(true);
    check('commands registered', ['thinkmark.openAsMindMap', 'thinkmark.openToSide', 'thinkmark.openSource', 'thinkmark.newMindMap'].every(c => cmds.includes(c)));

    await vscode.commands.executeCommand('vscode.openWith', uri, 'thinkmark.editor');
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    check('opens in the custom editor', tab && tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'thinkmark.editor', tab && tab.label);

    const session = await waitFor(() => [...api.liveSessions].find(s => s.document.uri.fsPath === uri.fsPath && s.webviewReady));
    check('webview script runs and requests the document', !!session);

    const doc = session.document;

    if (process.env.THINKMARK_INTERACTIVE) {
      // Real keyboard test: an outside driver presses keys in this window, then creates "interactive-done".
      const timeline = [];
      const sub = vscode.workspace.onDidChangeTextDocument(e => e.document === doc && timeline.push(doc.getText()));
      fs.writeFileSync(path.join(dir, 'interactive-ready'), '');
      await waitFor(() => fs.existsSync(path.join(dir, 'interactive-done')), 240000);
      sub.dispose();
      check('INTERACTIVE timeline', true, timeline);
      fs.writeFileSync(out, JSON.stringify(results, null, 2));
      return;
    }
    await session.onMessage({ type: 'edit', text: '# Root\n\n## A\n\n- a1\n- a2\n' });
    await session.queue;
    check('webview edit is written to the document', doc.getText() === '# Root\n\n## A\n\n- a1\n- a2\n', JSON.stringify(doc.getText()));
    check('document becomes dirty (save with Cmd+S)', doc.isDirty);

    // Cmd+Z in the focused mind map runs the same 'undo' command (the webview forwards the key).
    // A fresh profile may leave focus in a side-bar text box (chat input, search...), which
    // takes the 'undo' command before the custom editor does; a user clicking the map has no such box focused.
    for (const c of ['workbench.action.closeAuxiliaryBar', 'workbench.action.closeSidebar', 'workbench.action.closePanel']) {
      await vscode.commands.executeCommand(c).then(undefined, () => undefined);
    }
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await sleep(200);
    await vscode.commands.executeCommand('undo');
    const undone = await waitFor(() => doc.getText() === original, 5000).catch(() => false);
    check('VS Code undo reverts the edit', undone, JSON.stringify(doc.getText()));
    await vscode.commands.executeCommand('redo');
    const redone = await waitFor(() => doc.getText().includes('- a2'), 5000).catch(() => false);
    check('VS Code redo re-applies the edit', redone, JSON.stringify(doc.getText()));

    await session.onMessage({ type: 'saveImage', nodeId: 'x', name: 'image.png', mime: 'image/png', data: PNG_1PX });
    const assets = path.join(dir, 'notes', 'assets');
    const saved = fs.existsSync(assets) ? fs.readdirSync(assets) : [];
    check('pasted image saved under assets/', saved.some(f => /^image-\d{8}-\d{6}\.png$/.test(f)), saved);

    const posted = [];
    const origPost = session.post.bind(session);
    session.post = m => { posted.push(m); origPost(m); };
    const writePng = p => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(PNG_1PX, 'base64')); };

    const inWorkspace = path.join(dir, 'shared imgs', 'arch.png');
    writePng(inWorkspace);
    await session.onMessage({ type: 'linkImages', nodeId: 'y', uris: [vscode.Uri.file(inWorkspace).toString()] });
    const linked = posted.filter(m => m.type === 'imageReady').pop();
    check('image inside the workspace is linked in place', linked && linked.src === '../shared%20imgs/arch.png', linked);

    const outside = path.join(dir, '..', 'outside dir', 'diagram (v2).png');
    writePng(outside);
    await session.onMessage({ type: 'linkImages', nodeId: 'y', uris: [vscode.Uri.file(outside).toString()] });
    const copied = posted.filter(m => m.type === 'imageReady').pop();
    check('image outside the workspace is copied into assets/', copied && copied.src === 'assets/diagram%20%28v2%29.png' && fs.existsSync(path.join(assets, 'diagram (v2).png')), copied);

    await doc.save();
    check('save writes the file', fs.readFileSync(mdPath, 'utf8').includes('- a2'));

    // ---- spelling: the dictionary ships with the extension and is read in the extension host ----
    const misspelled = await api.spell.check(['the', 'teh', 'config', 'Recieve']);
    check('spell checker finds the misspelled words', misspelled.join() === 'teh,Recieve', misspelled);
    const suggested = await api.spell.suggest('teh');
    check('spell checker suggests a replacement', suggested[0] === 'the', suggested);
    posted.length = 0;
    await session.onMessage({ type: 'spellCheck', words: ['wrod', 'word'] });
    const spelled = posted.find(m => m.type === 'spellResult');
    check('webview is told which words are misspelled', spelled && spelled.bad.join() === 'wrod', spelled);
    await session.onMessage({ type: 'spellAdd', word: 'wrod' });
    const reconfigured = await waitFor(() => posted.find(m => m.type === 'config'), 5000).catch(() => undefined);
    const afterAdd = await api.spell.check(['wrod', 'wrood']);
    check('"Add to Dictionary" saves the word in the user settings', reconfigured && afterAdd.join() === 'wrood', {
      afterAdd,
      userWords: vscode.workspace.getConfiguration('thinkmark').get('spellCheck.userWords'),
    });

    // ---- images: nothing is deleted automatically; the cleanup command finds leftovers ----
    const cdir = path.join(dir, 'cleanup');
    const cassets = path.join(cdir, 'assets');
    const pngAt = p => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(PNG_1PX, 'base64')); };
    for (const f of ['old.png', 'shared.png', 'html-only.png', 'orphan.png', 'kept.png']) pngAt(path.join(cassets, f));
    pngAt(path.join(dir, 'linked', 'outside.png'));
    fs.writeFileSync(path.join(cdir, 'other.md'), '# Other\n\n- uses ![](assets/shared.png)\n');
    fs.writeFileSync(path.join(cdir, 'page.html'), '<img src="assets/html-only.png">');
    const mapPath = path.join(cdir, 'map.md');
    fs.writeFileSync(mapPath, '# Map\n\n- old ![](assets/old.png)\n- kept ![](assets/kept.png)\n- linked ![](../linked/outside.png)\n');
    const mapUri = vscode.Uri.file(mapPath);
    await vscode.commands.executeCommand('vscode.openWith', mapUri, 'thinkmark.editor');
    const s2 = await waitFor(() => [...api.liveSessions].find(s => s.document.uri.fsPath === mapPath && s.webviewReady));
    const has = f => fs.existsSync(path.join(cdir, f));
    await s2.onMessage({ type: 'edit', text: '# Map\n\n- old\n- kept ![](assets/kept.png)\n- linked\n' });
    await s2.queue;
    await s2.document.save();
    await sleep(800);
    check('removing an image and saving keeps the file', has('assets/old.png') && fs.existsSync(path.join(dir, 'linked', 'outside.png')));

    const unused = (await api.cleanup.findUnusedImages(mapUri)).map(u => path.relative(cdir, u.fsPath));
    check(
      'cleanup lists only images nothing mentions',
      unused.includes(path.join('assets', 'old.png')) && unused.includes(path.join('assets', 'orphan.png')) && !unused.some(u => /(shared|html-only|kept)\.png$/.test(u)),
      unused,
    );
    const res = await api.cleanup.trashFiles([vscode.Uri.file(path.join(cassets, 'old.png')), vscode.Uri.file(path.join(cassets, 'orphan.png'))]);
    check('cleanup removes the checked files only', res.removed.length === 2 && !has('assets/old.png') && !has('assets/orphan.png') && has('assets/kept.png') && has('assets/shared.png'), res);
  } catch (err) {
    check('no exception', false, String(err && err.stack || err));
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
};
