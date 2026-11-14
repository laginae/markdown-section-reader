'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown, sectionAt, makeQueue } = require('../src/markdown.cjs');
test('本节包含子节，但不越过下一同级标题；从本节读到末尾', () => {
  const text = '# 文档\n\n## A\n正文 A\n### 子节\n子节正文\n## B\n正文 B\n';
  const p = parseMarkdown(text), a = p.headings[1];
  assert.equal(a.to, text.indexOf('## B'));
  assert.deepEqual(makeQueue(p, a, 'section').map(x => x.text), ['A', '正文 A', '子节', '子节正文']);
  assert.equal(makeQueue(p, a, 'from').at(-1).text, '正文 B');
});
test('排除 YAML、代码块和注释中的伪标题；支持 Setext 与 CRLF', () => {
  const text = '---\r\n# 元数据\r\n---\r\n标题\r\n====\r\n\r\n```md\r\n# 假标题\r\n```\r\n<!--\r\n# 注释\r\n-->\r\n## 真标题\r\n内容';
  const p = parseMarkdown(text);
  assert.deepEqual(p.headings.map(h => h.title), ['标题', '真标题']);
  assert.equal(p.headings[1].from, text.indexOf('## 真标题')); assert.equal(p.headings[1].line, 12);
});
test('标题前正文和无标题文档可朗读', () => {
  let p = parseMarkdown('引言\n\n# 一\n正文');
  assert.deepEqual(makeQueue(p, sectionAt(p, 0), 'section').map(x => x.text), ['引言']);
  p = parseMarkdown('没有标题。\n\n第二段。');
  assert.equal(makeQueue(p, sectionAt(p, 0), 'section').length, 2);
});
test('重复标题拥有不同位置，标题降级仍正确结束', () => {
  const p = parseMarkdown('## 同名\n甲\n### 同名\n乙\n# 同名\n丙');
  assert.equal(new Set(p.headings.map(h => h.id)).size, 3);
  assert.equal(p.headings[1].to, p.headings[2].from);
  assert.equal(sectionAt(p, p.headings[1].from + 6).id, p.headings[1].id);
});
test('朗读清理格式和链接地址，保留文字；原文范围不变', () => {
  const text = '# **标题**\n\n这是[链接](https://example.invalid)和`代码`。\n';
  const p = parseMarkdown(text), q = makeQueue(p, p.headings[0], 'section');
  assert.equal(q[1].text, '这是链接和代码。');
  assert.equal(text.slice(q[1].from, q[1].to), '这是[链接](https://example.invalid)和`代码`。\n');
});
test('长段拆分不切断代理对，所有片段高亮原段落', () => {
  const text = '# A\n\n' + '测试😀。'.repeat(150);
  const p = parseMarkdown(text), q = makeQueue(p, p.headings[0], 'section', 41).slice(1);
  assert.ok(q.length > 10);
  assert.ok(q.every(c => c.text.length <= 41 && c.from === 5 && c.to === text.length));
  assert.ok(q.every(c => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(c.text)));
  assert.equal(q.map(c => c.text).join(''), '测试😀。'.repeat(150));
});
test('内容只作为文字，不执行 Markdown HTML', () => {
  const p = parseMarkdown('# <img src=x onerror=alert(1)>\n\n<script>bad()</script>');
  assert.equal(p.headings.length, 1); assert.ok(p.headings[0].title.includes('onerror'));
});
