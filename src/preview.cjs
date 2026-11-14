'use strict';
const MarkdownIt = require('markdown-it');
const mathPlugin = require('./math.cjs');
const { parseMarkdown } = require('./markdown.cjs');

// 预览和朗读都使用原文行偏移，不根据渲染后的文字反向搜索。
function buildPreview(text, imageUri = () => undefined, readingBlocks = parseMarkdown(text).blocks) {
  const md = new MarkdownIt({ html: false, linkify: false }).use(mathPlugin);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const source = text.replace(/^(?:\uFEFF)?---[^\S\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\n]*(?:\r?\n|$)/, s => s.replace(/[^\r\n]/g, ' '));
  const tokens = md.parse(source, {}), sourceBlocks = [];
  const readable = new Map(readingBlocks.map(b => [`${b.from}:${b.to}`, b]));
  function sourceBlock(t, kind) {
    const from = starts[t.map[0]], to = starts[t.map[1]] ?? text.length;
    const block = { id: `${from}:${to}`, from, to, startLine: t.map[0] + 1, endLine: t.map[1], kind };
    sourceBlocks.push(block); return block;
  }
  function attributes(t, b) {
    t.attrSet('data-source-id', b.id); t.attrSet('data-source-start', String(b.startLine)); t.attrSet('data-source-end', String(b.endLine));
    const block = readable.get(b.id);
    if (block) {
      t.attrSet('data-read-block', b.id);
      if (['table', 'math'].includes(block.kind)) t.attrSet('data-read-atomic', 'true');
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (['math_block', 'fence', 'code_block', 'table_open'].includes(t.type) && t.map) {
      const b = sourceBlock(t, t.type); attributes(t, b);
      if (t.type === 'table_open') { t.attrSet('data-from', String(b.from)); t.attrSet('data-to', String(b.to)); }
      // 公式和图表作为整体复制源码，避免 KaTeX 双层 DOM 或 SVG 标签污染引用。
      if (t.type === 'math_block' || (t.type === 'fence' && t.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid')) {
        t.attrSet('data-copy-text', text.slice(b.from, b.to).replace(/\r?\n$/, ''));
      }
    }
    if (t.type === 'math_block' && t.map) {
      t.attrSet('data-from', String(starts[t.map[0]])); t.attrSet('data-to', String(starts[t.map[1]] ?? text.length));
    }
    if (t.type !== 'inline' || !t.map) continue;
    const from = starts[t.map[0]], to = starts[t.map[1]] ?? text.length;
    const b = sourceBlock(t, 'inline');
    const sourceOpen = new t.constructor('reader_source_open', 'span', 1), sourceClose = new t.constructor('reader_source_close', 'span', -1);
    attributes(sourceOpen, b); t.children = [sourceOpen, ...t.children, sourceClose];
    let open = tokens[i - 1];
    if (open?.hidden && tokens[i - 2]?.type === 'list_item_open') open = tokens[i - 2];
    if (!open || open.nesting !== 1) continue;
    open.attrSet('data-from', String(from)); open.attrSet('data-to', String(to));
    if (open.type === 'heading_open') { open.attrSet('data-heading', String(from)); open.attrSet('tabindex', '0'); }
  }
  const mathInline = md.renderer.rules.math_inline;
  md.renderer.rules.math_inline = (ts, i, ...args) => {
    const t = ts[i], original = t.markup + t.content + (t.markup === '\\(' ? '\\)' : '$');
    return `<span class="reader-math" data-copy-text="${md.utils.escapeHtml(original)}" data-read-text="${md.utils.escapeHtml('$' + t.content + '$')}">${mathInline(ts, i, ...args)}</span>`;
  };
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (ts, i, options, env, renderer) => {
    const t = ts[i];
    return t.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid'
      ? `<figure class="mermaid-block"${renderer.renderAttrs(t)}><div class="mermaid-diagram"><pre class="mermaid-source">${md.utils.escapeHtml(t.content)}</pre></div><figcaption class="diagram-status" role="status">正在绘制图表…</figcaption></figure>\n`
      : `<div${renderer.renderAttrs(t)}>${fence(ts, i, options, env, renderer)}</div>`;
  };
  const codeBlock = md.renderer.rules.code_block;
  md.renderer.rules.code_block = (ts, i, options, env, renderer) => `<div${renderer.renderAttrs(ts[i])}>${codeBlock(ts, i, options, env, renderer)}</div>`;
  md.renderer.rules.image = (ts, i) => {
    const t = ts[i], uri = imageUri(t.attrGet('src') || '');
    const alt = md.utils.escapeHtml(t.content || '图片');
    const reading = md.utils.escapeHtml(t.content || '');
    return uri ? `<img src="${md.utils.escapeHtml(uri)}" alt="${alt}" data-read-text="${reading}">` : `<span class="image-alt" data-read-text="${reading}">[${alt}]</span>`;
  };
  return { html: md.renderer.render(tokens, md.options, {}), sourceBlocks };
}
function renderPreview(text, imageUri) { return buildPreview(text, imageUri).html; }
module.exports = { renderPreview, buildPreview };
