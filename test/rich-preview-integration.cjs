'use strict';
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const ext = vscode.extensions.getExtension('local-tools.markdown-section-reader'), api = await ext.activate();
  const result = { started: new Date().toISOString(), version: ext.packageJSON.version, installedPath: ext.extensionPath,
    testedVsixSha256: JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'))).sha256, checks: [], status: 'running' };
  const save = () => fs.writeFile(path.join(root, 'qa/rich-preview-integration.json'), JSON.stringify(result, null, 2) + '\n');
  const ok = async (name, fields = {}) => { result.checks.push({ name, passed: true, ...fields }); await save(); };
  async function until(fn, timeout = 120000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (api.getState().state === 'error') throw new Error(api.getState().detail); if (fn()) return; await wait(80); }
    throw new Error('Rich preview check timed out');
  }
  const cfg = vscode.workspace.getConfiguration('mdReader'), oldEngine = cfg.inspect('engine')?.globalValue;
  try {
    await save();
    const d = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'qa/公式图表验证.md')));
    await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('mdReader.openPreview');
    await until(() => api.getState().preview.headings === 5);
    const formula = api.getState().headings[1], after = api.getState().headings[3], mimo = api.getState().headings[4];
    await api.jump(after.id); // 在 Mermaid 异步绘图完成之前请求跳转。
    await until(() => api.getState().preview.renderComplete);
    let p = api.getState().preview;
    assert.equal(p.diagrams, 2); assert.equal(p.diagramErrors, 0); assert.equal(p.mathErrors, 0); assert.ok(p.formulas >= 5); assert.equal(p.fontsReady, true);
    await ok('KaTeX formulas and local fonts load; two Mermaid diagrams become SVG', { preview: p });
    assert.equal(p.revealed, after.id); assert.equal(p.revealedInViewport, true);
    await ok('heading after async diagrams remains visible after diagram layout changes');
    await api.jump(formula.id); await until(() => api.getState().preview.revealed === formula.id);
    assert.equal(api.getState().preview.revealedInViewport, true); await ok('formula in heading retains exact outline target');
    await cfg.update('engine', 'system', vscode.ConfigurationTarget.Global);
    await api.startReading('section', formula.id);
    const segments = [], observed = new Set();
    while (api.getState().state !== 'complete') {
      await until(() => ['playing', 'complete'].includes(api.getState().state));
      const s = api.getState(); if (s.state === 'complete') break;
      const key = `${s.session.id}:${s.session.index}`;
      if (!observed.has(key)) {
        await until(() => api.getState().preview.highlighted === s.session.current.from);
        const raw = d.getText().slice(s.session.current.from, s.session.current.to);
        segments.push({ index: s.session.index, from: s.session.current.from, formula: /\$|\\\[/.test(raw), inViewport: api.getState().preview.highlightedInViewport }); observed.add(key);
      }
      await wait(100);
    }
    assert.equal(api.getState().session.to, after.from); assert.ok(segments.filter(s => s.formula).length >= 4); assert.ok(segments.every(s => s.inViewport));
    await ok('every actual system-audio segment matches its original paragraph, including display equations', { segments });
    await until(() => api.getState().preview.highlighted === null); await ok('section stops before next peer heading and removes highlight');
    await cfg.update('engine', 'mimo', vscode.ConfigurationTarget.Global);
    await api.startReading('section', mimo.id);
    await until(() => api.getState().state === 'playing' && api.getState().session.index === 1);
    await until(() => api.getState().preview.highlighted === api.getState().session.current.from);
    await ok('MiMo audio highlights the paragraph containing inline LaTeX');
    await until(() => api.getState().state === 'complete');
    await cfg.update('engine', 'system', vscode.ConfigurationTarget.Global);
    const scratch = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# 容错验证\n\n$\\frac{a}{b$\n\n```mermaid\nthis is invalid Mermaid\n```\n\n## 后续章节\n\n后续内容仍应可以导航与高亮。' });
    let ed = await vscode.window.showTextDocument(scratch, { viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('mdReader.openPreview'); await until(() => api.getState().preview.renderComplete);
    p = api.getState().preview; assert.equal(p.mathErrors, 1); assert.equal(p.diagramErrors, 1); assert.equal(p.headings, 2);
    const next = api.getState().headings[1]; await api.jump(next.id); await until(() => api.getState().preview.revealed === next.id);
    await ok('invalid math and Mermaid preserve source and do not break later heading navigation');
    await api.startReading('section', next.id); await until(() => api.getState().state === 'playing');
    await until(() => api.getState().preview.highlighted === api.getState().session.current.from);
    await ok('audio and highlight still work after a render error');
    ed = await vscode.window.showTextDocument(scratch, { viewColumn: vscode.ViewColumn.One });
    await ed.edit(e => e.insert(new vscode.Position(0, 0), '# 新标题\n\n'));
    await until(() => api.getState().state === 'idle' && api.getState().preview.renderComplete && api.getState().preview.headings === 3);
    assert.equal(api.getState().session, null); await ok('editing stops audio and rebuilds formula, diagram, and heading mappings');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.One }); await vscode.commands.executeCommand('mdReader.openPreview');
    await until(() => api.getState().preview.renderComplete && api.getState().preview.headings === 5);
    await api.jump(formula.id); result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.error = e.stack; throw e; }
  finally {
    await vscode.commands.executeCommand('mdReader.stop'); await cfg.update('engine', oldEngine, vscode.ConfigurationTarget.Global);
    result.finished = new Date().toISOString(); result.state = api.getState(); await save();
  }
};
