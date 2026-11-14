'use strict';
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const ext = vscode.extensions.getExtension('local-tools.markdown-section-reader');
  assert.ok(ext, '找不到已安装的朗读扩展');
  const api = await ext.activate(), cfg = vscode.workspace.getConfiguration('mdReader');
  const result = { started: new Date().toISOString(), appName: vscode.env.appName, vscodeVersion: vscode.version,
    version: ext.packageJSON.version, installedPath: ext.extensionPath, checks: [], status: 'running' };
  const save = () => fs.writeFile(path.join(root, 'qa/qoder-integration.json'), JSON.stringify(result, null, 2) + '\n');
  const ok = async (name, info = {}) => { result.checks.push({ name, passed: true, ...info }); await save(); };
  async function until(fn, timeout = 90000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const s = api.getState(); if (s.state === 'error') throw new Error(s.detail);
      if (fn(s)) return; await wait(100);
    }
    throw new Error('Qoder 验证等待超时');
  }
  try {
    await save();
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/朗读验证.md')));
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('mdReader.openPreview');
    await until(s => s.preview.ready && s.preview.headings === 4);
    assert.ok(ext.extensionPath.toLowerCase().includes('\\.qoder\\extensions\\'));
    await ok('installed production extension opens reading preview and headings');
    const headings = api.getState().headings, first = headings[1], next = headings[3];
    await api.jump(next.id); await until(s => s.preview.revealed === next.id && s.preview.revealedInViewport);
    await ok('outline navigation reveals the requested heading in reading preview', { line: next.line });
    const sourceEditor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
    // 不更改全局配置，避免与另一个正在等待用户处理提示的窗口互相覆盖。
    assert.equal(cfg.get('engine', 'system'), 'system');
    await api.startReading('section', first.id);
    await until(s => s.state === 'playing' && s.preview.highlighted === s.session.current.from);
    await vscode.commands.executeCommand('mdReader.pause'); await until(s => s.state === 'paused');
    const paused = api.getState(), position = paused.session.time;
    await wait(800); assert.ok(Math.abs(api.getState().session.time - position) < 0.15);
    assert.equal(paused.preview.highlighted, paused.session.current.from);
    await ok('system audio plays and preview highlights its source paragraph; pause stops playback',
      { from: paused.session.current.from, to: paused.session.current.to, sourceEditorVisible: sourceEditor.visibleRanges.length > 0 });
    result.pausedForVisualInspection = true; await save();
    const untilContinue = Date.now() + 180000;
    while (Date.now() < untilContinue) {
      try { if (JSON.parse(await fs.readFile(path.join(root, 'qa/control.json'), 'utf8')).continue) break; } catch { /* 等待预览和原文高亮目视检查。 */ }
      await wait(250);
    }
    result.pausedForVisualInspection = false; await save();
    await vscode.commands.executeCommand('mdReader.pause'); await until(s => s.state === 'complete');
    assert.equal(api.getState().session.to, next.from);
    await until(s => s.preview.highlighted === null);
    await ok('reading this section includes child sections and ends before the next peer heading');
    await api.startReading('from', next.id); await until(s => s.state === 'complete');
    assert.equal(api.getState().session.to, doc.getText().length);
    await ok('reading from the selected section reaches the end of the document');
    const rich = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/公式图表验证.md')));
    await vscode.window.showTextDocument(rich, { viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('mdReader.openPreview');
    await until(s => s.preview.renderComplete && s.preview.headings === 5);
    const preview = api.getState().preview;
    assert.ok(preview.formulas >= 5); assert.equal(preview.diagrams, 2); assert.equal(preview.diagramErrors, 0); assert.equal(preview.fontsReady, true);
    await ok('KaTeX and two Mermaid diagrams render in Qoder', { formulas: preview.formulas, diagrams: preview.diagrams });
    const after = api.getState().headings[3]; await api.jump(after.id);
    await until(s => s.preview.revealed === after.id && s.preview.revealedInViewport);
    await ok('navigation stays accurate after formula and diagram rendering');
    result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.error = e.stack; throw e; }
  finally {
    await vscode.commands.executeCommand('mdReader.stop');
    result.finished = new Date().toISOString(); result.state = api.getState(); await save();
  }
};
