'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '../media', name), 'utf8');
function fixture(t) {
  const dom = new JSDOM('<main><h2 data-heading="17">章节标题 <a href="#">链接</a></h2><p>普通正文双击选词</p></main>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: win } = dom, content = win.document.querySelector('main'), messages = [], calls = { prime: 0, resume: 0, clear: 0 };
  win.eval(source('preview-controls.js'));
  const controls = win.MarkdownReaderPreviewControls({ content, send: (type, data) => messages.push({type, ...data}),
    player: { prime: () => calls.prime++, resume: () => calls.resume++ }, clearHeadingSelection: () => calls.clear++ });
  const state = { sameDocument: true, state: 'idle', selected: '17', preferences: { doubleClickRead: true, floatingButton: true }, headings: [{id:'17',title:'章节标题'}] };
  const update = extra => controls.update(Object.assign(state, extra)); update({});
  const el = id => win.document.getElementById(id);
  const dbl = target => target.dispatchEvent(new win.MouseEvent('dblclick', { bubbles:true, button:0, detail:2 }));
  const key = (target = content.querySelector('p'), extra = {}) => {
    const event = new win.KeyboardEvent('keydown', { key:' ', code:'Space', bubbles:true, cancelable:true, ...extra });
    target.dispatchEvent(event); return event;
  };
  return {win,content,messages,calls,state,update,el,dbl,key};
}
test('预览正文空格暂停和继续，隐藏悬浮按钮也可使用，长按不重复切换', t => {
  const f=fixture(t); f.state.preferences.floatingButton=false;
  f.update({state:'playing',session:{id:2,surface:'preview'}}); assert.equal(f.el('floating-reader').hidden,true);
  assert.equal(f.key().defaultPrevented,true);
  assert.deepEqual(f.messages.filter(m=>m.type==='previewControl'),[{type:'previewControl',action:'pause',sessionId:2,id:'17',source:'keyboard'}]);
  assert.equal(f.key(undefined,{repeat:true}).defaultPrevented,true);
  assert.equal(f.messages.filter(m=>m.type==='previewControl').length,1);
  f.update({state:'paused'}); assert.equal(f.key().defaultPrevented,true);
  assert.equal(f.messages.filter(m=>m.type==='previewControl').length,2); assert.equal(f.messages.at(-1).action,'pause');
});
test('空闲、其他文档、修饰键和输入法组合中的空格保留页面行为', t => {
  const f=fixture(t);
  for(const state of ['idle','complete','error','loading']){
    f.update({state,session:null}); assert.equal(f.key().defaultPrevented,false);
  }
  f.update({state:'playing',session:{id:3,surface:'preview'},sameDocument:false}); assert.equal(f.key().defaultPrevented,false);
  f.update({sameDocument:true});
  for(const extra of [{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}]) assert.equal(f.key(undefined,extra).defaultPrevented,false);
  assert.equal(f.messages.filter(m=>m.type==='previewControl').length,0); assert.equal(f.calls.prime,0);
});
test('焦点位于按钮、链接、输入控件或可编辑文本时，空格不触发全局朗读控制', t => {
  const f=fixture(t); f.update({state:'playing',session:{id:4,surface:'preview'}});
  for(const tag of ['button','a','input','select','textarea','summary']){
    const element=f.win.document.createElement(tag); f.content.append(element);
    assert.equal(f.key(element).defaultPrevented,false,tag);
  }
  for(const attrs of [{'role':'button'},{'contenteditable':''},{'contenteditable':'plaintext-only'}]){
    const parent=f.win.document.createElement('div'),child=f.win.document.createElement('span');
    for(const [name,value] of Object.entries(attrs)) parent.setAttribute(name,value);
    parent.append(child); f.content.append(parent); assert.equal(f.key(child).defaultPrevented,false);
  }
  const handled=new f.win.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true});
  handled.preventDefault(); f.content.dispatchEvent(handled);
  assert.equal(f.messages.filter(m=>m.type==='previewControl').length,0); assert.equal(f.calls.prime,0);
});
test('预览空格在播放受阻时直接重试，准备音频时复用现有会话暂停入口', t => {
  const f=fixture(t); f.state.preferences.floatingButton=false;
  f.update({state:'ready',session:{id:5,surface:'preview'}}); assert.equal(f.key().defaultPrevented,true);
  assert.equal(f.calls.resume,1); assert.equal(f.messages.filter(m=>m.type==='previewControl').length,0);
  f.update({state:'ready',session:{id:6,surface:'reader'}}); f.key();
  assert.equal(f.messages.at(-1).source,'keyboard'); assert.equal(f.messages.at(-1).sessionId,6); assert.equal(f.messages.at(-1).action,'pause');
  f.update({state:'loading',session:{id:7,surface:'preview'}}); f.key();
  assert.equal(f.messages.at(-1).sessionId,7); assert.equal(f.messages.at(-1).action,'pause');
});
test('预览单击定位、正文双击选词与链接操作不启读；标题双击只发送一次从本节开始', t => {
  const f = fixture(t), h = f.content.querySelector('h2');
  h.click(); f.dbl(f.content.querySelector('p')); f.dbl(f.content.querySelector('a'));
  assert.equal(f.messages.filter(m=>m.type==='readHeading').length,0); assert.equal(f.calls.clear,0);
  f.dbl(h);
  assert.deepEqual(f.messages.filter(m=>m.type==='readHeading'),[{type:'readHeading',id:'17'}]);
  assert.equal(f.calls.prime,1); assert.equal(f.calls.clear,1);
});
test('关闭双击开关或预览不是当前文档时，双击不会触发旧文档朗读', t => {
  const f=fixture(t); f.state.preferences.doubleClickRead=false; f.update({}); f.dbl(f.content.querySelector('h2'));
  f.state.preferences.doubleClickRead=true; f.update({sameDocument:false}); f.dbl(f.content.querySelector('h2'));
  assert.equal(f.messages.filter(m=>m.type==='readHeading').length,0); assert.equal(f.calls.prime,0);
  assert.equal(f.el('floating-reader').hidden,true);
});
test('闲置悬浮按钮从明确选定章节启读，连续点击不重复提交', t => {
  const f=fixture(t); assert.equal(f.el('floating-reader').hidden,false);
  assert.match(f.el('floating-toggle').title,/章节标题/);
  f.el('floating-toggle').click(); f.el('floating-toggle').click();
  assert.deepEqual(f.messages.filter(m=>m.type==='previewControl'),[{type:'previewControl',action:'read',sessionId:undefined,id:'17'}]);
  assert.equal(f.calls.prime,1);
});
test('暂停、继续、五秒移动和停止共用活动会话，等待合成时仍可停止', t => {
  const f=fixture(t), root=f.el('floating-reader');
  f.update({state:'playing',session:{id:2,surface:'preview'}}); f.el('floating-toggle').click();
  assert.equal(f.messages.at(-1).action,'pause'); assert.equal(f.messages.at(-1).sessionId,2);
  f.update({state:'paused'}); assert.match(f.el('floating-toggle').title,/继续/); f.el('floating-forward').click();
  assert.equal(f.messages.at(-1).action,'seekForward');
  f.update({state:'paused'}); f.el('floating-backward').click(); assert.equal(f.messages.at(-1).action,'seekBackward');
  f.update({state:'loading'}); assert.equal(f.el('floating-backward').disabled,true); assert.equal(f.el('floating-stop').disabled,false);
  f.el('floating-stop').click(); assert.equal(f.messages.at(-1).action,'stop');
  f.update({state:'idle',session:null}); assert.equal(f.el('floating-reader'),root); assert.equal(f.el('floating-toggle').textContent,'▶');
});
test('受阻的预览音频在点击栈内重试播放，手势开始后变更会话不会暂停新会话', t => {
  const f=fixture(t); f.update({state:'ready',session:{id:3,surface:'preview'}}); f.el('floating-toggle').click();
  assert.equal(f.calls.resume,1); assert.equal(f.messages.filter(m=>m.type==='previewControl').length,0);
  const toggle=f.el('floating-toggle');
  toggle.dispatchEvent(new f.win.MouseEvent('pointerdown',{button:0,bubbles:true}));
  f.update({state:'playing',session:{id:4,surface:'preview'}});
  toggle.dispatchEvent(new f.win.MouseEvent('click',{button:0,detail:1,bubbles:true}));
  assert.equal(f.messages.filter(m=>m.type==='previewControl').length,0);
});
test('悬浮开关即时隐藏，再开启时保留当前播放会话', t => {
  const f=fixture(t); f.update({state:'playing',session:{id:9,surface:'reader'}});
  f.state.preferences.floatingButton=false; f.update({}); assert.equal(f.el('floating-reader').hidden,true);
  f.state.preferences.floatingButton=true; f.update({}); assert.equal(f.el('floating-reader').hidden,false);
  assert.equal(f.state.session.id,9); assert.match(f.el('floating-toggle').title,/暂停/);
});
test('目录双击沿用当前章节与播放入口，关闭开关后单击和双击均保留导航', t => {
  const ids = ['file','status','engine','pause','stop','read','from','preview','speed','volume','buffering','academicMathMode','academicMathStyle','academicIntervalStyle','academicFunctionStyle','academicTableRepeatHeaders','quickStart','doubleClickRead','floatingButton','showHeadingLevels','previous','next','backward','forward','controls','collapse','compact-playback','compact-pause','compact-stop','compact-status','notice','outline','voice','setup','configure','import-cozy'];
  const dom=new JSDOM(ids.map(id=>`<${id==='outline'?'main':id==='engine'?'select':'button'} id="${id}"></${id==='outline'?'main':id==='engine'?'select':'button'}>`).join(''),{runScripts:'outside-only'});
  dom.window.document.body.insertAdjacentHTML('beforeend','<details id="academic-preview"><summary>Preview</summary><dl></dl></details>');
  t.after(()=>dom.window.close()); const win=dom.window,messages=[];let primed=0;
  win.acquireVsCodeApi=()=>({setState:()=>{},postMessage:m=>messages.push(m)});
  win.MarkdownReaderPlayer=()=>({prime:()=>primed++,resume:()=>{},handle:()=>{}});
  win.eval(source('reader.js'));
  const data={type:'state',state:'idle',file:'公开.md',revision:1,preferences:{doubleClickRead:true,floatingButton:true},headings:[{id:'17',title:'第二节',level:2,line:4}],selected:'17'};
  const update=()=>win.dispatchEvent(new win.MessageEvent('message',{data})); update();
  const title=win.document.querySelector('#outline .heading'); title.click();
  assert.equal(messages.at(-1).type,'jump');
  title.dispatchEvent(new win.MouseEvent('dblclick',{button:0,detail:2}));
  assert.equal(messages.at(-1).type,'readHeading'); assert.equal(messages.at(-1).id,'17'); assert.equal(primed,1);
  data.preferences.doubleClickRead=false; update();
  assert.equal(win.document.querySelector('#outline .heading'),title);
  const count=messages.filter(m=>m.type==='readHeading').length; title.click(); title.dispatchEvent(new win.MouseEvent('dblclick',{button:0,detail:2}));
  assert.equal(messages.filter(m=>m.type==='readHeading').length,count); assert.equal(messages.at(-1).type,'jump');
});
