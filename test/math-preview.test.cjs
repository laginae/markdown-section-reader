'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { renderPreview } = require('../src/preview.cjs');
const { parseMarkdown, makeQueue } = require('../src/markdown.cjs');
test('行内与块级公式渲染，原文段落及公式偏移与朗读一致', () => {
  const text = '## 能量 $E=mc^2$\r\n\r\n正文包含 $x_1$ 和 \\(y^2\\)。\r\n\r\n$$\r\n\\frac{a}{b} = c\r\n$$\r\n\r\n\\[\r\n\\sum_{i=1}^{n} x_i\r\n\\]\r\n\r\n## 后续\r\n公式后的正文。';
  const p = parseMarkdown(text), html = renderPreview(text);
  assert.equal((html.match(/class="katex"/g) || []).length, 5);
  assert.ok(!html.includes('katex-error')); assert.equal(p.headings.length, 2);
  for (const b of p.blocks) assert.ok(html.includes(`data-from="${b.from}" data-to="${b.to}"`), JSON.stringify(b));
  for (const h of p.headings) assert.ok(html.includes(`data-heading="${h.id}"`));
  assert.equal(makeQueue(p, p.headings[0], 'section').at(-1).text, '\\sum_{i=1}^{n} x_i');
});
test('公式不修改代码、转义美元、价格和图表后的章节边界', () => {
  const text = '# A\n\n`$literal$` 与 \\$5、$10。\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n## B\n正文';
  const html = renderPreview(text), p = parseMarkdown(text);
  assert.ok(!html.includes('class="katex"')); assert.ok(html.includes('mermaid-diagram'));
  assert.equal(p.headings[1].from, text.indexOf('## B')); assert.ok(!makeQueue(p, p.headings[0], 'section').some(b => /flowchart|-->/i.test(b.text)));
});
test('不完整或错误公式保留后续目录，并安全显示原文', () => {
  const text = '# A\n\n$$\n\\frac{a}{\n\n## B\n后续正文';
  const html = renderPreview(text), p = parseMarkdown(text);
  assert.equal(p.headings.length, 2); assert.ok(html.includes(`data-heading="${p.headings[1].id}"`));
  const malformed = renderPreview('$\\frac{<img src=x onerror=alert(1)>}{a$');
  assert.ok(malformed.includes('katex-error')); assert.ok(!malformed.includes('<img'));
});
test('公式禁止外部资源；Mermaid 源码仅转义后交给本地绘图', () => {
  const html = renderPreview('$\\includegraphics{https://example.org/track.png}$\n\n```mermaid\nflowchart LR\n A["</pre><script>alert(1)</script>"]\n```');
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
});
