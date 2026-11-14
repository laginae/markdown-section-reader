'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module');
const { parseMarkdown, sectionAt } = require('../src/markdown.cjs');
const { makeReadingPlan, normalizeReadingSettings } = require('../src/speech-plan.cjs');
const { mathSpeech } = require('../vendor/cozy/academic-speech');
const { AudioCache } = require('../src/audio-preparation.cjs');
const plan = (text, settings = {}) => { const p = parseMarkdown(text); return makeReadingPlan(p, sectionAt(p, 0), 'from', settings); };
const joined = result => result.queue.map(part => part.text).join('').replace(/\s+/g, ' ').trim();

test('vendored reading modules match the pinned source manifest without machine-specific paths', () => {
  const manifest = require('../vendor/cozy-reading-provenance.json');
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/); assert.equal(manifest.modules.length, 13);
  assert.equal(manifest.sourceRepository, 'https://github.com/laginae/note-reader-cosyvoice');
  for (const entry of manifest.modules) {
    assert.match(entry.file, /^[a-z-]+\.js$/);
    const data = fs.readFileSync(path.join(__dirname, '../vendor/cozy', entry.file));
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.vendoredSha256, entry.file);
    if (!entry.adaptation) assert.equal(entry.sourceSha256, entry.vendoredSha256);
  }
});

test('the synthesis queue receives the updated short-formula pronunciation', () => {
  for (const [formula, expected] of [
    [String.raw`10^{-9}`, '10 的 负9 次方'], [String.raw`\underline f(x)`, 'f underbar of x'],
    [String.raw`\overline g(x)`, 'g bar of x'], [String.raw`\hat f(x_i)`, 'f hat of x i'],
    [String.raw`\alpha=5\%`, 'alpha 等于 百分之5'],
  ]) {
    const text = `示例公式 $${formula}$。`, result = plan(text);
    assert.ok(joined(result).includes(expected), formula);
    assert.ok(result.queue.every(part => part.ranges.every(range => text.slice(range.from, range.to).includes(formula))));
  }
});

test('function and interval preferences remain independent, opt-in and explicit-style safe', () => {
  assert.equal(normalizeReadingSettings().academicFunctionStyle, 'of');
  assert.equal(normalizeReadingSettings().academicIntervalStyle, 'precise');
  assert.equal(normalizeReadingSettings({ academicFunctionStyle: 'invalid' }).academicFunctionStyle, 'of');
  assert.match(joined(plan(String.raw`示例 $\overline f(x)$。`, { academicFunctionStyle: 'compact' })), /f bar x/);
  assert.match(joined(plan(String.raw`示例 $\overline f(x)$。`)), /f bar of x/);
  assert.match(joined(plan(String.raw`示例 $\overline f(x)$。`, { academicFunctionStyle: 'compact', academicMathStyle: 'verbose' })), /左括号 x 右括号/);
  assert.match(joined(plan(String.raw`区间 $x\in(0,1]$。`, { academicIntervalStyle: 'range' })), /x 属于 0 到 1/);
  assert.match(joined(plan(String.raw`区间 $x\in(0,1]$。`)), /不含 0，含 1/);
  assert.equal(mathSpeech(String.raw`\bar{f_i}(x)/\hat{g_i}(x)`, { academicFunctionStyle: 'compact' }), 'Formula.');
  assert.equal(mathSpeech('f(x)', { academicFunctionStyle: 'compact', academicMathMode: 'skip' }), 'Formula.');
});

test('speech options change audio cache identity only through the prepared text', () => {
  const text = 'The value of $f(x)$ is shown.', normal = joined(plan(text)), short = joined(plan(text, { academicFunctionStyle: 'compact' }));
  assert.match(short, /value of/); assert.match(normal, /f of x/); assert.match(short, /f x/);
  const cache = new AudioCache(), settings = { engine: 'system', systemVoice: 'Public voice' };
  assert.notEqual(cache.key(normal, settings), cache.key(short, settings));
});

test('Cozy preference import requests only allowlisted fields including both new choices', async () => {
  const filename = path.join(__dirname, '../src/speech.cjs'), loaded = { exports: {} }, localRequire = createRequire(filename);
  const profile = { speechEngine: 'system-tts', academicFunctionStyle: 'compact', academicIntervalStyle: 'range' };
  let code;
  new Function('require', 'module', 'exports', 'process', fs.readFileSync(filename, 'utf8'))(name => name === 'node:child_process'
    ? { execFile: (_file, args, _options, callback) => { code = args.at(-1); callback(null, 'MDR_PREFS:' + Buffer.from(JSON.stringify(profile)).toString('base64')); } }
    : localRequire(name), loaded, loaded.exports, { platform: 'win32', env: { LOCALAPPDATA: 'public-test' } });
  assert.deepEqual(await loaded.exports.readObsidianSpeechPreferences(), profile);
  assert.match(code, /academicFunctionStyle/); assert.match(code, /academicIntervalStyle/);
  assert.doesNotMatch(code, /secretStorage|readFile|vault\.read|JSON\.stringify\(s\)/);
});

test('outline parsing and extension loading do not initialize KaTeX until a formula is rendered', () => {
  const code = `const assert=require('node:assert/strict'),Module=require('node:module');
    const original=Module._load;let calls=0;Module._load=function(name,...rest){
      if(name==='vscode')return {};if(name==='katex')calls++;return original.call(this,name,...rest)};
    require('./src/extension.cjs');const {parseMarkdown}=require('./src/markdown.cjs');
    parseMarkdown('# Public example\\n\\nA value $f(x)$ follows.');assert.equal(calls,0);
    const {buildPreview}=require('./src/preview.cjs');buildPreview('No formulas.');assert.equal(calls,0);
    assert.match(buildPreview('$x_i$').html,/katex/);assert.equal(calls,1);console.log('lazy-renderer-ok');`;
  assert.equal(execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(), 'lazy-renderer-ok');
});
