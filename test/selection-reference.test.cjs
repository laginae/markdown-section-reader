'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildPreview } = require('../src/preview.cjs');
const { resolveReference, nativeCodeSelection, clipboardReference, MAX_SELECTION_CHARS } = require('../src/selection-reference.cjs');
function documentOf(text) {
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  return { uri: 'file:///fixture.md', lineCount: starts.length, getText: () => text,
    offsetAt: p => { assert.ok(p instanceof Position); return starts[p.line] + p.character; }, lineAt: line => { const s = text.slice(starts[line], starts[line + 1] ?? text.length).replace(/\r?\n$/, ''); return { text: s, range: { start: new Position(line, 0), end: new Position(line, s.length) } }; } };
}
test('预览引用保留原文件行范围和 Markdown，不按渲染文字搜索', () => {
  const text = '# 标题\r\n\r\n重复文字\r\n\r\n## 下一节\r\n\r\n重复文字与 **强调**\r\n第二行 [链接](https://example.org)\r\n';
  const { html, sourceBlocks } = buildPreview(text), block = sourceBlocks.find(b => b.startLine === 7);
  assert.ok(html.includes(`data-source-id="${block.id}"`));
  const ref = resolveReference(sourceBlocks, [block.id]); assert.equal(ref.startLine, 7); assert.equal(ref.endLine, 8);
  const native = nativeCodeSelection(documentOf(text), ref);
  assert.equal(native.range.selectionStartLineNumber, 7); assert.equal(native.range.positionLineNumber, 8);
  assert.equal(native.rawText, '重复文字与 **强调**\r\n第二行 [链接](https://example.org)');
});
test('公式、图表、代码和表格都可引用对应源码块', () => {
  const text = '# 标题\n\n$$ x^2 $$\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  const { sourceBlocks } = buildPreview(text);
  assert.deepEqual(sourceBlocks.map(b => b.kind), ['inline', 'math_block', 'fence', 'fence', 'table_open']);
  for (const block of sourceBlocks) { const n = nativeCodeSelection(documentOf(text), resolveReference(sourceBlocks, [block.id])); assert.ok(n.rawText.length); }
  const both = resolveReference(sourceBlocks, [sourceBlocks[1].id, sourceBlocks[2].id]);
  assert.equal(both.startLine, 3); assert.equal(both.endLine, 8);
});
test('不存在的源码块、空选区和失效行号被拒绝', () => {
  const { sourceBlocks } = buildPreview('# 标题\n\n正文');
  assert.equal(resolveReference(sourceBlocks, []), undefined); assert.equal(resolveReference(sourceBlocks, ['9:9999']), undefined);
  assert.equal(resolveReference(sourceBlocks, [sourceBlocks[0].id, 'invalid']), undefined);
  assert.throws(() => nativeCodeSelection(documentOf('文本'), { startLine: 1, endLine: 2 }));
});
test('通用引用复制实际片段、相对路径和行范围，正文换行和引号保持可读', () => {
  const ref = { startLine: 7, endLine: 8 };
  assert.equal(clipboardReference('docs/公式图表验证.md', ref, '加粗文字\r\n第二行有 "链接文字"'),
    '@docs/公式图表验证.md lines:7-8\n选中内容：\n> 加粗文字\n> 第二行有 "链接文字"');
  assert.equal(clipboardReference('D:\\My Notes\\公式.md', { startLine: 12, endLine: 14 }, '$$\nE = mc^2\n$$'),
    '@"D:/My Notes/公式.md" lines:12-14\n选中内容：\n> $$\n> E = mc^2\n> $$');
});
test('相同文字的复制行号取自所在源码块，单行片段不扩展成整段', () => {
  const { sourceBlocks } = buildPreview('# 标题\n\n重复文字在第一段。\n\n重复文字在第二段。');
  const ref = resolveReference(sourceBlocks, [sourceBlocks.at(-1).id]);
  assert.equal(clipboardReference('验证.md', ref, '重复文字'), '@验证.md line:5\n选中内容：\n> 重复文字');
  assert.throws(() => clipboardReference('验证.md', ref, ' '.repeat(3)));
  assert.throws(() => clipboardReference('验证.md', ref, '字'.repeat(MAX_SELECTION_CHARS + 1)));
  assert.throws(() => clipboardReference('bad\nname.md', ref, '文字'));
});
test('公式和图表复制属性保留原始定界符、Markdown 围栏和转义安全', () => {
  const { html } = buildPreview('行内 $x<y$ 与 \\(a^2\\)。\n\n\\[\nx<y\n\\]\n\n```mermaid\nflowchart LR\n A["<文字>"] --> B\n```');
  assert.ok(html.includes('data-copy-text="$x&lt;y$"'));
  assert.ok(html.includes('data-copy-text="\\(a^2\\)"'));
  assert.ok(html.includes('data-copy-text="\\[\nx&lt;y\n\\]"'));
  assert.ok(html.includes('data-copy-text="```mermaid\nflowchart LR\n A[&quot;&lt;文字&gt;&quot;] --&gt; B\n```"'));
});
