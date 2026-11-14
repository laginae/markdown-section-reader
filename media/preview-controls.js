'use strict';
globalThis.MarkdownReaderPreviewControls = ({ content, send, player, clearHeadingSelection }) => {
  const root = document.createElement('div'); root.id = 'floating-reader'; root.hidden = true;
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', '悬浮朗读控制');
  const button = (parent, id, text, label) => {
    const el = document.createElement('button'); el.type = 'button'; el.id = id; el.textContent = text;
    el.title = label; el.setAttribute('aria-label', label); parent.append(el); return el;
  };
  const primary = button(root, 'floating-toggle', '▶', '从本节开始朗读');
  const extra = document.createElement('div'); extra.className = 'floating-extra'; root.append(extra);
  const back = button(extra, 'floating-backward', '−5', '后退五秒');
  const forward = button(extra, 'floating-forward', '+5', '前进五秒');
  const stop = button(extra, 'floating-stop', '■', '停止朗读');
  document.body.append(root);
  let state = {}, pending = false, pointerSession, lastFeedback = '';
  function paint() {
    const active = ['playing', 'paused', 'ready', 'loading'].includes(state.state) && !!state.session;
    root.hidden = state.sameDocument !== true || state.preferences?.floatingButton === false;
    root.dataset.state = state.state || 'idle';
    const heading = state.headings?.find(h => h.id === state.selected);
    const label = active ? state.state === 'paused' ? '继续朗读' : state.state === 'ready' ? '播放朗读' : '暂停朗读'
      : `从${heading ? '“' + heading.title + '”' : '文档开头'}开始朗读`;
    primary.title = active ? `${label}（空格）` : label; primary.setAttribute('aria-label', label);
    primary.textContent = active && ['playing', 'loading'].includes(state.state) ? 'Ⅱ' : '▶';
    primary.disabled = pending || state.state === 'loading' && !state.session;
    extra.hidden = !active;
    back.disabled = forward.disabled = pending || !['playing', 'paused'].includes(state.state);
    stop.disabled = pending || !active;
    const feedback = { visible: !root.hidden, doubleClickRead: state.preferences?.doubleClickRead !== false,
      action: active ? 'pause' : 'read', label, active, canSeek: !back.disabled };
    const signature = JSON.stringify([state.revision, feedback]);
    if (signature !== lastFeedback) { lastFeedback = signature; send('previewControlsRendered', feedback); }
  }
  function action(name, e, source = 'floating') {
    if (pending || state.sameDocument !== true || source === 'floating' && root.hidden) return;
    if (e.detail && pointerSession !== state.session?.id) return;
    player.prime();
    const active = ['playing', 'paused', 'ready', 'loading'].includes(state.state) && !!state.session;
    if (name === 'toggle' && active && state.state === 'ready' && state.session.surface === 'preview') { player.resume(); return; }
    pending = true; paint();
    send('previewControl', { action: name === 'toggle' ? active ? 'pause' : 'read' : name, sessionId: state.session?.id, id: state.selected,
      ...(source === 'keyboard' ? { source: 'keyboard' } : {}) });
  }
  for (const [el, name] of [[primary, 'toggle'], [back, 'seekBackward'], [forward, 'seekForward'], [stop, 'stop']]) {
    el.addEventListener('pointerdown', e => { if (e.button === 0) { pointerSession = state.session?.id; e.preventDefault(); } });
    el.addEventListener('pointercancel', () => { pointerSession = undefined; });
    el.addEventListener('click', e => { e.stopPropagation(); action(name, e); });
    el.addEventListener('keydown', e => { if ([' ', 'Enter'].includes(e.key) && e.repeat) e.preventDefault(); });
  }
  window.addEventListener('keydown', e => {
    if (!['Space'].includes(e.code) && ![' ', 'Spacebar'].includes(e.key)) return;
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const target = e.target?.closest ? e.target : document.activeElement;
    if (target?.closest('button,a,input,select,textarea,summary,audio,video,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="switch"],[role="checkbox"],[role="radio"]')) return;
    const editable = target?.closest('[contenteditable]');
    if (editable && editable.getAttribute('contenteditable') !== 'false') return;
    if (state.sameDocument !== true || !state.session || !['playing', 'paused', 'ready', 'loading'].includes(state.state)) return;
    // 暂停/继续与悬浮控件使用同一入口；悬浮按钮隐藏时仍可用，长按也不重复切换或滚动。
    e.preventDefault();
    if (!e.repeat) action('toggle', e, 'keyboard');
  });
  content.addEventListener('dblclick', e => {
    const heading = e.target.closest('[data-heading]');
    if (!heading || state.sameDocument !== true || state.preferences?.doubleClickRead === false || e.button !== 0
      || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('a,button,input,select,textarea,[contenteditable="true"]')) return;
    e.preventDefault(); player.prime(); clearHeadingSelection(); send('readHeading', { id: heading.dataset.heading });
  });
  return { update: m => { state = m; pending = false; paint(); } };
};
