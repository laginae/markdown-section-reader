'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { JSDOM } = require('jsdom');
const { readerHost, deferred, tick } = require('./helpers/reader-host.cjs');

test('concurrent starts share voice discovery, only the latest start synthesizes, and timing includes preparation', async t => {
  const voices = deferred(), f = readerHost({ voices: () => voices.promise }); t.after(() => f.dispose());
  const first = f.api.startReading('from'); await tick(); assert.equal(f.calls.voices, 1);
  const second = f.api.startReading('from'); await tick(); assert.equal(f.calls.voices, 1);
  await new Promise(resolve => setTimeout(resolve, 25));
  voices.resolve([{ id: 'Public voice', language: 'en' }]);
  await Promise.all([first, second]); await tick();
  assert.equal(f.calls.syntheses, 1); assert.equal(f.errors.length, 0);
  const audio = f.messages.findLast(message => message.type === 'audio'); assert.ok(audio);
  await f.receive({ type: 'playing', token: audio.token });
  const state = f.api.getState();
  assert.equal(state.state, 'playing');
  assert.equal(state.session.diagnostics.timings.textPreparation.count, 1);
  assert.ok(state.session.diagnostics.timings.firstAudio.p50 >= 20);
  assert.ok(state.session.diagnostics.timings.audioLoadToPlaying.p50 < state.session.diagnostics.timings.firstAudio.p50);
});

test('stopping a start awaiting the view prevents stale text preparation and voice queries', async t => {
  const viewGate = deferred(), f = readerHost({ viewGate }); t.after(() => f.dispose());
  const start = f.api.startReading('from'); await tick();
  await f.commands.get('mdReader.stop')(); viewGate.resolve(); await start;
  assert.equal(f.calls.plans, 0); assert.equal(f.calls.voices, 0); assert.equal(f.calls.syntheses, 0);
  assert.equal(f.api.getState().state, 'idle');
});

test('failed voice discovery can be retried without leaving a rejected discovery cached', async t => {
  let count = 0;
  const f = readerHost({ voices: async () => { if (!count++) throw new Error('Public simulated failure.'); return [{ id: 'Public voice', language: 'en' }]; } });
  t.after(() => f.dispose());
  await f.api.startReading('from'); assert.equal(f.api.getState().state, 'error');
  await f.api.startReading('from'); await tick();
  assert.equal(f.calls.voices, 2); assert.equal(f.calls.syntheses, 1);
});

test('changing formula preferences while voice discovery is pending cancels the outdated start', async t => {
  const voices = deferred(), f = readerHost({ voices: () => voices.promise }); t.after(() => f.dispose());
  const start = f.api.startReading('from'); await tick();
  f.values.academicFunctionStyle = 'compact';
  f.events.configuration({ affectsConfiguration: key => ['mdReader', 'mdReader.academicFunctionStyle'].includes(key) });
  voices.resolve([{ id: 'Public voice', language: 'en' }]); await start; await tick();
  assert.equal(f.calls.syntheses, 0); assert.equal(f.api.getState().state, 'idle');
  assert.equal(f.api.getState().session, null);
});

test('live rate and volume changes during voice discovery are applied without resynthesis', async t => {
  const voices = deferred(), f = readerHost({ voices: () => voices.promise }); t.after(() => f.dispose());
  const start = f.api.startReading('from'); await tick();
  f.values.speed = 1.75; f.values.volume = 0.4;
  f.events.configuration({ affectsConfiguration: key => ['mdReader', 'mdReader.speed', 'mdReader.volume'].includes(key) });
  voices.resolve([{ id: 'Public voice', language: 'en' }]); await start; await tick();
  const audio = f.messages.findLast(message => message.type === 'audio');
  assert.equal(audio.speed, 1.75); assert.equal(audio.volume, 0.4); assert.equal(f.calls.syntheses, 1);
});

test('new controls save only validated application preferences and import the same Cozy choices', async t => {
  const f = readerHost({ profile: { speechEngine: 'system-tts', academicFunctionStyle: 'compact', academicIntervalStyle: 'range' } });
  t.after(() => f.dispose()); await f.open();
  for (const [name, value] of [['academicMathStyle', 'verbose'], ['academicFunctionStyle', 'compact'], ['academicIntervalStyle', 'range']]) {
    await f.receive({ type: 'setting', name, value }); assert.equal(f.values[name], value);
    await f.receive({ type: 'setting', name, value: 'invalid' }); assert.equal(f.values[name], value);
  }
  assert.equal(f.calls.writes.length, 3); assert.ok(f.calls.writes.every(write => write.target === 1));
  await f.commands.get('mdReader.importCozySettings')();
  assert.equal(f.values.academicFunctionStyle, 'compact'); assert.equal(f.values.academicIntervalStyle, 'range');
  const dom = new JSDOM(f.view.webview.html, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const win = dom.window, sent = [];
  win.acquireVsCodeApi = () => ({ setState() {}, postMessage: message => sent.push(message) });
  win.MarkdownReaderPlayer = () => ({ prime() {}, resume() {}, handle() {} });
  win.eval(fs.readFileSync(path.join(__dirname, '../media/reader.js'), 'utf8'));
  win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'state', ...f.api.getState() } }));
  const input = win.document.getElementById('academicFunctionStyle'); assert.equal(input.value, 'compact');
  input.value = 'of'; input.dispatchEvent(new win.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'setting', name: 'academicFunctionStyle', value: 'of' });
});
