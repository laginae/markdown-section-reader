'use strict';
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async () => {
  const ext = vscode.extensions.getExtension('local-tools.markdown-section-reader'), api = await ext.activate();
  const ide = /[\\/]\.qoder[\\/]/i.test(ext.extensionPath) ? 'qoder' : 'cursor';
  const cfg = () => JSON.stringify(vscode.workspace.getConfiguration('mdReader'));
  const before = cfg(), manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
  const result = { started: new Date().toISOString(), ide, appName: vscode.env.appName, hostVersion: vscode.version,
    version: ext.packageJSON.version, installedPath: ext.extensionPath, testedVsixSha256: manifest.sha256, status: 'running', checks: [], timings: {} };
  const save = () => fs.writeFile(path.join(root, `qa/${ide}-cozy-integration.json`), JSON.stringify(result, null, 2) + '\n');
  const ok = async (name, data = {}) => { result.checks.push({ name, passed: true, ...data }); await save(); };
  const publicNames = ['朗读改善验证.md', '公式图表验证.md', '选区引用验证.md'];
  let lastLive = 0;
  async function until(fn, timeout = 240000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const s = api.getState();
      if (Date.now() - lastLive > 500) {
        await fs.writeFile(path.join(root, `qa/${ide}-live.json`), JSON.stringify(publicNames.includes(s.file) ? s : { state:s.state, publicFixtureActive:false }, null, 2) + '\n');
        lastLive = Date.now();
      }
      if (s.state === 'error') throw new Error(s.detail);
      if (fn(s)) return s;
      await wait(100);
    }
    throw new Error('宿主朗读验收等待超时');
  }
  try {
    await save(); assert.equal(ext.packageJSON.version, require('../package.json').version);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/朗读改善验证.md')));
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview:false });
    await vscode.commands.executeCommand('mdReader.openPreview');
    await until(s => s.preview.visible && s.preview.renderComplete && s.headings.length === 4);
    const headings = api.getState().headings, section = headings[1], next = headings[3];
    await api.jump(next.id); await until(s => s.preview.revealed === next.id && s.preview.revealedInViewport);
    await ok('installed extension renders preview and outline navigation');
    for (const engine of ['system', 'mimo']) {
      if (engine === 'mimo') await vscode.commands.executeCommand('mdReader.importObsidianKey');
      const settings = { engine, systemVoice:'', mimoVoice:'冰糖', speed:engine === 'system' ? 1.75 : 1.25, volume:.65,
        buffering:'continuous', quickStart:'standard', academicMathMode:'smart', academicMathStyle:'verbose',
        speechTermsEnabled:true, speechTerms:'CVaR=条件风险价值' };
      await api.startReading('section', section.id, settings);
      const playing = await until(s => s.state === 'playing' && s.preview.highlighted === s.session.current.from);
      const id = playing.session.id;
      assert.ok(playing.session.total > 1);
      await wait(400); const pauseRequestedAt = Date.now(); await vscode.commands.executeCommand('mdReader.pause');
      const paused = await until(s => s.state === 'paused' && s.trace.some(e => e.type === 'paused' && e.at >= pauseRequestedAt)), time = paused.session.time;
      await wait(700); assert.ok(Math.abs(api.getState().session.time - time) < .2);
      assert.equal(paused.preview.highlighted, paused.session.current.from);
      await ok(`${engine}: real audio starts, source highlight follows, pause holds position`);
      await vscode.commands.executeCommand('mdReader.pause'); await until(s => s.state === 'playing');
      if (engine === 'system') {
        await vscode.commands.executeCommand('mdReader.next'); await until(s => s.state === 'playing' && s.session.index === 1);
        await vscode.commands.executeCommand('mdReader.previous'); await until(s => s.state === 'playing' && s.session.index === 0);
        await vscode.commands.executeCommand('mdReader.seekForward'); await wait(200);
        assert.ok(api.getState().session.time >= 4.5);
        await vscode.commands.executeCommand('mdReader.seekBackward');
        await ok('previous/next and five-second seeking use the active playback session');
      }
      const complete = await until(s => s.state === 'complete');
      assert.equal(complete.session.to, next.from);
      const events = complete.trace.filter(e => e.id === id);
      const synth = events.filter(e => e.type === 'synthesized'), ended = events.filter(e => e.type === 'ended');
      assert.ok(ended.some(e => synth.some(n => n.index === e.index + 1 && n.at < e.at)), '下一段未提前准备');
      assert.ok(events.filter(e => e.type === 'playing').every(e => e.from >= section.from && e.to <= section.to));
      result.timings[engine] = complete.session.diagnostics;
      await ok(`${engine}: prepares ahead, includes child section and stops at the selected boundary`, { audioParts:complete.session.total });
      await api.startReading('section', section.id, settings);
      const repeat = await until(s => s.state === 'playing');
      assert.ok(repeat.trace.some(e => e.id === repeat.session.id && e.type === 'synthesized' && e.index === 0 && e.cached));
      await vscode.commands.executeCommand('mdReader.stop');
      const stopId = repeat.session.id; await wait(500);
      assert.equal(api.getState().state, 'idle');
      await ok(`${engine}: replay reuses prepared audio and stop remains stopped`, { session:stopId });
    }
    await api.startReading('from', next.id, {engine:'system',systemVoice:'',speed:2});
    const end = await until(s => s.state === 'complete'); assert.equal(end.session.to, doc.getText().length);
    await ok('read from the selected section reaches document end');
    const rich = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/公式图表验证.md')));
    await vscode.window.showTextDocument(rich, {viewColumn:vscode.ViewColumn.One}); await vscode.commands.executeCommand('mdReader.openPreview');
    const rendered = await until(s => s.preview.visible && s.preview.renderComplete && s.preview.diagrams === 2);
    assert.ok(rendered.preview.formulas >= 5); assert.equal(rendered.preview.diagramErrors,0);
    const target = rendered.headings[3]; await api.jump(target.id); await until(s => s.preview.revealed === target.id && s.preview.revealedInViewport);
    await ok('LaTeX, Mermaid and post-render navigation remain correct', {formulas:rendered.preview.formulas,diagrams:rendered.preview.diagrams});
    result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.error = e.stack; throw e; }
  finally {
    await vscode.commands.executeCommand('mdReader.stop'); result.settingsUnchanged = cfg() === before;
    if (!result.settingsUnchanged) result.status = 'failed';
    result.finished = new Date().toISOString(); await save();
  }
};
