'use strict';
// 读取实际宿主观察文件，断言通过后才记录对应的鼠标交互验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),[ide,name]=process.argv.slice(2);
assert.ok(['cursor','qoder'].includes(ide));
const liveFile=path.join(root,`qa/${ide}-interaction-live.json`);
assert.ok(Date.now()-fs.statSync(liveFile).mtimeMs<3000,'宿主观察文件已过期');
function readLive() {
  for(let attempt=0;attempt<5;attempt++){
    try{return JSON.parse(fs.readFileSync(liveFile));}catch(e){if(attempt===4)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
  }
}
const live=readLive(),s=live.state,trace=s.trace;
const target=path.join(root,`qa/${ide}-interaction-integration.json`);
let report;try{report=JSON.parse(fs.readFileSync(target));}catch{report={version:live.version,testedVsixSha256:live.testedVsixSha256,ide,status:'running',checks:[]};}
const controls=trace.filter(e=>e.type==='floatingControl'),last=controls.at(-1),starts=trace.filter(e=>e.type==='start');
const active=()=>{assert.ok(s.session);assert.ok(['playing','paused'].includes(s.state));assert.equal(s.preview.highlighted,s.session.current.from);};
if(name==='preview-double'||name==='outline-double'){
  active();const surface=name==='preview-double'?'preview':'reader';
  const gesture=trace.filter(e=>e.type==='headingDoubleClick'&&e.surface===surface).at(-1);assert.ok(gesture);
  const start=starts.find(e=>e.at>=gesture.at&&e.id===s.session.id);assert.ok(start);
  assert.equal(start.surface,surface);assert.equal(start.mode,'from');assert.equal(start.from,Number(gesture.id));assert.equal(start.to,335);
  assert.equal(starts.filter(e=>e.at>=gesture.at).length,1,'一次双击重复启读');
  assert.ok(trace.some(e=>e.type==='playing'&&e.id===s.session.id));
  if(surface==='preview')assert.ok(!trace.some(e=>e.type==='awaitingUserPlayback'&&e.at>start.at),'首次双击仍受阻');
}else if(name==='pause'){
  active();assert.equal(s.state,'paused');assert.equal(last.action,'pause');
}else if(name==='resume'){
  active();assert.equal(s.state,'playing');assert.equal(last.action,'pause');
}else if(name==='seek-forward'||name==='seek-backward'){
  active();assert.equal(s.state,'paused');assert.equal(last.action,name==='seek-forward'?'seekForward':'seekBackward');
  const previous=report.checks.filter(c=>c.session?.id===s.session.id&&['pause','seek-forward'].includes(c.name)).at(-1);
  assert.ok(previous);const expected=Math.max(0,Math.min(s.session.duration,previous.session.time+(name==='seek-forward'?5:-5)));
  assert.ok(Math.abs(s.session.time-expected)<.25,'五秒移动与当前片段时间不符');
}else if(name==='floating-start'){
  active();assert.equal(s.session.surface,'preview');const gesture=trace.filter(e=>e.type==='floatingRead').at(-1);assert.ok(gesture);
  assert.ok(starts.some(e=>e.at>=gesture.at&&e.id===s.session.id));
}else if(name==='stop'){
  assert.equal(s.state,'idle');assert.equal(s.session,null);assert.equal(last.action,'stop');
}else if(name==='body-double'){
  assert.equal(s.state,'idle');assert.equal(s.session,null);
  const before=report.checks.filter(c=>c.name==='stop').at(-1);assert.ok(before);assert.equal(starts.length,before.startCount);
}else if(name==='finish'){
  for(const required of ['preview-double','outline-double','floating-start','pause','resume','seek-forward','seek-backward','stop','body-double'])assert.ok(report.checks.some(c=>c.name===required),'缺少实测 '+required);
  assert.equal(live.settingsUnchanged,true);report.status='passed';report.settingsUnchanged=true;report.finished=new Date().toISOString();
}else throw new Error('未知验收步骤');
if(name!=='finish')report.checks.push({name,passed:true,at:new Date().toISOString(),state:s.state,startCount:starts.length,
  session:s.session?{id:s.session.id,engine:s.session.engine,surface:s.session.surface,time:s.session.time,from:s.session.from,to:s.session.to}:null});
fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ide,name,status:report.status,checks:report.checks.length}));
