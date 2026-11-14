'use strict';
(() => {
  const api = acquireVsCodeApi(), content = document.getElementById('content');
  const script = document.currentScript, rendererUrl = script.dataset.mermaid, nonce = script.nonce;
  let version = -1, selected, generation = 0, renderId = 0, anchor, rendererPromise;
  const send = (type, fields = {}) => api.postMessage({ type, version, renderId, ...fields });
  const selectionTools = document.getElementById('selection-tools'), copyReference = document.getElementById('copy-reference'), addChat = document.getElementById('add-chat'), chatStatus = document.getElementById('chat-status');
  let selectionSnapshot, selectionTimer, statusTimer, nativeLabel = '添加到聊天';
  const player = MarkdownReaderPlayer(send);
  const contextMenu = MarkdownReaderPreviewContext({ content, send, player });
  const controls = MarkdownReaderPreviewControls({ content, send, player, clearHeadingSelection: () => {
    clearTimeout(selectionTimer); window.getSelection()?.removeAllRanges(); selectionSnapshot = undefined; selectionTools.hidden = true;
    send('selectionChanged', { ids: [] });
  } });
  function selectedText(range) {
    const expanded = range.cloneRange();
    for (const el of content.querySelectorAll('[data-copy-text]')) {
      if (!range.intersectsNode(el)) continue;
      const atomic = document.createRange(); atomic.selectNode(el);
      if (expanded.compareBoundaryPoints(Range.START_TO_START, atomic) > 0) expanded.setStartBefore(el);
      if (expanded.compareBoundaryPoints(Range.END_TO_END, atomic) < 0) expanded.setEndAfter(el);
    }
    const fragment = expanded.cloneContents();
    const blocks = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'FIGURE']);
    function text(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
      if (node.dataset?.copyText !== undefined) return node.classList.contains('reader-math') ? node.dataset.copyText : `\n\n${node.dataset.copyText}\n\n`;
      if (node.nodeName === 'BR') return '\n';
      const body = [...node.childNodes].map(text).join('');
      if (node.nodeName === 'TD' || node.nodeName === 'TH') return body + '\t';
      if (node.nodeName === 'TR') return body.replace(/\t$/, '') + '\n';
      return blocks.has(node.nodeName) ? body + '\n\n' : body;
    }
    return text(fragment).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  function selectedSourceBlocks() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !s.toString().trim()) return;
    const range = s.getRangeAt(0);
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return;
    const blocks = [...content.querySelectorAll('[data-source-id]')].filter(el => range.intersectsNode(el));
    // 同一个源码块可能同时标在代码包装容器上；引用只取唯一 id。
    const ids = [...new Set(blocks.map(el => el.dataset.sourceId))];
    const rect = range.getBoundingClientRect();
    if (!ids.length || rect.bottom < 44 || rect.top > innerHeight) return;
    return { ids, text: selectedText(range), startLine: Math.min(...blocks.map(el => +el.dataset.sourceStart)), endLine: Math.max(...blocks.map(el => +el.dataset.sourceEnd)), rect };
  }
  function updateSelection() {
    const snapshot = selectedSourceBlocks(); selectionSnapshot = snapshot;
    send('selectionChanged', { ids: snapshot?.ids || [], text: snapshot?.text });
    if (!snapshot) { selectionTools.hidden = true; return; }
    const lines = snapshot.startLine === snapshot.endLine ? `L${snapshot.startLine}` : `L${snapshot.startLine}–L${snapshot.endLine}`;
    copyReference.textContent = `复制提问引用 · ${lines}`;
    copyReference.title = `复制文件路径、原文块行号 ${lines} 和实际选中文字，公式及图表使用源码。`;
    addChat.textContent = nativeLabel;
    addChat.title = `插入原生文件与行范围卡片 ${lines}。精确的选中文字可用“复制提问引用”。`;
    selectionTools.hidden = false;
    const box = selectionTools.getBoundingClientRect(), rect = snapshot.rect;
    selectionTools.style.left = `${Math.max(8, Math.min(rect.right - box.width, innerWidth - box.width - 8))}px`;
    selectionTools.style.top = `${Math.max(44, Math.min(rect.bottom + 5, innerHeight - box.height - 8))}px`;
  }
  document.addEventListener('selectionchange', () => { clearTimeout(selectionTimer); selectionTimer = setTimeout(updateSelection, 100); });
  window.addEventListener('scroll', () => { if (selectionSnapshot) updateSelection(); }, { passive: true });
  addChat.onpointerdown = e => e.preventDefault(); // 点击按钮不清空浏览器选区。
  copyReference.onpointerdown = e => e.preventDefault();
  copyReference.onclick = () => {
    const current = selectedSourceBlocks();
    if (current) send('copyReference', { ids: current.ids, text: current.text });
  };
  addChat.onclick = () => { if (selectionSnapshot) send('addToChat'); };
  function loadMermaid() {
    if (!rendererPromise) rendererPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = rendererUrl; s.nonce = nonce;
      s.onload = () => resolve(globalThis.MarkdownReaderMermaid);
      s.onerror = () => reject(new Error('图表组件未能加载')); document.head.append(s);
    });
    return rendererPromise;
  }
  document.getElementById('source').onclick = () => send('source');
  function select(e) {
    const h = e.target.closest('[data-heading]');
    if (h) send('select', { id: h.dataset.heading });
  }
  content.onclick = e => {
    const a = e.target.closest('a');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (/^https?:\/\//i.test(href || '')) send('link', { href });
      return;
    }
    select(e);
  };
  content.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('[data-heading]')) { e.preventDefault(); select(e); } };
  function highlight(m) {
    content.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
    const elements = [...content.querySelectorAll('[data-from]')];
    const ranges = m.ranges || (m.range ? [m.range] : []);
    const active = elements.filter(el => ranges.some(r => +el.dataset.from === r.from && +el.dataset.to === r.to));
    for (const element of active) element.classList.add('speaking');
    const el = active[0];
    if (el) {
      el.classList.add('speaking');
      if (m.follow) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 45 || rect.bottom > innerHeight) el.scrollIntoView({ block: 'center' });
      }
    }
    send('highlighted', { from: el ? +el.dataset.from : null, inViewport: !!el && el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0 });
  }
  function reveal(m) {
    const el = [...content.querySelectorAll('[data-heading]')].find(el => el.dataset.heading === m.id);
    if (el) {
      selected?.classList.remove('selected'); selected = el; el.classList.add('selected'); el.scrollIntoView({ block: 'start' });
      const top = el.getBoundingClientRect().top;
      send('revealed', { id: m.id, inViewport: top >= 0 && top < innerHeight });
    }
  }
  function restoreAnchor() {
    if (anchor?.type === 'reveal') reveal(anchor);
    else if (anchor?.type === 'highlight') highlight(anchor);
  }
  function stats() {
    return { headings: content.querySelectorAll('[data-heading]').length, formulas: content.querySelectorAll('.katex').length,
      mathErrors: content.querySelectorAll('.katex-error,.math-error').length,
      diagrams: content.querySelectorAll('.mermaid-diagram > svg').length,
      diagramErrors: content.querySelectorAll('.mermaid-block.render-error').length,
      fontsReady: document.fonts.status === 'loaded' && document.fonts.check('16px KaTeX_Main') };
  }
  async function renderDiagrams(currentGeneration) {
    const figures = [...content.querySelectorAll('.mermaid-block')];
    let renderer;
    if (figures.length) {
      try { renderer = await loadMermaid(); } catch { /* 每幅图显示可读的降级提示。 */ }
    }
    for (const figure of figures) {
      if (generation !== currentGeneration || !figure.isConnected) return;
      const target = figure.querySelector('.mermaid-diagram'), source = target.textContent;
      try {
        if (!renderer) throw new Error('Renderer unavailable');
        const svg = await renderer.renderDiagram(source, target, document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
        if (generation !== currentGeneration || !figure.isConnected) return;
        target.innerHTML = svg; figure.querySelector('.diagram-status').hidden = true;
      } catch {
        if (generation !== currentGeneration || !figure.isConnected) return;
        figure.classList.add('render-error');
        const pre = document.createElement('pre'); pre.textContent = source; target.replaceChildren(pre);
        figure.querySelector('.diagram-status').textContent = '图表无法绘制，已保留源码。';
      }
      // 图表变高之后仍定位用户最新选择的标题或朗读段落。
      restoreAnchor();
    }
    await document.fonts.ready;
    if (generation !== currentGeneration) return;
    restoreAnchor(); send('renderFinished', stats());
  }
  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'readerState') controls.update(m);
    else if (['audio', 'stop', 'pause', 'resume', 'seek', 'playbackOptions'].includes(m.type)) player.handle(m);
    else if (m.type === 'content') {
      clearTimeout(statusTimer);
      selectionSnapshot = undefined; selectionTools.hidden = true; chatStatus.hidden = true;
      version = m.version; renderId = m.renderId; generation++; anchor = undefined; selected = undefined;
      content.innerHTML = m.html; contextMenu.reset(renderId); send('rendered', stats()); void renderDiagrams(generation);
    }
    else if (m.type === 'highlight' && m.version === version) {
      if (m.range && m.follow) anchor = m;
      else if (!m.range && anchor?.type === 'highlight') anchor = undefined;
      highlight(m);
    }
    else if (m.type === 'reveal' && m.version === version) {
      anchor = m; reveal(m);
    }
    else if (m.type === 'nativeChatCapability') {
      addChat.hidden = m.available !== true;
      nativeLabel = m.label || '添加到聊天'; addChat.textContent = nativeLabel;
      addChat.title = '插入原生文件与行范围卡片。精确的选中文字可用“复制提问引用”。';
    }
    else if (m.type === 'chatStatus') {
      addChat.disabled = !!m.busy;
      if (m.added) { selectionSnapshot = undefined; window.getSelection()?.removeAllRanges(); selectionTools.hidden = true; chatStatus.hidden = true; }
      if (m.error) { chatStatus.textContent = m.error; chatStatus.hidden = false; }
    }
    else if (m.type === 'copyStatus' && m.version === version && m.renderId === renderId) {
      copyReference.disabled = !!m.busy; clearTimeout(statusTimer);
      if (m.copied || m.error) {
        chatStatus.textContent = m.error || '已复制，请粘贴到聊天框'; chatStatus.hidden = false;
        if (m.copied) statusTimer = setTimeout(() => { chatStatus.hidden = true; }, 3500);
      }
    }
  });
  send('ready');
})();
