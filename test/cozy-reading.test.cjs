'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown, sectionAt } = require('../src/markdown.cjs');
const { makeReadingPlan, spokenBlock, normalizeReadingSettings } = require('../src/speech-plan.cjs');
const { buildPreview } = require('../src/preview.cjs');
const plan = (text, settings = {}) => { const p = parseMarkdown(text); return makeReadingPlan(p, sectionAt(p, 0), 'from', settings); };
const compact = text => text.replace(/\s/g, '');

test('Cozy 公式和文献读法真正进入合成队列，源码位置保持不变', () => {
  const text = '# 测试\r\n\r\n这一项为 $\\frac{1}{2}$，见文献[1-3]。\r\n\r\nThe value $x_i \\leq 0.95$ holds.\r\n';
  const result = plan(text), speech = result.queue.map(p => p.text).join('');
  assert.match(speech, /2 分之 1/); assert.match(speech, /文献1到3/); assert.match(speech, /less than or equal to/);
  assert.doesNotMatch(speech, /\\frac|\\leq/);
  const original = parseMarkdown(text).blocks;
  for (const part of result.queue) for (const range of part.ranges) assert.ok(original.some(b => b.from === range.from && b.to === range.to));
  assert.ok(text.includes('$\\frac{1}{2}$'));
});

test('复杂公式的提示和略过可配置，简短公式支持详读下标', () => {
  assert.match(plan('计算为 $\\sum_{i=1}^n x_i$。').queue.map(x => x.text).join(''), /公式/);
  const skipped = plan('前文。\n\n$$\\sum_{i=1}^n x_i$$\n\n后文。', { academicMathMode: 'skip', academicSkipNotice: false });
  assert.equal(compact(skipped.queue.map(x => x.text).join('')), '前文。后文。');
  assert.match(plan('变量为 $x_i$。', { academicMathStyle: 'verbose' }).queue.map(x => x.text).join(''), /下标/);
});

test('表格按列名朗读，略过提示和预览高亮都对应整张原表', () => {
  const text = '# 表格\n\n| 指标 | 数值 |\n|---|---|\n| 风险 | 0.25 |\n';
  const result = plan(text, { academicTableMode: 'all' });
  assert.match(result.queue.map(p => p.text).join(''), /指标[:：]\s*风险[;；]\s*数值[:：]\s*0.25/);
  const table = parseMarkdown(text).blocks.find(b => b.kind === 'table');
  assert.ok(result.queue.flatMap(p => p.ranges).some(r => r.from === table.from && r.to === table.to));
  assert.ok(buildPreview(text).html.includes(`data-from="${table.from}" data-to="${table.to}"`));
  assert.match(plan(text, { academicTableMode: 'skip' }).queue.map(p => p.text).join(''), /表格数据略过/);
});

test('术语按完整词替换而不改原文，不递归替换，错误规则阻止发送', () => {
  const text = '使用 CVaR 和 CVaR2，CVaR 再次出现。';
  const settings = { speechTermsEnabled: true, speechTerms: 'CVaR=条件风险价值\n条件风险价值=不应再次替换' };
  const speech = plan(text, settings).queue.map(x => x.text).join('');
  assert.equal((speech.match(/条件风险价值/g) || []).length, 2); assert.match(speech, /CVaR2/); assert.doesNotMatch(speech, /不应/);
  assert.throws(() => plan(text, { speechTermsEnabled: true, speechTerms: '错误规则' }), /术语/);
  assert.equal(text, '使用 CVaR 和 CVaR2，CVaR 再次出现。');
});

test('合并短标题与正文，长文和重复段落不漏读、不重复，所有音频保留源块映射', () => {
  const text = '# 标题\n\n' + ('同样的段落包含中文、English words 和😀。'.repeat(12) + '\n\n').repeat(5);
  const parsed = parseMarkdown(text), settings = normalizeReadingSettings({ chunkLimit: 400 });
  const expected = parsed.blocks.map(b => spokenBlock(b, settings)).join('');
  const result = plan(text, settings);
  assert.equal(compact(result.queue.map(x => x.text).join('')), compact(expected));
  assert.ok(result.queue.every(p => p.text.length <= 400 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.text)));
  assert.ok(result.queue.some(p => p.ranges.length > 1));
  const covered = new Set(result.queue.flatMap(p => p.ranges.map(r => r.from)));
  assert.ok(parsed.blocks.every(b => covered.has(b.from)));
});

test('只读本节包括子节，缓冲队列不会包含下一同级节；不读代码和元数据', () => {
  const text = '---\nsecret: ignored\n---\n# 文档\n## A\n正文。\n### 子节\n子节正文。\n```js\nthrow new Error("不读");\n```\n## B\n范围之外。';
  const parsed = parseMarkdown(text), section = parsed.headings[1];
  const result = makeReadingPlan(parsed, section, 'section', { buffering: 'continuous' });
  assert.doesNotMatch(result.queue.map(p => p.text).join(''), /范围之外|secret|不读/);
  assert.match(result.queue.map(p => p.text).join(''), /子节正文/);
  assert.ok(result.queue.every(p => p.ranges.every(r => r.from >= section.from && r.to <= section.to)));
});

test('快启以完整句子结束，关闭快启不会强加开头分片', () => {
  const text = '这是一个包含足够多文字的完整开头句子，用于验证起播。随后是第二句，用来验证语音能够连贯衔接。最后还有一段收尾文字。';
  const fast = plan(text, { quickStart: 'standard', buffering: 'balanced' });
  assert.ok(fast.queue[0].text.endsWith('。')); assert.ok(fast.queue.length > 1);
  const off = plan(text, { quickStart: 'off', buffering: 'balanced' });
  assert.equal(off.queue.length, 1); assert.equal(off.queue[0].text, text);
});
