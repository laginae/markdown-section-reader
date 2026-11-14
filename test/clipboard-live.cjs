'use strict';
// 真实宿主中的交互验收：仅公开夹具的复制结果允许写入报告，原剪贴板仅保留在内存。
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const ext = vscode.extensions.getExtension('local-tools.markdown-section-reader'), api = await ext.activate();
  const ide = /[\\/]\.qoder[\\/]/i.test(ext.extensionPath) ? 'qoder' : 'cursor';
  // 同一系统剪贴板的两宿主验收按顺序执行，避免另一宿主把临时测试文本当作原剪贴板。
  for (;;) {
    let turn; try { turn = JSON.parse(await fs.readFile(path.join(root, 'qa/clipboard-turn.json'), 'utf8')).ide; } catch {}
    if (!turn || turn === ide) break;
    await wait(200);
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/选区引用验证.md')));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
  await vscode.commands.executeCommand('mdReader.openPreview');
  const initialClipboard = await vscode.env.clipboard.readText();
  const filePath = vscode.workspace.getWorkspaceFolder(doc.uri) ? vscode.workspace.asRelativePath(doc.uri, vscode.workspace.workspaceFolders.length > 1) : doc.fileName;
  const { clipboardReference } = require('../src/selection-reference.cjs');
  const result = { started: new Date().toISOString(), version: ext.packageJSON.version, installedPath: ext.extensionPath,
    testedVsixSha256: JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'))).sha256, checks: [], copies: [], status: 'running' };
  let scenario, baseline = initialClipboard, previousCopies = api.getState().trace.filter(e => e.type === 'clipboardReferenceCopied').length, lastWritten;
  let previousNative = api.getState().trace.filter(e => e.type === 'chatReferenceAdded').length;
  const end = Date.now() + 1800000;
  const save = () => fs.writeFile(path.join(root, `qa/${ide}-clipboard-integration.json`), JSON.stringify(result, null, 2) + '\n');
  while (Date.now() < end) {
    let control = {};
    try { control = JSON.parse(await fs.readFile(path.join(root, `qa/${ide}-clipboard-control.json`), 'utf8')); } catch { /* 尚未开始交互。 */ }
    if (control.finish) {
      await vscode.commands.executeCommand('mdReader.stop');
      const current = await vscode.env.clipboard.readText();
      if (lastWritten !== undefined && current === lastWritten) await vscode.env.clipboard.writeText(initialClipboard);
      result.clipboardRestored = lastWritten !== undefined && current === lastWritten;
      result.finished = new Date().toISOString();
      result.status = result.checks.length && result.checks.every(c => c.passed) ? 'passed' : 'failed';
      await save(); return;
    }
    if (control.id && control.id !== scenario?.id) {
      scenario = { ...control, selected: false, copied: false }; baseline = await vscode.env.clipboard.readText();
    }
    const state = api.getState();
    const native = state.trace.filter(e => e.type === 'chatReferenceAdded');
    if (native.length > previousNative) {
      result.references = native;
      result.checks.push({ name: 'native card command leaves clipboard unchanged', passed: await vscode.env.clipboard.readText() === (lastWritten ?? initialClipboard) });
      previousNative = native.length; await save();
    }
    if (scenario && !scenario.selected && state.preview.selection?.startLine === scenario.startLine && state.preview.selection?.endLine === scenario.endLine) {
      scenario.selected = true;
      result.checks.push({ name: `${scenario.id}: selection leaves clipboard unchanged`, passed: await vscode.env.clipboard.readText() === baseline });
      await save();
    }
    const copies = state.trace.filter(e => e.type === 'clipboardReferenceCopied');
    if (copies.length > previousCopies) {
      const value = await vscode.env.clipboard.readText(), meta = state.preview.lastCopiedReference;
      // 限定为当前公开夹具，其他来源的剪贴板内容不写入报告。
      const expected = scenario?.text && clipboardReference(filePath, { startLine: scenario.startLine, endLine: scenario.endLine }, scenario.text);
      const publicPrefix = clipboardReference(filePath, { startLine: meta.startLine, endLine: meta.endLine }, '公开').split('\n选中内容：')[0] + '\n选中内容：\n';
      const belongs = value.startsWith(publicPrefix);
      result.copies.push({ id: scenario?.id, ...meta, expectedMatches: !!expected && value === expected, ...(belongs ? { publicFixturePayload: value } : {}) });
      result.checks.push({ name: `${scenario?.id}: copied payload matches exact selected text and source lines`, passed: !!expected && value === expected });
      if (belongs) lastWritten = value;
      if (scenario) scenario.copied = true;
      previousCopies = copies.length; await save();
    }
    await fs.writeFile(path.join(root, `qa/${ide}-selection-live.json`), JSON.stringify({ version: ext.packageJSON.version, installedPath: ext.extensionPath, preview: state.preview, state: state.state,
      references: state.trace.filter(e => e.type === 'chatReferenceAdded') }, null, 2) + '\n');
    await wait(250);
  }
  result.status = 'timed-out'; await save();
};
