'use strict';

// 偏移基于当前源码块的可朗读文本，不在全文中搜索选中文字。
function readingText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().replace(/^\[[ xX]\](?:\s+|$)/, '');
}

function resolveReadingPosition(parsed, sourceBlocks, target) {
  if (!target || typeof target.blockId !== 'string' || typeof target.prefix !== 'string' || target.prefix.length > 200000) throw new Error('请重新选择朗读起点。');
  const reference = sourceBlocks.find(b => b.id === target.blockId);
  const block = reference && parsed.blocks.find(b => b.from === reference.from && b.to === reference.to);
  if (!block) throw new Error('当前位置没有可朗读的正文，请重新选择。');
  const source = readingText(block.speechSource ?? block.text), atomic = ['table', 'math'].includes(block.kind);
  const prefix = atomic ? '' : readingText(target.prefix);
  if (!source.startsWith(prefix)) throw new Error('选区与当前正文无法准确对齐，请重新选择，或在该段落中直接右键。');
  let offset = prefix.length;
  if (/[\uD800-\uDBFF]/.test(source[offset - 1] || '') && /[\uDC00-\uDFFF]/.test(source[offset] || '')) offset--;
  return { blockId: reference.id, from: block.from, offset, startLine: reference.startLine, kind: block.kind };
}

module.exports = { readingText, resolveReadingPosition };
