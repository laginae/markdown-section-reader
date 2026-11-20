'use strict';
const api = acquireVsCodeApi();
api.setState({ version: 1 });
const byId = id => document.getElementById(id);
let current = {}, revision = -1;
const send = (type, extra = {}) => api.postMessage({ type, ...extra });
const player = MarkdownReaderPlayer(send);
const academicBox = byId('academic-preview');
let previewKey = '', lastSelected, lastLevels;
const headingButtons = new Map();
function refreshExample() {
  if (!academicBox.open || !current.preferences) return;
  const p=current.preferences,key=JSON.stringify([p.academicMathMode,p.academicMathStyle,p.academicIntervalStyle,p.academicFunctionStyle,p.academicTableMode,p.academicTableRepeatHeaders,p.academicSkipNotice,p.mathReadingLanguage]);
  if(key!==previewKey){previewKey=key;send('academicPreview');}
}
academicBox.addEventListener('toggle',refreshExample);
byId('read').onclick = () => { player.prime(); send('read', { mode: 'section', revision }); };
byId('from').onclick = () => { player.prime(); send('read', { mode: 'from', revision }); };
const pause = () => current.state === 'ready' && current.session?.surface !== 'preview' ? player.resume() : send('pause');
byId('pause').onclick = pause;
byId('compact-pause').onclick = pause;
byId('compact-stop').onclick = () => send('stop');
byId('collapse').onclick = () => send('collapse', { value: !current?.controlsCollapsed });
byId('preview').onclick = () => send('preview');
byId('stop').onclick = () => send('stop');
byId('voice').onclick = () => send('voice');
byId('setup').onclick = () => send('setup');
byId('engine').onchange = e => send('engine', { value: e.target.value });
for (const [id, type] of [['previous', 'previous'], ['next', 'next'], ['backward', 'seekBackward'], ['forward', 'seekForward'], ['configure', 'configure'], ['import-cozy', 'importCozySettings']]) byId(id).onclick = () => send(type);
for (const name of ['speed', 'volume', 'buffering', 'academicMathMode', 'academicMathStyle', 'academicIntervalStyle', 'academicFunctionStyle', 'quickStart']) byId(name).onchange = e => send('setting', { name, value: ['speed', 'volume'].includes(name) ? Number(e.target.value) : e.target.value });
for (const name of ['doubleClickRead', 'floatingButton', 'showHeadingLevels', 'academicTableRepeatHeaders']) byId(name).onchange = e => send('setting', { name, value: e.target.checked });
window.addEventListener('keydown', e => {
  if (e.repeat || e.target.closest('button,input,select,textarea,[contenteditable="true"]')) return;
  if (e.code === 'Space') { e.preventDefault(); pause(); }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); send(e.code === 'ArrowLeft' ? 'seekBackward' : 'seekForward'); }
});
window.addEventListener('message', async e => {
  const m = e.data;
  if(m.type==='academicPreview') {
    const list=academicBox.querySelector('dl');list.replaceChildren();
    for(const [label,text] of m.rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text;list.append(dt,dd);}
    return;
  }
  if (m.type === 'state') {
    current = m; byId('file').textContent = m.file || '打开 Markdown 文档'; byId('status').textContent = m.detail;
    byId('engine').value = m.engine; byId('pause').disabled = !['playing', 'ready', 'paused', 'loading'].includes(m.state);
    byId('pause').textContent = m.state === 'ready' ? '播放' : m.state === 'paused' ? '继续' : '暂停';
    byId('stop').disabled = !['playing', 'ready', 'paused', 'loading'].includes(m.state);
    byId('read').disabled = byId('from').disabled = !m.file;
    byId('preview').disabled = !m.file;
    for (const name of ['speed', 'volume', 'buffering', 'academicMathMode', 'academicMathStyle', 'academicIntervalStyle', 'academicFunctionStyle', 'quickStart']) if (document.activeElement !== byId(name)) byId(name).value = String(m.preferences[name]);
    for (const name of ['doubleClickRead', 'floatingButton', 'academicTableRepeatHeaders']) byId(name).checked = m.preferences[name] !== false;
    byId('showHeadingLevels').checked = m.preferences.showHeadingLevels === true;
    byId('previous').disabled = !m.session || m.session.index <= 0 || ['complete', 'idle', 'error'].includes(m.state);
    byId('next').disabled = !m.session || m.session.index >= m.session.total - 1 || ['complete', 'idle', 'error'].includes(m.state);
    byId('backward').disabled = byId('forward').disabled = !['playing', 'paused'].includes(m.state);
    const collapsed = !!m.controlsCollapsed;
    byId('controls').hidden = collapsed;
    byId('collapse').textContent = collapsed ? '▸ 朗读控制' : '▾ 朗读控制';
    byId('collapse').setAttribute('aria-expanded', String(!collapsed));
    byId('compact-playback').hidden = !collapsed || !['playing', 'paused', 'ready', 'loading'].includes(m.state);
    byId('compact-pause').disabled = byId('pause').disabled;
    byId('compact-pause').textContent = byId('pause').textContent;
    byId('compact-stop').disabled = byId('stop').disabled;
    byId('compact-status').hidden = !collapsed || !['error', 'ready'].includes(m.state);
    byId('compact-status').textContent = m.detail;
    byId('notice').textContent = m.engine === 'mimo' ? 'MiMo 会将朗读文字发送到小米官方接口。高亮按原文段落显示。' : '点击目录标题跳转；本节包含子节。高亮按原文段落显示。';
    const rebuilt=revision!==m.revision;
    if (rebuilt) {
      revision = m.revision; const outline = byId('outline'); outline.replaceChildren();
      headingButtons.clear();
      for (const h of m.headings) {
        const button = document.createElement('button'); button.className = `heading h${h.level}`; button.dataset.id = h.id;
        const levelName = ['','一级标题','二级标题','三级标题','四级标题','五级标题','六级标题'][h.level] || `H${h.level}`;
        button.title = `${h.title} · ${levelName} · 第 ${h.line + 1} 行`; button.setAttribute('aria-label', `跳转到 ${h.title}，${levelName}`);
        const level = document.createElement('span'); level.className = 'level'; level.textContent = `H${h.level}`; level.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span'); title.className = 'title'; title.textContent = h.title;
        button.append(level, title); button.onclick = () => send('jump', { id: h.id, revision }); outline.append(button);
        headingButtons.set(h.id,button);
        button.ondblclick = e => {
          if (current.preferences.doubleClickRead === false || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !button.isConnected) return;
          e.preventDefault(); player.prime(); send('readHeading', { id: h.id, revision });
        };
      }
      if (!m.headings.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = m.file ? '没有 Markdown 标题；可朗读整个文档。' : '在编辑器中打开 .md 文件，目录会自动显示。'; outline.append(empty); }
    }
    if(rebuilt || lastSelected!==m.selected){
      const prev=headingButtons.get(lastSelected), next=headingButtons.get(m.selected);
      if(prev){prev.classList.remove('active');prev.removeAttribute('aria-current');}
      if(next){next.classList.add('active');next.setAttribute('aria-current','location');}
      lastSelected=m.selected;
    }
    if(rebuilt || lastLevels!==m.preferences.showHeadingLevels){
      lastLevels=m.preferences.showHeadingLevels;
      for(const button of headingButtons.values())button.querySelector('.level').hidden=lastLevels!==true;
    }
    refreshExample();
  } else player.handle(m);
});
send('ready');
