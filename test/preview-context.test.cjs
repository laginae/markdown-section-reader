'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { JSDOM } = require('jsdom');
const { parseMarkdown } = require('../src/markdown.cjs');
const { buildPreview } = require('../src/preview.cjs');
const { resolveReadingPosition } = require('../src/reading-position.cjs');
const { makeReadingPlan } = require('../src/speech-plan.cjs');
function fixture(t, markdown) {
  const parsed=parseMarkdown(markdown),built=buildPreview(markdown);
  const dom=new JSDOM(`<main id="content">${built.html}</main>`,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const win=dom.window,content=win.document.getElementById('content'),messages=[];let primed=0;
  win.eval(fs.readFileSync(path.join(__dirname,'../media/preview-context.js'),'utf8'));
  const menu=win.MarkdownReaderPreviewContext({content,send:(type,data)=>messages.push({type,...data}),player:{prime:()=>primed++}});menu.reset(1);
  const select=(node,start,end=node.length)=>{
    const range=win.document.createRange();range.setStart(node,start);range.setEnd(node,end);
    const selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);return selection.getRangeAt(0);
  };
  const open=(target,options={})=>{
    const event=new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,...options});target.dispatchEvent(event);
    return {event,context:JSON.parse(content.dataset.vscodeContext),message:messages.at(-1)};
  };
  const plan=(target,settings={})=>{
    const position=resolveReadingPosition(parsed,built.sourceBlocks,target);
    const result=makeReadingPlan(parsed,{from:position.from,to:parsed.length},'from',{academicTableMode:'all',...settings},position);
    return {position,result,speech:result.queue.map(p=>p.text).join('')};
  };
  return {win,content,messages,menu,parsed,built,select,open,plan,primed:()=>primed};
}
test('原生右键菜单保留复制入口，选择普通文字后从确切起点继续到文档末尾',t=>{
  const markdown='# 开头\n\n前半句，选中文字和后半句。\n\n## 下一节\n\n继续读下文。';
  const f=fixture(t,markdown),block=f.content.querySelector('p [data-read-block]'),node=block.firstChild;
  f.select(node,node.textContent.indexOf('选中'),node.textContent.indexOf('选中')+4);
  const selected=f.win.getSelection().toString(),opened=f.open(block);
  assert.equal(opened.event.defaultPrevented,false);assert.equal(opened.context.mdReaderReadAvailable,true);
  assert.equal(opened.context.preventDefaultContextMenuItems,undefined);assert.equal(opened.message.type,'readContext');
  assert.equal(f.win.getSelection().toString(),selected);assert.equal(f.messages.length,1);assert.equal(f.primed(),1);
  const {speech,result,position}=f.plan(opened.message.target);
  assert.match(speech,/^选中文字和后半句/);assert.match(speech,/继续读下文/);assert.doesNotMatch(speech,/前半句|开头/);
  assert.equal(position.from,f.parsed.blocks[1].from);
  assert.ok(result.queue.flatMap(p=>p.ranges).every(r=>f.parsed.blocks.some(b=>b.from===r.from&&b.to===r.to)));
});
test('反向选区和同一段内重复文字使用 Range 起点，不匹配到第一次出现的位置',t=>{
  const f=fixture(t,'重复文字、前面的句子。重复文字、后面的句子。\n\n收尾。'),block=f.content.querySelector('[data-read-block]'),node=block.firstChild;
  const start=node.textContent.lastIndexOf('重复文字');
  f.win.getSelection().setBaseAndExtent(node,start+4,node,start);
  const {speech}=f.plan(f.open(block).message.target);
  assert.match(speech,/^重复文字、后面的句子/);assert.doesNotMatch(speech,/前面的句子/);assert.match(speech,/收尾/);
});
test('相同段落的起点取自第二个源码块，不通过全文搜索选中文字',t=>{
  const f=fixture(t,'相同文字。\n\n相同文字。\n\n尾部。'),blocks=f.content.querySelectorAll('[data-read-block]');
  f.select(blocks[1].firstChild,0,4);const target=f.open(blocks[1]).message.target,{speech,position}=f.plan(target);
  assert.equal(position.from,f.parsed.blocks[1].from);assert.equal((speech.match(/相同文字/g)||[]).length,1);assert.match(speech,/尾部/);
});
test('粗体、链接、换行及前置行内公式不破坏选中位置，术语仍走 Cozy 处理',t=>{
  const markdown='开始 **加粗** 与 [链接](https://example.org)，在 \\(x_i\\) 后\n选择 CVaR 目标文本。\n\n末尾内容。';
  const f=fixture(t,markdown),block=f.content.querySelector('[data-read-block]'),node=block.lastChild;
  const start=node.textContent.indexOf('CVaR');assert.ok(start>=0);f.select(node,start,start+4);
  const {speech}=f.plan(f.open(block).message.target,{speechTermsEnabled:true,speechTerms:'CVaR=条件风险价值'});
  assert.match(speech,/^条件风险价值 目标文本/);assert.match(speech,/末尾内容/);assert.doesNotMatch(speech,/加粗|链接|example|x_i/);
});
test('任务列表标记不计入朗读偏移，从第一个正文词开始时不会错位',t=>{
  const f=fixture(t,'- [x] 选中正文内容。\n\n后续。'),block=f.content.querySelector('[data-read-block]'),node=block.firstChild;
  f.select(node,node.textContent.indexOf('选中'),node.textContent.indexOf('选中')+2);
  const {speech}=f.plan(f.open(block).message.target);assert.match(speech,/^选中正文内容/);assert.match(speech,/后续/);assert.doesNotMatch(speech,/\[x\]/);
});
test('行内公式内部选区回到完整公式起点，保留后续原文高亮映射',t=>{
  const f=fixture(t,'前面的文字 $\\frac{1}{2}$ 后面继续。'),math=f.content.querySelector('.reader-math');
  const walk=f.win.document.createTreeWalker(math,f.win.NodeFilter.SHOW_TEXT);let node;
  while((node=walk.nextNode()))if(node.nodeValue.trim())break;
  f.select(node,0,1);const {speech,position}=f.plan(f.open(math).message.target);
  assert.ok(position.offset>0);assert.match(speech,/2 分之 1/);assert.match(speech,/后面继续/);assert.doesNotMatch(speech,/前面的文字|\\frac/);
});
test('块级公式和表格作为完整对象启读，不把数学 DOM 或表格单元格当作文本偏移',t=>{
  const f=fixture(t,'前文。\n\n$$\\frac{1}{2}$$\n\n|指标|数值|\n|---|---|\n|风险|0.25|\n\n尾部。');
  const math=f.content.querySelector('[data-read-atomic]');
  const first=f.plan(f.open(math).message.target);assert.equal(first.position.offset,0);assert.match(first.speech,/2 分之 1/);assert.doesNotMatch(first.speech,/前文/);
  const cell=f.content.querySelector('td'),node=cell.firstChild;f.select(node,0,node.length);
  const table=f.plan(f.open(cell).message.target);assert.equal(table.position.kind,'table');assert.equal(table.position.offset,0);
  assert.match(table.speech,/指标[:：]\s*风险[;；]\s*数值[:：]\s*0.25/);assert.match(table.speech,/尾部/);
});
test('没有选区时，右键点击段落从该段开始，不回到章首',t=>{
  const f=fixture(t,'# 章标题\n\n第一段。\n\n第二段 **正文**。\n\n第三段。');
  const clicked=f.content.querySelector('strong'),opened=f.open(clicked),{speech}=f.plan(opened.message.target);
  assert.equal(opened.message.target.prefix,'');assert.match(speech,/^第二段 正文/);assert.match(speech,/第三段/);assert.doesNotMatch(speech,/章标题|第一段/);
});
test('在现有选区之外右键时，使用本次点击段落而不是过期选区',t=>{
  const f=fixture(t,'旧选区内容。\n\n本次点击内容。'),blocks=f.content.querySelectorAll('[data-read-block]');
  const range=f.select(blocks[0].firstChild,0,3);range.getClientRects=()=>[{left:0,right:100,top:0,bottom:30}];
  const {speech}=f.plan(f.open(blocks[1],{clientX:250,clientY:100}).message.target);
  assert.match(speech,/^本次点击内容/);assert.doesNotMatch(speech,/旧选区/);
});
test('选区从段落外的元素边界开始时，正确找到后续的第一个朗读块',t=>{
  const f=fixture(t,'前一段。\n\n选中的段落。\n\n后续。'),paragraphs=f.content.querySelectorAll('p');
  const range=f.win.document.createRange();range.setStart(paragraphs[0],1);range.setEnd(paragraphs[1].querySelector('span').firstChild,3);
  f.win.getSelection().addRange(range);
  const {speech}=f.plan(f.open(paragraphs[1]).message.target);assert.match(speech,/^选中的段落/);assert.doesNotMatch(speech,/前一段/);
});
test('代码、Mermaid 与空白区域保留原生菜单，不提供无效的朗读项',t=>{
  const f=fixture(t,'```js\nconst x=1;\n```\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n正文。');
  for(const pre of f.content.querySelectorAll('pre'))assert.equal(f.open(pre).context.mdReaderReadAvailable,false);
  assert.equal(f.open(f.content).context.mdReaderReadAvailable,false);assert.equal(f.primed(),0);
});
test('重绘后清除旧菜单上下文，并使用新的请求标识',t=>{
  const f=fixture(t,'正文。'),block=f.content.querySelector('[data-read-block]');
  const first=f.open(block).context;f.menu.reset(2);
  assert.equal(JSON.parse(f.content.dataset.vscodeContext).mdReaderReadAvailable,false);
  const next=f.open(block).context;assert.notEqual(first.mdReaderReadContextId,next.mdReaderReadContextId);assert.equal(next.mdReaderReadRenderId,2);
});
test('不接受未知源码块或不匹配的客户端前缀，命令仅贡献到自己的预览菜单',t=>{
  const f=fixture(t,'正文。'),block=f.content.querySelector('[data-read-block]');
  assert.throws(()=>f.plan({blockId:'invalid',prefix:''}),/正文|选择/);
  assert.throws(()=>f.plan({blockId:block.dataset.readBlock,prefix:'伪造内容'}),/对齐/);
  const pkg=require('../package.json'),item=pkg.contributes.menus['webview/context'].find(x=>x.command==='mdReader.readFromPreviewSelection');
  assert.ok(item);assert.match(item.when,/webviewId == mdReader.preview/);assert.match(item.when,/mdReaderReadAvailable/);
});
