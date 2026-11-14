'use strict';
// 独立宿主中的实际交互观察，只写公开夹具的播放状态，不提供注入 UI 或运行任意代码的入口。
const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
  const ext=vscode.extensions.getExtension('local-tools.markdown-section-reader'),api=await ext.activate();
  const ide=/[\\/]\.qoder[\\/]/i.test(ext.extensionPath)?'qoder':'cursor';
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'qa/朗读改善验证.md')));
  await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:false}); await vscode.commands.executeCommand('mdReader.openPreview');
  const settingsBefore=JSON.stringify(vscode.workspace.getConfiguration('mdReader'));
  const started=new Date().toISOString(),manifest=JSON.parse(await fs.readFile(path.join(root,'dist/manifest.json'),'utf8'));
  const allowed=new Set(['朗读改善验证.md','公式图表验证.md','选区引用验证.md']);
  while(true){
    let control={};try{control=JSON.parse(await fs.readFile(path.join(root,`qa/${ide}-interaction-control.json`),'utf8'));}catch{}
    const state=api.getState();
    await fs.writeFile(path.join(root,`qa/${ide}-interaction-live.json`),JSON.stringify({started,version:ext.packageJSON.version,testedVsixSha256:manifest.sha256,
      settingsUnchanged:settingsBefore===JSON.stringify(vscode.workspace.getConfiguration('mdReader')),
      state:allowed.has(state.file)?state:{state:state.state,publicFixtureActive:false}},null,2)+'\n');
    if(control.finish){await vscode.commands.executeCommand('mdReader.stop');return;}
    await wait(150);
  }
};
