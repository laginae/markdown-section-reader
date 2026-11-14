'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeChatCapability, addQoderSelection } = require('../src/native-chat.cjs');
const { clipboardReference } = require('../src/selection-reference.cjs');

test('按实际注册命令识别 Cursor 和 Qoder，其他宿主不显示原生按钮', () => {
  assert.equal(nativeChatCapability(['composer.addsymbolstocomposer']).kind, 'cursor');
  assert.equal(nativeChatCapability(['aicoding.ide.inline.chat.addToChat']).kind, 'qoder');
  assert.equal(nativeChatCapability(['workbench.action.chat.open']), undefined);
});

test('Qoder 原生桥接选择完整源码行；剪贴板单独保留精确选中文字', async () => {
  const text = '前缀 选中文字 后缀', document = { uri: {path:'/sample.md'}, lineCount:1,
    lineAt: () => ({text,range:{start:{character:0},end:{character:text.length}}}), offsetAt:p=>p.character,getText:()=>text };
  const calls = [], editor = {document};
  const vscode = { Selection:class{constructor(...args){this.args=args;}},
    window:{activeTextEditor:editor,showTextDocument:async()=>editor},
    commands:{getCommands:async()=>['workbench.action.aichat.open'],executeCommand:async(...args)=>calls.push({args,selection:editor.selection.args})} };
  const ref={startLine:1,endLine:1};
  await addQoderSelection(vscode,document,ref,2);
  assert.deepEqual(calls.map(c=>c.args),[['workbench.action.aichat.open'],['workbench.action.focusActiveEditorGroup'],['aicoding.ide.inline.chat.addToChat']]);
  assert.deepEqual(calls[0].selection,[0,0,0,0]);
  assert.deepEqual(calls[2].selection,[0,0,0,text.length]);
  assert.equal(clipboardReference('sample.md',ref,'选中文字'),'@sample.md line:1\n选中内容：\n> 选中文字');
  await assert.rejects(addQoderSelection(vscode,document,ref,2,()=>false),/文档已变化/);
});
