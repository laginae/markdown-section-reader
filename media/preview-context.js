'use strict';
globalThis.MarkdownReaderPreviewContext = ({ content, send, player }) => {
  let generation = 0, sequence = 0;
  function normalize(text) { return text.replace(/\s+/g, ' ').trim().replace(/^\[[ xX]\](?:\s+|$)/, ''); }
  function text(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (node.dataset?.readText !== undefined) return node.dataset.readText;
    if (node.nodeName === 'BR') return ' ';
    return [...node.childNodes].map(text).join('');
  }
  const element = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  function readableAt(target) {
    const el = element(target);
    const block = el?.closest('[data-read-block]') || (el !== content ? el?.querySelector('[data-read-block]') : undefined);
    return block && content.contains(block) ? block : undefined;
  }
  function prefix(block, range) {
    if (block.dataset.readAtomic === 'true' || !block.contains(range.startContainer)) return '';
    const before = document.createRange(); before.selectNodeContents(block);
    const atomic = element(range.startContainer)?.closest('[data-read-text]');
    if (atomic && block.contains(atomic)) before.setEndBefore(atomic);
    else before.setEnd(range.startContainer, range.startOffset);
    return normalize(text(before.cloneContents()));
  }
  function chosenRange(event) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return;
    // 键盘菜单使用当前选区；鼠标在选区外右键则使用本次点击的段落。
    if (event.clientX || event.clientY) {
      const rects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : [];
      if (rects.length && !rects.some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom)) return;
      if (!rects.length && !range.intersectsNode(event.target)) return;
    }
    return range;
  }
  function setContext(requestId, available) {
    content.dataset.vscodeContext = JSON.stringify({ webviewSection: 'markdownReader', mdReaderReadAvailable: available,
      mdReaderReadContextId: requestId, mdReaderReadRenderId: generation });
  }
  content.addEventListener('contextmenu', event => {
    const range = chosenRange(event);
    let block;
    if (range) {
      block = readableAt(range.startContainer);
      if (block && !range.intersectsNode(block)) block = undefined;
      if (!block) block = [...content.querySelectorAll('[data-read-block]')].find(el => range.intersectsNode(el));
    } else block = readableAt(event.target);
    const target = block ? { blockId: block.dataset.readBlock, prefix: range ? prefix(block, range) : '' } : undefined;
    const requestId = `${generation}:${++sequence}`;
    setContext(requestId, !!target);
    // 保留 IDE 原生菜单；菜单出现后选区即使失去焦点，起点也已固定在这一份快照里。
    send('readContext', { requestId, target });
    if (target) player.prime();
  });
  return { reset: renderId => { generation = renderId; setContext('', false); } };
};
