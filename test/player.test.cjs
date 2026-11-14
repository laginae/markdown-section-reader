'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const dom = new JSDOM('',{runScripts:'outside-only'}); t.after(()=>dom.window.close());
  const win=dom.window, messages=[], elements=[], blobs=[], revoked=[], pending=[];
  win.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:test-'+blobs.length; };
  win.URL.revokeObjectURL = url => revoked.push(url);
  win.Audio=class {
    constructor(){this.paused=true;this.duration=12;this.currentTime=0;elements.push(this);}
    play(){this.paused=false;return new Promise((resolve,reject)=>pending.push({resolve,reject}));}
    pause(){this.paused=true;} removeAttribute(){this.src='';} load(){}
  };
  win.eval(fs.readFileSync(path.join(__dirname,'../media/player.js'),'utf8'));
  const player=win.MarkdownReaderPlayer((type,data)=>messages.push({type,...data}));
  return {win,player,messages,elements,blobs,revoked,pending,send:token=>player.handle({type:'audio',token,data:'UklGRg==',speed:1.25,volume:.6})};
}
test('手势内静音准备和实际音频复用一个播放器，未实际 playing 时不声称正在朗读', async t=>{
  const f=fixture(t); f.player.prime(); assert.equal(f.elements.length,1); assert.equal(f.blobs[0].size,1808);
  f.pending[0].resolve(); await tick(); assert.equal(f.messages.length,0);
  f.send('one'); const audio=f.elements[0]; assert.equal(f.elements.length,1); assert.equal(f.messages.length,0);
  audio.onplaying(); assert.deepEqual(f.messages,[{type:'playing',token:'one'}]);
  assert.equal(audio.playbackRate,1.25); assert.equal(audio.volume,.6); assert.equal(audio.preservesPitch,true);
});
test('旧 play Promise 的延迟拒绝不会让下一片段失败，停止后旧事件不再上报', async t=>{
  const f=fixture(t); f.send('old'); const oldPlaying=f.elements[0].onplaying;
  f.send('new'); f.pending[0].reject(Object.assign(new Error(),{name:'AbortError'})); await tick();
  oldPlaying(); assert.equal(f.messages.length,0);
  f.elements[0].onplaying(); assert.equal(f.messages[0].token,'new');
  f.player.stop(); f.pending[1].reject(Object.assign(new Error(),{name:'AbortError'})); await tick();
  assert.equal(f.messages.length,1); assert.equal(f.elements[0].onplaying,null); assert.equal(f.revoked.length,2);
});
test('浏览器阻止播放会显式提示，点击可重试；暂停与按秒移动保持当前位置边界', async t=>{
  const f=fixture(t); f.send('blocked');
  f.pending[0].reject(Object.assign(new Error(),{name:'NotAllowedError'})); await tick();
  assert.equal(f.messages[0].type,'audioBlocked'); assert.equal(f.messages[0].token,'blocked');
  f.elements[0].paused=true; f.player.resume(); assert.equal(f.pending.length,2);
  f.elements[0].currentTime=10; f.player.handle({type:'seek',seconds:5}); assert.equal(f.elements[0].currentTime,12);
  f.player.handle({type:'seek',seconds:-20}); assert.equal(f.elements[0].currentTime,0);
  f.player.handle({type:'pause'}); f.elements[0].onpause(); assert.equal(f.messages.at(-1).type,'paused');
});
