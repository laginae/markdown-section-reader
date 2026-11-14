'use strict';
// Adapted from vscode-office/src/service/markdown/ext/markdown-it-katex.js
// Copyright (c) 2020 Weijan Chen. MIT; see vendor/licenses/vscode-office-LICENSE.
// 保留 inline/block token 与行号，供预览和朗读共享同一套公式边界。
function escaped(src, pos) {
  let n = 0; while (pos > 0 && src[--pos] === '\\') n++;
  return n % 2 === 1;
}
function mathInline(state, silent) {
  const start = state.pos, bracket = state.src.startsWith('\\(', start);
  if (!bracket && (state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || ' '))) return false;
  const open = bracket ? '\\(' : '$', close = bracket ? '\\)' : '$';
  let match = start + open.length;
  while ((match = state.src.indexOf(close, match)) !== -1) {
    if (!escaped(state.src, match) && (bracket || (!/\s/.test(state.src[match - 1]) && !/\d/.test(state.src[match + 1] || '')))) break;
    match += close.length;
  }
  if (match === -1 || match === start + open.length || state.src.slice(start, match).includes('\n\n')) return false;
  if (!silent) { const token = state.push('math_inline', 'math', 0); token.markup = open; token.content = state.src.slice(start + open.length, match); }
  state.pos = match + close.length; return true;
}
function mathBlock(state, start, end, silent) {
  const pos = state.bMarks[start] + state.tShift[start], line = state.src.slice(pos, state.eMarks[start]);
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const open = line.startsWith('$$') ? '$$' : line.startsWith('\\[') ? '\\[' : undefined;
  if (!open) return false;
  const close = open === '$$' ? '$$' : '\\]', first = line.slice(open.length);
  let next = start, last = '', content, found = first.trimEnd().endsWith(close) && !escaped(first.trimEnd(), first.trimEnd().length - close.length);
  if (found) content = first.trimEnd().slice(0, -close.length);
  else {
    for (next = start + 1; next < end; next++) {
      const offset = state.bMarks[next] + state.tShift[next], text = state.src.slice(offset, state.eMarks[next]);
      if ((text.trim() && state.tShift[next] < state.blkIndent) || /^#{1,6}(?:\s|$)/.test(text)) break;
      const trimmed = text.trimEnd();
      if (trimmed.endsWith(close) && !escaped(trimmed, trimmed.length - close.length)) { last = trimmed.slice(0, -close.length); found = true; break; }
    }
    if (!found) return false; // 不完整公式不能吞掉后续标题。
    content = (first.trim() ? first + '\n' : '') + state.getLines(start + 1, next, state.tShift[start], true) + last;
  }
  if (silent) return true;
  const token = state.push('math_block', 'math', 0);
  token.block = true; token.content = content; token.map = [start, next + 1]; token.markup = open;
  state.line = next + 1; return true;
}
let katex;
module.exports = function mathPlugin(md) {
  const render = (latex, displayMode) => {
    // Tokenizing an outline or speech plan does not need the rendering library.
    katex ||= require('katex');
    try { return katex.renderToString(latex, { displayMode, throwOnError: false, strict: false, trust: false,
      output: 'htmlAndMathml', maxExpand: 1000, maxSize: 20, macros: {} }); }
    catch { return `<code class="math-error">${md.utils.escapeHtml(latex)}</code>`; }
  };
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.after('blockquote', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (tokens, i) => render(tokens[i].content, false);
  md.renderer.rules.math_block = (tokens, i, options, env, renderer) => `<div class="math-block"${renderer.renderAttrs(tokens[i])}>${render(tokens[i].content, true)}</div>\n`;
};
