'use strict';
const { nativeCodeSelection } = require('./selection-reference.cjs');
function nativeChatCapability(commands) {
  if (commands.includes('composer.addsymbolstocomposer')) return { kind: 'cursor', command: 'composer.addsymbolstocomposer', label: '添加到 Cursor 聊天' };
  if (commands.includes('aicoding.ide.inline.chat.addToChat')) return { kind: 'qoder', command: 'aicoding.ide.inline.chat.addToChat', label: '添加到 Qoder 聊天' };
}
async function addQoderSelection(vscode, document, reference, viewColumn, isCurrent = () => true) {
  // Qoder 原生命令读取活动源码编辑器；不伪造内部编辑器对象、不注入工作台脚本。
  const payload = nativeCodeSelection(document, reference);
  let editor = await vscode.window.showTextDocument(document, { viewColumn, preserveFocus: false, preview: false });
  if (!isCurrent()) throw new Error('文档已变化，请重新选择。');
  const available = await vscode.commands.getCommands(true);
  const chatViews = available.filter(id => /^aicoding-chat-.+\.view\.focus$/.test(id));
  // 首次创建聊天时，原生添加命令会在输入框挂载前发出插入事件。
  // 先打开聊天并等待挂载，再添加选区；不发送文字，不新建已有会话。
  editor.selection = new vscode.Selection(reference.startLine - 1, 0, reference.startLine - 1, 0);
  if (chatViews.length === 1) await vscode.commands.executeCommand(chatViews[0]);
  else if (!chatViews.length && available.includes('workbench.action.aichat.open')) await vscode.commands.executeCommand('workbench.action.aichat.open');
  else await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!isCurrent()) throw new Error('文档已变化，请重新选择。');
  editor = await vscode.window.showTextDocument(document, { viewColumn, preserveFocus: false, preview: false });
  if (!isCurrent() || vscode.window.activeTextEditor !== editor) throw new Error('原文选区已变化，请重新选择。');
  editor.selection = new vscode.Selection(reference.startLine - 1, 0, reference.endLine - 1, payload.range.endColumn - 1);
  const until = Date.now() + 1500;
  while (vscode.window.activeTextEditor !== editor && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 30));
  if (!isCurrent() || vscode.window.activeTextEditor !== editor) throw new Error('未能定位原文选区，请重试或使用“复制提问引用”。');
  // 扩展宿主确认活动编辑器后，工作台还需完成焦点切换，原生聊天入口才能保留插入位置。
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!isCurrent()) throw new Error('文档已变化，请重新选择。');
  await vscode.commands.executeCommand('aicoding.ide.inline.chat.addToChat');
  // Qoder 的插入事件先于输入框渲染完成；立即恢复 Webview 会丢失可见引用。
  await new Promise(resolve => setTimeout(resolve, 300));
}
module.exports = { nativeChatCapability, addQoderSelection };
