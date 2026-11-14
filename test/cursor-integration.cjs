'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const resultPath = path.join(root, 'qa', 'cursor-integration.json');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = fn(); if (value) return value; await wait(100); }
  throw new Error('等待 Cursor 播放状态超时');
}
exports.run = async function run() {
  const result = { started: new Date().toISOString(), app: vscode.env.appName, vscode: vscode.version, checks: [], trace: [], status: 'running' };
  const save = () => fs.writeFile(resultPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  const ok = async (name, details = {}) => { result.checks.push({ name, passed: true, ...details }); await save(); };
  const cfg = vscode.workspace.getConfiguration('mdReader');
  const originals = Object.fromEntries(['engine', 'speed', 'systemVoice'].map(k => [k, cfg.inspect(k)?.globalValue]));
  let api;
  try {
    await save();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa', '朗读验证.md')));
    let editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    const extension = vscode.extensions.getExtension('local-tools.markdown-section-reader');
    assert.ok(extension); api = await extension.activate();
    await vscode.commands.executeCommand('mdReader.open');
    await until(() => api.getState().ready, 20000);
    assert.equal(api.getState().headings.length, 4); await ok('live Markdown outline', { headings: 4 });
    const a = api.getState().headings[1], b = api.getState().headings[3];
    await api.jump(b.id);
    assert.ok(vscode.window.visibleTextEditors.some(e => e.document === document && e.selection.active.line === b.line));
    await ok('jump reveals exact source line', { line: b.line + 1 });
    await cfg.update('speed', 1.2, vscode.ConfigurationTarget.Global);
    for (const engine of ['system', 'mimo']) {
      await cfg.update('engine', engine, vscode.ConfigurationTarget.Global);
      if (engine === 'mimo') {
        await vscode.commands.executeCommand('mdReader.importObsidianKey', process.env.MD_READER_TEST_VAULT || '');
        assert.ok(api.getState().trace.some(e => e.type === 'credentialImported'));
        await ok('named Obsidian secret imported to Cursor SecretStorage');
      }
      await api.startReading('section', a.id);
      await until(() => {
        const s = api.getState(); if (s.state === 'error') throw new Error(s.detail);
        return s.state === 'playing' && s.session.index === 1;
      });
      assert.equal(api.getState().session.to, b.from);
      await vscode.commands.executeCommand('mdReader.pause'); await until(() => api.getState().state === 'paused');
      await wait(350); const time = api.getState().session.time; await wait(600);
      assert.ok(Math.abs(api.getState().session.time - time) < 0.12);
      await ok(`${engine}: real audio plays and pause freezes playback`, { audioTime: time });
      await vscode.commands.executeCommand('mdReader.pause');
      await until(() => { const s = api.getState(); if (s.state === 'error') throw new Error(s.detail); return s.state === 'complete'; }, 240000);
      const finished = api.getState().session;
      assert.equal(finished.index, 4); assert.equal(finished.to, b.from);
      await ok(`${engine}: read section including child ends before next peer`, { played: finished.index, endOffset: finished.to });
      await api.startReading('from', b.id);
      await until(() => { const s = api.getState(); if (s.state === 'error') throw new Error(s.detail); return s.state === 'complete'; }, 180000);
      assert.equal(api.getState().session.to, document.getText().length);
      await ok(`${engine}: read from section reaches document end`, { played: api.getState().session.index });
    }
    await cfg.update('engine', 'system', vscode.ConfigurationTarget.Global);
    const scratch = await vscode.workspace.openTextDocument({ content: '# 原始标题\n\n修改期间测试朗读停止。', language: 'markdown' });
    editor = await vscode.window.showTextDocument(scratch);
    await until(() => api.getState().headings[0]?.title === '原始标题');
    await api.startReading('section');
    assert.ok(vscode.window.visibleTextEditors.some(e => e.document === scratch), '打开朗读面板不能遮住正在编辑的 Markdown');
    editor = vscode.window.visibleTextEditors.find(e => e.document === scratch);
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '# 未保存标题\n\n'));
    assert.equal(api.getState().state, 'idle'); assert.equal(api.getState().session, null);
    assert.equal(api.getState().headings[0].title, '未保存标题');
    await wait(1800); assert.equal(api.getState().state, 'idle');
    await ok('unsaved edits refresh outline and cancel pending audio');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.window.showTextDocument(document);
    await api.startReading('section', a.id);
    await vscode.commands.executeCommand('mdReader.stop'); await wait(1500);
    assert.equal(api.getState().session, null); assert.equal(api.getState().state, 'idle'); await ok('stop cancels pending synthesis');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    result.trace = api?.getState().trace || []; result.finished = new Date().toISOString();
    await vscode.commands.executeCommand('mdReader.stop');
    for (const [key, value] of Object.entries(originals)) await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    await save();
  }
};
