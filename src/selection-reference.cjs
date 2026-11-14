'use strict';
// 只接受当前预览实际渲染过的源码块，不根据可见文字全局搜索。
function resolveReference(sourceBlocks, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || ids.some(id => typeof id !== 'string' || id.length > 64)) return;
  const index = new Map(sourceBlocks.map(b => [b.id, b])), selected = [...new Set(ids)].map(id => index.get(id));
  if (selected.some(b => !b)) return;
  return { from: Math.min(...selected.map(b => b.from)), to: Math.max(...selected.map(b => b.to)),
    startLine: Math.min(...selected.map(b => b.startLine)), endLine: Math.max(...selected.map(b => b.endLine)), blockCount: selected.length };
}
function nativeCodeSelection(document, reference) {
  const { startLine, endLine } = reference;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > document.lineCount) throw new Error('选区行号已失效，请重新选择。');
  const lastColumn = document.lineAt(endLine - 1).text.length + 1;
  // TextDocument.offsetAt 要求宿主生成的 Position 实例。
  const rawText = document.getText().slice(document.offsetAt(document.lineAt(startLine - 1).range.start), document.offsetAt(document.lineAt(endLine - 1).range.end));
  return { uri: document.uri, range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: lastColumn,
    selectionStartLineNumber: startLine, selectionStartColumn: 1, positionLineNumber: endLine, positionColumn: lastColumn },
    rawText, text: '```markdown\n' + rawText + '\n```' };
}
const MAX_SELECTION_CHARS = 200000;
function selectionText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请先在朗读预览中选中要复制的内容。');
  if (text.length > MAX_SELECTION_CHARS) throw new Error('选中内容过长，请缩小范围后复制。');
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}
function clipboardReference(filePath, reference, text) {
  if (typeof filePath !== 'string' || !filePath || /[\r\n\0]/.test(filePath)) throw new Error('当前文档路径不可用于引用。');
  const { startLine, endLine } = reference || {};
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) throw new Error('选区行号已失效，请重新选择。');
  const normalized = filePath.replace(/\\/g, '/');
  const target = /[\s"<>]/.test(normalized) ? JSON.stringify(normalized) : normalized;
  const lines = startLine === endLine ? `line:${startLine}` : `lines:${startLine}-${endLine}`;
  return `@${target} ${lines}\n选中内容：\n` + selectionText(text).split('\n').map(line => `> ${line}`).join('\n');
}
module.exports = { resolveReference, nativeCodeSelection, selectionText, clipboardReference, MAX_SELECTION_CHARS };
