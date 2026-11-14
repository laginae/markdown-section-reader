'use strict';
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const result = { started: new Date().toISOString(), version: require('../package.json').version, checks: [], status: 'running' };
  const save = () => fs.writeFile(path.join(root, 'qa/preview-integration.json'), JSON.stringify(result, null, 2) + '\n');
  const ok = async name => { result.checks.push({ name, passed: true }); await save(); };
  const api = await vscode.extensions.getExtension('local-tools.markdown-section-reader').activate();
  async function until(fn, timeout = 90000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (api.getState().state === 'error') throw new Error(api.getState().detail); if (fn()) return; await wait(100); }
    throw new Error('Preview test timed out');
  }
  const cfg = vscode.workspace.getConfiguration('mdReader');
  const oldEngine = cfg.inspect('engine')?.globalValue, oldSpeed = cfg.inspect('speed')?.globalValue;
  try {
    await save();
    const d = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/朗读验证.md')));
    await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('mdReader.openPreview');
    await until(() => api.getState().preview.ready && api.getState().preview.headings === 4, 20000);
    await ok('preview renders live document and all four headings');
    const renderId = api.getState().preview.renderId;
    await vscode.commands.executeCommand('mdReader.openPreview');
    assert.equal(api.getState().preview.renderId, renderId);
    await ok('refocusing unchanged preview preserves DOM and selection anchors');
    const a = api.getState().headings[1], b = api.getState().headings[3];
    await api.jump(b.id); await until(() => api.getState().preview.revealed === b.id);
    assert.equal(api.getState().preview.visible, true); await ok('outline jumps inside preview without opening source editor');
    if (!api.getState().controlsCollapsed) await vscode.commands.executeCommand('mdReader.toggleControls');
    assert.equal(api.getState().controlsCollapsed, true); await ok('collapsed state is persisted by host');
    await cfg.update('engine', 'system', vscode.ConfigurationTarget.Global); await cfg.update('speed', 1.2, vscode.ConfigurationTarget.Global);
    await api.startReading('section', a.id);
    await until(() => api.getState().state === 'playing' && api.getState().session.index === 1);
    await until(() => api.getState().preview.highlighted === api.getState().session.current.from);
    await ok('system audio plays with collapsed controls and preview paragraph highlight');
    await vscode.commands.executeCommand('mdReader.pause'); await until(() => api.getState().state === 'paused');
    await wait(300); const time = api.getState().session.time; await wait(600); assert.ok(Math.abs(api.getState().session.time - time) < .12);
    await ok('pause freezes playback in preview');
    await vscode.commands.executeCommand('mdReader.pause'); await until(() => api.getState().state === 'complete');
    assert.equal(api.getState().session.index, 4); assert.equal(api.getState().session.to, b.from);
    await until(() => api.getState().preview.highlighted === null); await ok('read section includes child section and clears preview highlight on completion');
    await cfg.update('engine', 'mimo', vscode.ConfigurationTarget.Global); await api.startReading('from', b.id);
    await until(() => api.getState().state === 'playing' && api.getState().preview.highlighted === api.getState().session.current.from);
    await ok('existing MiMo credential retained; real audio highlights preview');
    await until(() => api.getState().state === 'complete');
    assert.equal(api.getState().session.index, 2); assert.equal(api.getState().session.to, d.getText().length); await ok('read from section reaches document end');
    await cfg.update('engine', 'system', vscode.ConfigurationTarget.Global);
    const scratch = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# 原文映射\n\n只用于验证修改停止和预览更新。' });
    let editor = await vscode.window.showTextDocument(scratch, { viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('mdReader.openPreview'); await until(() => api.getState().preview.headings === 1);
    await api.startReading('section'); await until(() => api.getState().state === 'playing');
    editor = await vscode.window.showTextDocument(scratch, { viewColumn: vscode.ViewColumn.One });
    await editor.edit(e => e.insert(new vscode.Position(0, 0), '# 新标题\n\n'));
    await until(() => api.getState().state === 'idle' && api.getState().headings.length === 2 && api.getState().preview.headings === 2);
    assert.equal(api.getState().session, null); await ok('unsaved edits stop audio and update preview mapping');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.One }); await vscode.commands.executeCommand('mdReader.openPreview');
    await until(() => api.getState().preview.headings === 4); result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.error = e.stack; throw e; }
  finally {
    await vscode.commands.executeCommand('mdReader.stop');
    await cfg.update('engine', oldEngine, vscode.ConfigurationTarget.Global); await cfg.update('speed', oldSpeed, vscode.ConfigurationTarget.Global);
    result.finished = new Date().toISOString(); result.state = api.getState(); await save();
  }
};
