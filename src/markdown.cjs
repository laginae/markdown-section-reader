'use strict';
const MarkdownIt = require('markdown-it');
const { maskMarkdownNonSpeech } = require('../vendor/cozy/markdown-syntax');
const { chooseChunkCut } = require('../vendor/core/src/semantic-chunker');
const mathPlugin = require('./math.cjs');
const md = new MarkdownIt({ html: false, linkify: false }).use(mathPlugin);

function inlineText(children = [], preserveMath = false) {
  return children.map(t => {
    if (t.type === 'image') return t.content || '';
    if (t.type === 'softbreak' || t.type === 'hardbreak') return ' ';
    if (t.type === 'math_inline' && preserveMath) return '$' + t.content + '$';
    return ['text', 'code_inline', 'math_inline'].includes(t.type) ? t.content : '';
  }).join('').replace(/^\[[ xX]\]\s+/, '').trim();
}

function parseMarkdown(text) {
  // 掩掉不朗读的内容而保留字符位置；行号始终指向编辑器里的原文。
  let masked = maskMarkdownNonSpeech(text);
  masked = masked.replace(/^(?:\uFEFF)?---[^\S\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\n]*(?:\r?\n|$)/,
    s => s.replace(/[^\r\n]/g, ' '));
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const tokens = md.parse(masked, {}), headings = [], blocks = [];
  tokens.forEach((t, i) => {
    if (t.type === 'table_open' && t.map) {
      const rows = []; let row;
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'table_close'; j++) {
        if (tokens[j].type === 'tr_open') rows.push(row = []);
        if (tokens[j].type === 'inline' && row) row.push(inlineText(tokens[j].children, true));
      }
      blocks.push({ kind: 'table', text: rows.flat().join(' '), headers: rows[0] || [], rows: rows.slice(1),
        from: starts[t.map[0]], to: starts[t.map[1]] ?? text.length, line: t.map[0], endLine: t.map[1] });
      return;
    }
    if (!['inline', 'math_block'].includes(t.type) || !t.map) return;
    const speech = t.type === 'math_block' ? t.content.trim() : inlineText(t.children);
    if (!speech) return;
    const from = starts[t.map[0]], to = starts[t.map[1]] ?? text.length;
    const open = tokens[i - 1];
    blocks.push({ text: speech, speechSource: t.type === 'math_block' ? '$$' + t.content.trim() + '$$' : inlineText(t.children, true),
      kind: t.type === 'math_block' ? 'math' : open?.type === 'heading_open' ? 'heading' : 'paragraph',
      from, to, line: t.map[0], endLine: t.map[1] });
    if (open?.type === 'heading_open') headings.push({
      id: String(from), title: speech, level: Number(open.tag.slice(1)), from, line: t.map[0]
    });
  });
  // 与 Cozy 的 outlineSections 相同：本节包含子节，在下一个同级或更高级标题前结束。
  headings.forEach((h, i) => { h.to = headings.slice(i + 1).find(n => n.level <= h.level)?.from ?? text.length; });
  return { headings, blocks, length: text.length };
}

function sectionAt(parsed, offset) {
  return parsed.headings.filter(h => h.from <= offset).at(-1) || { id: 'intro', title: '文档开头', from: 0, to: parsed.headings[0]?.from ?? parsed.length, level: 0, line: 0 };
}

function makeQueue(parsed, section, mode, limit = 200) {
  const end = mode === 'from' ? parsed.length : section.to;
  return parsed.blocks.filter(b => b.from >= section.from && b.from < end).flatMap(b => {
    const chunks = []; let rest = b.text;
    while (rest) {
      let cut = rest.length <= limit ? rest.length : chooseChunkCut(rest, limit);
      // 不拆开 UTF-16 代理对。
      if (cut < rest.length && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
      cut = Math.max(1, cut);
      const text = rest.slice(0, cut).trim(); rest = rest.slice(cut).trimStart();
      if (text) chunks.push({ ...b, text });
    }
    return chunks;
  });
}
module.exports = { parseMarkdown, sectionAt, makeQueue };
