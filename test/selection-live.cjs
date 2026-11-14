'use strict';
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const ext = vscode.extensions.getExtension('local-tools.markdown-section-reader'), api = await ext.activate();
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/选区引用验证.md')));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
  await vscode.commands.executeCommand('mdReader.openPreview');
  const end = Date.now() + 900000; let previous = '';
  while (Date.now() < end) {
    const state = api.getState();
    const compact = { version: ext.packageJSON.version, installedPath: ext.extensionPath, preview: state.preview,
      references: state.trace.filter(e => e.type === 'chatReferenceAdded') };
    const data = JSON.stringify(compact, null, 2);
    if (data !== previous) { await fs.writeFile(path.join(root, 'qa/selection-live.json'), data + '\n'); previous = data; }
    await wait(250);
  }
};
