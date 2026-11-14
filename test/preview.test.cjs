'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { renderPreview } = require('../src/preview.cjs');
const { parseMarkdown } = require('../src/markdown.cjs');
test('预览按原文偏移映射重复标题、CRLF、列表和引用', () => {
  const text = '---\r\na: b\r\n---\r\n# 同名\r\n\r\n第一段。\r\n\r\n- 列表内容\r\n\r\n> 引用内容\r\n\r\n# 同名\r\n\r\n末段。';
  const html = renderPreview(text), parsed = parseMarkdown(text);
  for (const b of parsed.blocks) assert.ok(html.includes(`data-from="${b.from}" data-to="${b.to}"`), JSON.stringify(b));
  for (const h of parsed.headings) assert.ok(html.includes(`data-heading="${h.id}"`));
  assert.equal((html.match(/data-heading=/g) || []).length, 2); assert.ok(!html.includes('a: b'));
});
test('预览不执行原文 HTML，也不自动加载网络图片', () => {
  const html = renderPreview('# 测试\n\n<script>alert(1)</script>\n\n![图](https://example.org/track.png)\n\n[坏链接](javascript:alert(1))');
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('href="javascript:'));
});
test('本地图片地址经过转义；代码与表格仍可预览', () => {
  const html = renderPreview('![图](a.png)\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |', () => 'safe://image?a="b"');
  assert.ok(html.includes('src="safe://image?a=&quot;b&quot;"')); assert.match(html, /<table(?:\s|>)/); assert.ok(html.includes('<pre><code'));
});
