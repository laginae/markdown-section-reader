'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseMarkdown, sectionAt } = require('./markdown.cjs');
const { makeReadingPlan, normalizeReadingSettings, academicPreview } = require('./speech-plan.cjs');
const { AudioPreparation, AudioCache } = require('./audio-preparation.cjs');
const { synthesize, listSystemVoices, importObsidianSecret, readObsidianSpeechPreferences } = require('./speech.cjs');
const { buildPreview } = require('./preview.cjs');
const { resolveReference, nativeCodeSelection, selectionText, clipboardReference } = require('./selection-reference.cjs');
const { nativeChatCapability, addQoderSelection } = require('./native-chat.cjs');
const { resolveReadingPosition } = require('./reading-position.cjs');

function activate(context) {
  let view, panel, ready = false, doc, parsed, selected, session, serial = 0, revision = 0;
  let state = 'idle', detail = '打开 Markdown 文档开始使用。', voiceCache, voiceRequest;
  let controlsCollapsed = context.globalState.get('controlsCollapsed', false);
  let readingPreview, previewDoc, previewReady = false;
  let previewFeedback = {};
  let previewRenderId = 0;
  let previewSourceBlocks = [], previewSelection, chatBusy = false, lastChatReference, copyBusy = false, lastCopiedReference;
  let previewParsed, previewReadContext;
  let renderedPreviewDoc, renderedPreviewVersion;
  let tabRequest = 0;
  const audioCache = new AudioCache();
  const trace = [];
  const highlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    border: '1px solid', borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
    isWholeLine: true, overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center
  });
  const config = () => vscode.workspace.getConfiguration('mdReader');
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  function systemVoices(refresh = false) {
    if (voiceCache && !refresh) return Promise.resolve(voiceCache);
    if (!voiceRequest) voiceRequest = Promise.resolve().then(() => listSystemVoices())
      .then(voices => (voiceCache = voices)).finally(() => { voiceRequest = undefined; });
    return voiceRequest;
  }
  const event = (type, fields = {}) => {
    trace.push({ type, at: Date.now(), ...fields }); if (trace.length > 300) trace.shift();
  };
  const post = m => view?.webview.postMessage(m);
  const postPlayback = m => session?.surface === 'preview' ? readingPreview?.webview.postMessage(m) : post(m);
  function snapshot() {
    return { state, detail, revision, selected: selected?.id, engine: config().get('engine'), controlsCollapsed,
      preferences: { ...readSettings(), speechTerms: undefined, doubleClickRead: config().get('doubleClickRead', true), floatingButton: config().get('floatingButton', true), showHeadingLevels: config().get('showHeadingLevels', false) },
      preview: { open: !!readingPreview, ready: previewReady, visible: !!readingPreview?.visible,
        selection: previewSelection?.reference, chatBusy, lastChatReference, copyBusy, lastCopiedReference, ...previewFeedback },
      file: doc ? path.basename(doc.fileName) : '', headings: parsed?.headings || [], ready, surface: panel ? 'editor' : 'sidebar',
      session: session ? { id: session.id, engine: session.settings.engine, index: session.index, surface: session.surface,
        total: session.queue.length, segments: session.segmentCount, mode: session.mode, from: session.from, to: session.to,
        current: session.queue[session.index] && { from: session.queue[session.index].from, to: session.queue[session.index].to,
          ranges: session.queue[session.index].ranges, segment: session.queue[session.index].segment },
        duration: session.duration, time: session.time || 0, diagnostics: session.preparation?.timings.snapshot() } : null };
  }
  function update() {
    const value = snapshot(); post({ type: 'state', ...value });
    if (readingPreview && previewReady) readingPreview.webview.postMessage({ type: 'readerState', ...value, sameDocument: doc === previewDoc });
  }
  function clearHighlight() {
    for (const ed of vscode.window.visibleTextEditors) ed.setDecorations(highlight, []);
    readingPreview?.webview.postMessage({ type: 'highlight', version: previewDoc?.version });
  }
  function mark() {
    const s = session, chunk = s?.queue[s.index];
    if (!s || !chunk || !['playing', 'paused'].includes(state)) return;
    if (previewDoc === s.document) readingPreview?.webview.postMessage({ type: 'highlight', version: previewDoc.version,
      ranges: chunk.ranges, range: chunk.ranges[0], follow: config().get('follow', true) && state === 'playing' });
    const ranges = chunk.ranges.map(r => new vscode.Range(s.document.positionAt(r.from), s.document.positionAt(Math.max(r.from, r.to - 1))));
    for (const ed of vscode.window.visibleTextEditors) {
      ed.setDecorations(highlight, ed.document === s.document ? ranges : []);
      if (ed.document === s.document && config().get('follow', true) && state === 'playing') ed.revealRange(ranges[0], vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }
  function stop(message = '已停止朗读。') {
    serial++; clearTimeout(session?.startTimer); session?.abort.abort(); session = undefined;
    state = 'idle'; detail = message; post({ type: 'stop' }); readingPreview?.webview.postMessage({ type: 'stop' }); clearHighlight(); event('stop'); update();
  }
  function readSettings(overrides = {}) {
    const cfg = config(), values = {};
    for (const name of ['engine', 'systemVoice', 'mimoVoice', 'speed', 'volume', 'chunkLimit', 'buffering', 'quickStart',
      'academicMathMode', 'academicMathStyle', 'academicIntervalStyle', 'academicFunctionStyle', 'academicTableMode', 'academicTableRepeatHeaders', 'academicSkipNotice', 'mathReadingLanguage', 'speechTermsEnabled', 'speechTerms']) {
      values[name] = overrides[name] ?? cfg.get(name);
    }
    return normalizeReadingSettings(values);
  }
  function setDocument(editor) {
    if (!editor) return; // 点击侧栏时保留原 Markdown 文档。
    const next = editor.document.languageId === 'markdown' ? editor.document : undefined;
    if (next === doc) return;
    if (session || state === 'loading') stop('已切换文档，朗读已停止。');
    doc = next; parsed = doc ? parseMarkdown(doc.getText()) : undefined;
    selected = doc ? sectionAt(parsed, doc.offsetAt(editor.selection.active)) : undefined;
    revision++; detail = doc ? '点击标题跳转，选择章节后朗读。' : '打开 Markdown 文档开始使用。'; update();
  }
  async function syncActiveMarkdownTab() {
    const request = ++tabRequest, tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const uri = tab?.input?.uri;
    if (!uri || !/\.(?:md|markdown|mdown)$/i.test(uri.path) || vscode.window.activeTextEditor) return;
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      if (request === tabRequest && tab === vscode.window.tabGroups.activeTabGroup.activeTab && document.languageId === 'markdown') {
        setDocument({ document, selection: { active: new vscode.Position(0, 0) } });
      }
    } catch { /* 预览标签没有可读取的文本资源时，保留已明确打开的文档。 */ }
  }
  async function ensureView() {
    if (panel) {
      // 用户可能在目录所在分栏里打开另一篇 Markdown，重新朗读不能遮住该原文。
      const sourceEditor = vscode.window.visibleTextEditors.find(e => e.document === doc);
      panel.reveal(sourceEditor && sourceEditor.viewColumn === panel.viewColumn ? vscode.ViewColumn.Beside : undefined, true);
    }
    else {
      await vscode.commands.executeCommand('workbench.view.extension.markdown-reader');
      await vscode.commands.executeCommand('markdown-reader.outline.focus');
      const sidebarDeadline = Date.now() + 2500;
      while (!ready && Date.now() < sidebarDeadline) await new Promise(r => setTimeout(r, 50));
      if (!ready && !panel) {
        // Cursor 3 的自定义侧栏在恢复布局时可能不挂载视图；用公开 Panel API 保持可用。
        panel = vscode.window.createWebviewPanel('mdReader.reader', '目录与朗读',
          { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { retainContextWhenHidden: true });
        resolveReader(panel, 'editor'); event('sidebarFallback');
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
      }
    }
    const until = Date.now() + 12000;
    while (!ready && Date.now() < until) await new Promise(r => setTimeout(r, 50));
    if (!ready) throw new Error('朗读面板尚未就绪，请重新打开目录与朗读。');
  }
  function findSection(id) {
    return id === undefined ? selected || (parsed && sectionAt(parsed, 0)) : parsed?.headings.find(h => h.id === String(id));
  }
  function usePreviewDocument() {
    if (previewDoc && !previewDoc.isClosed && doc !== previewDoc) setDocument({ document: previewDoc, selection: { active: new vscode.Position(0, 0) } });
  }
  function previewContent(force = false) {
    if (!readingPreview || !previewDoc || previewDoc.isClosed || !previewReady) return;
    if (!force && renderedPreviewDoc === previewDoc && renderedPreviewVersion === previewDoc.version) return;
    const folder = vscode.Uri.joinPath(previewDoc.uri, '..');
    const imageUri = src => {
      if (previewDoc.isUntitled || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(src)) return;
      try {
        const resource = vscode.Uri.joinPath(folder, decodeURIComponent(src.split(/[?#]/)[0]));
        // 仅显示文档所在目录内的本地图片；不自动加载远程图片。
        if (!resource.path.startsWith(folder.path.replace(/\/$/, '') + '/')) return;
        return readingPreview.webview.asWebviewUri(resource).toString();
      } catch { return; }
    };
    const text = previewDoc.getText();
    previewParsed = doc === previewDoc ? parsed : parseMarkdown(text);
    const rendered = buildPreview(text, imageUri, previewParsed.blocks);
    renderedPreviewDoc = previewDoc; renderedPreviewVersion = previewDoc.version;
    previewSourceBlocks = rendered.sourceBlocks; previewSelection = undefined; previewReadContext = undefined;
    const renderId = ++previewRenderId; previewFeedback = { renderId, renderComplete: false };
    readingPreview.webview.postMessage({ type: 'content', version: previewDoc.version, renderId, html: rendered.html });
    mark();
  }
  function rememberPreviewSelection(m) {
    const reference = resolveReference(previewSourceBlocks, m.ids);
    previewSelection = reference ? { ids: [...new Set(m.ids)], reference, text: m.text, version: m.version, renderId: m.renderId } : undefined;
  }
  function rememberPreviewReadContext(m) {
    if (typeof m.requestId !== 'string' || !/^\d+:\d+$/.test(m.requestId) || m.requestId.length > 80) return;
    const value = { requestId: m.requestId, version: m.version, renderId: m.renderId, source: previewDoc };
    if (m.target) {
      try { value.position = resolveReadingPosition(previewParsed, previewSourceBlocks, m.target); }
      catch (e) { value.error = e.message; }
    }
    previewReadContext = value;
  }
  async function readFromPreviewSelection(menuContext) {
    const source = previewDoc, p = readingPreview;
    const requestId = menuContext?.mdReaderReadContextId;
    if (menuContext?.webview !== 'mdReader.preview' || typeof requestId !== 'string' || !source || source.isClosed || !p) throw new Error('请在朗读预览正文中右键选择朗读起点。');
    // 等待右键快照到达，不依赖原生菜单夺取焦点后的浏览器选区。
    const until = Date.now() + 500;
    while (previewReadContext?.requestId !== requestId && Date.now() < until && readingPreview === p) await new Promise(resolve => setTimeout(resolve, 20));
    const chosen = previewReadContext;
    if (readingPreview !== p || previewDoc !== source || source.isClosed || !chosen || chosen.requestId !== requestId
      || chosen.source !== source || source.version !== chosen.version || chosen.renderId !== previewRenderId || menuContext.mdReaderReadRenderId !== chosen.renderId) throw new Error('朗读起点已失效，请重新右键选择。');
    if (chosen.error) throw new Error(chosen.error);
    if (!chosen.position) throw new Error('当前位置没有可朗读的正文，请重新选择。');
    usePreviewDocument();
    event('previewPositionRead', { from: chosen.position.from, offset: chosen.position.offset, startLine: chosen.position.startLine });
    await startReading('from', undefined, {}, 'preview', chosen.position);
  }
  async function copyPreviewSelectionReference() {
    const source = previewDoc, chosen = previewSelection, p = readingPreview;
    if (copyBusy) return;
    if (!source || source.isClosed || !chosen || source.version !== chosen.version || chosen.renderId !== previewRenderId) throw new Error('请先在朗读预览中选中内容，再复制提问引用。');
    const reference = resolveReference(previewSourceBlocks, chosen.ids);
    if (!reference) throw new Error('选区位置已变化，请重新选择。');
    copyBusy = true;
    const status = fields => p.webview.postMessage({ type: 'copyStatus', version: chosen.version, renderId: chosen.renderId, ...fields });
    status({ busy: true }); update();
    try {
      const folder = vscode.workspace.getWorkspaceFolder(source.uri);
      const filePath = folder ? vscode.workspace.asRelativePath(source.uri, vscode.workspace.workspaceFolders.length > 1)
        : source.isUntitled ? source.uri.toString() : source.fileName;
      const text = selectionText(chosen.text), payload = clipboardReference(filePath, reference, text);
      // 仅在用户明确点击复制/执行命令时写剪贴板；不打开聊天、不发送问题。
      await vscode.env.clipboard.writeText(payload);
      lastCopiedReference = { file: path.basename(source.fileName), startLine: reference.startLine, endLine: reference.endLine,
        characters: text.length, pathKind: folder ? 'workspace-relative' : source.isUntitled ? 'untitled' : 'absolute', at: Date.now() };
      event('clipboardReferenceCopied', { startLine: reference.startLine, endLine: reference.endLine, characters: text.length, pathKind: lastCopiedReference.pathKind });
      status({ busy: false, copied: true });
    } catch (e) { status({ busy: false, error: e.message }); throw e; }
    finally { copyBusy = false; update(); }
  }
  async function addPreviewSelectionToChat() {
    const source = previewDoc, chosen = previewSelection, p = readingPreview;
    if (chatBusy) return;
    if (!source || source.isClosed || !chosen || source.version !== chosen.version || chosen.renderId !== previewRenderId) throw new Error('请先在朗读预览中选中内容，再添加到聊天。');
    const reference = resolveReference(previewSourceBlocks, chosen.ids);
    if (!reference) throw new Error('选区位置已变化，请重新选择。');
    chatBusy = true;
    p.webview.postMessage({ type: 'chatStatus', busy: true }); update();
    try {
      const available = await vscode.commands.getCommands(true);
       const capability = nativeChatCapability(available), command = capability?.command;
       if (!command) throw new Error('当前 IDE 未提供可用的原生行号引用入口，请使用“复制提问引用”。');
      if (source.version !== chosen.version || previewDoc !== source || previewRenderId !== chosen.renderId) throw new Error('文档已变化，请重新选择。');
      // 使用 Cursor 原生的代码选区引用；不操作剪贴板，不提交提问。
      const payload = { codeSelections: [nativeCodeSelection(source, reference)] };
      let dispatched = command;
       if (capability.kind === 'qoder') {
         await addQoderSelection(vscode, source, reference, p.viewColumn,
           () => source.version === chosen.version && previewDoc === source && previewRenderId === chosen.renderId);
         // 原生入口会聚焦聊天，恢复预览标签但保留聊天输入焦点。
         if (readingPreview === p) p.reveal(p.viewColumn, true);
       } else {
      for (let attempt = 0; ; attempt++) {
        if (source.version !== chosen.version || previewDoc !== source) throw new Error('文档已变化，请重新选择。');
        try { await vscode.commands.executeCommand(command, payload); break; }
        catch (e) {
          // 首次调用会异步打开空聊天，句柄尚未就绪时该命令还未插入引用。
          if (!/Composer handle not provided|Composer is not loaded/i.test(e.message || '')) throw e;
          if (attempt < 3) { await new Promise(r => setTimeout(r, [100, 300, 600][attempt])); continue; }
          if (!available.includes('composer.addsymbolstonewcomposer')) throw e;
          dispatched = 'composer.addsymbolstonewcomposer';
          await vscode.commands.executeCommand(dispatched, payload); break;
        }
      }
       }
       lastChatReference = { file: path.basename(source.fileName), startLine: reference.startLine, endLine: reference.endLine, command: dispatched, kind: capability.kind, at: Date.now() };
      event('chatReferenceAdded', { startLine: reference.startLine, endLine: reference.endLine, command: dispatched });
      p.webview.postMessage({ type: 'chatStatus', busy: false, added: true, startLine: reference.startLine, endLine: reference.endLine });
    } catch (e) {
      p.webview.postMessage({ type: 'chatStatus', busy: false, error: e.message }); throw e;
    } finally { chatBusy = false; update(); }
  }
  async function openPreview() {
    if (!doc || doc.isClosed) throw new Error('请先打开 Markdown 文件。');
    const target = doc;
    await ensureView();
    if (target !== doc || target.isClosed) return;
    previewDoc = target;
    if (readingPreview) { readingPreview.title = `朗读预览 · ${path.basename(target.fileName)}`; readingPreview.reveal(undefined, false); }
    else {
      const column = vscode.window.visibleTextEditors.find(e => e.document === target)?.viewColumn || vscode.ViewColumn.One;
      const p = readingPreview = vscode.window.createWebviewPanel('mdReader.preview', `朗读预览 · ${path.basename(target.fileName)}`, column, { retainContextWhenHidden: true });
      const media = vscode.Uri.joinPath(context.extensionUri, 'media'), nonce = randomBytes(24).toString('base64');
      const uri = name => p.webview.asWebviewUri(vscode.Uri.joinPath(media, name));
      p.webview.options = { enableScripts: true, localResourceRoots: [media, ...(target.isUntitled ? [] : [vscode.Uri.joinPath(target.uri, '..')])] };
      p.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${p.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${p.webview.cspSource}; font-src ${p.webview.cspSource}; media-src blob:;"><link rel="stylesheet" href="${uri('katex/katex.min.css')}"><link rel="stylesheet" href="${uri('preview.css')}"></head><body><header><button id="source">返回 Markdown</button></header><main id="content" tabindex="0" aria-label="朗读预览正文"></main><div id="selection-tools" hidden><button id="copy-reference" type="button">复制提问引用</button><button id="add-chat" type="button" hidden>添加到聊天</button></div><div id="chat-status" role="status" hidden></div><script nonce="${nonce}" src="${uri('player.js')}"></script><script nonce="${nonce}" src="${uri('preview-controls.js')}"></script><script nonce="${nonce}" src="${uri('preview-context.js')}"></script><script nonce="${nonce}" data-mermaid="${uri('renderers/mermaid.js')}" src="${uri('preview.js')}"></script></body></html>`;
      p.webview.onDidReceiveMessage(safe(async m => {
        if (!m || readingPreview !== p) return;
        if (m.type === 'ready') {
          previewReady = true; previewContent(true); update();
          const commands = await vscode.commands.getCommands(true);
          const capability = nativeChatCapability(commands);
          if (readingPreview === p && previewReady) p.webview.postMessage({ type: 'nativeChatCapability', available: !!capability, label: capability?.label });
          return;
        }
        if (['playing', 'paused', 'time', 'ended', 'audioError', 'audioBlocked'].includes(m.type)) {
          if (session?.surface === 'preview' && session.document === previewDoc) onAudioMessage(m); return;
        }
        if (m.version !== previewDoc?.version || m.renderId !== previewRenderId) return;
        if (m.type === 'readContext') { rememberPreviewReadContext(m); return; }
        if (m.type === 'readHeading' && config().get('doubleClickRead', true) && typeof m.id === 'string') {
          usePreviewDocument();
          if (parsed.headings.some(h => h.id === m.id)) { event('headingDoubleClick', { surface: 'preview', id: m.id }); await startReading('from', m.id, {}, 'preview'); }
          return;
        }
        const keyboardPause = m.type === 'previewControl' && m.source === 'keyboard' && m.action === 'pause';
        if (m.type === 'previewControl' && (keyboardPause || config().get('floatingButton', true))) {
          if (keyboardPause && (doc !== previewDoc || session?.id !== m.sessionId || session?.document !== previewDoc
            || !['playing', 'paused', 'ready', 'loading'].includes(state))) return;
          usePreviewDocument();
          if (m.action === 'read') {
            const h = m.id === 'intro' ? undefined : parsed.headings.find(h => h.id === m.id);
            if (m.id !== 'intro' && !h) return;
            event('floatingRead', { id: m.id }); await startReading('from', m.id, {}, 'preview');
          } else if (session?.id === m.sessionId && session.document === previewDoc) {
            event(keyboardPause ? 'keyboardControl' : 'floatingControl', { action: m.action, id: session.id });
            if (m.action === 'pause' && state === 'ready' && session.surface !== 'preview') {
              post({ type: 'stop' }); session.surface = 'preview'; session.paused = false; void prepareNext(session);
            } else if (['pause', 'stop', 'seekBackward', 'seekForward'].includes(m.action)) await commands[m.action]();
          }
          update(); return;
        }
        if (m.type === 'previewControlsRendered') {
          previewFeedback.controls = { visible: m.visible === true, doubleClickRead: m.doubleClickRead === true, active: m.active === true, canSeek: m.canSeek === true,
            action: m.action === 'pause' ? 'pause' : 'read' }; return;
        }
        if (m.type === 'selectionChanged') {
          rememberPreviewSelection(m);
          update(); return;
        }
        if (m.type === 'copyReference') { rememberPreviewSelection(m); await copyPreviewSelectionReference(); return; }
        if (m.type === 'addToChat') { await addPreviewSelectionToChat(); return; }
        if (m.type === 'rendered' && Number.isInteger(m.headings)) { previewFeedback.headings = m.headings; event('previewRendered', { headings: m.headings }); }
        if (m.type === 'renderFinished') {
          for (const k of ['headings', 'formulas', 'mathErrors', 'diagrams', 'diagramErrors']) if (Number.isInteger(m[k]) && m[k] >= 0) previewFeedback[k] = m[k];
          previewFeedback.fontsReady = m.fontsReady === true; previewFeedback.renderComplete = true;
          event('previewRenderComplete', { formulas: previewFeedback.formulas, diagrams: previewFeedback.diagrams, diagramErrors: previewFeedback.diagramErrors });
        }
        if (m.type === 'revealed' && typeof m.id === 'string') { previewFeedback.revealed = m.id; previewFeedback.revealedInViewport = m.inViewport === true; event('previewRevealed', { id: m.id }); }
        if (m.type === 'highlighted' && (m.from === null || Number.isInteger(m.from))) { previewFeedback.highlighted = m.from; previewFeedback.highlightedInViewport = m.inViewport === true; event('previewHighlighted', { from: m.from }); }
        if (m.type === 'select' && typeof m.id === 'string') { usePreviewDocument(); const h = findSection(m.id); if (h) { selected = h; update(); } }
        if (m.type === 'source') { usePreviewDocument(); await vscode.window.showTextDocument(previewDoc, { viewColumn: p.viewColumn, preview: false }); }
        if (m.type === 'link' && typeof m.href === 'string' && /^https?:\/\//i.test(m.href)) await vscode.env.openExternal(vscode.Uri.parse(m.href));
      }), undefined, context.subscriptions);
      p.onDidChangeViewState(() => { if (p.active) { usePreviewDocument(); previewContent(); } }, undefined, context.subscriptions);
      p.onDidDispose(() => { if (readingPreview === p) { if (session?.surface === 'preview') stop('朗读预览已关闭。'); readingPreview = undefined; previewDoc = undefined; previewReady = false; previewFeedback = {}; previewReadContext = undefined; previewParsed = undefined; renderedPreviewDoc = undefined; renderedPreviewVersion = undefined; update(); } }, undefined, context.subscriptions);
    }
    readingPreview.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media'), ...(target.isUntitled ? [] : [vscode.Uri.joinPath(target.uri, '..')])] };
    previewContent(); event('previewOpened'); update();
  }
  async function setControlsCollapsed(value) {
    if (typeof value !== 'boolean') return;
    controlsCollapsed = value; update();
    await context.globalState.update('controlsCollapsed', value); event('controlsCollapsed', { value });
  }
  async function jump(id) {
    const h = findSection(id);
    if (!h || !doc || doc.isClosed) return;
    const target = doc;
    if (readingPreview?.visible && previewDoc === target && previewReady) {
      selected = h; readingPreview.webview.postMessage({ type: 'reveal', id: h.id, version: target.version }); update(); return;
    }
    const column = vscode.window.visibleTextEditors.find(ed => ed.document === target)?.viewColumn || vscode.ViewColumn.One;
    const editor = await vscode.window.showTextDocument(target, { viewColumn: column, preserveFocus: true, preview: false });
    if (doc !== target) return;
    selected = h;
    const pos = target.positionAt(h.from);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    event('jump', { line: pos.line, from: h.from }); update();
  }
  async function prepareNext(s) {
    if (session !== s || s.abort.signal.aborted) return;
    if (s.index >= s.queue.length) {
      s.abort.abort(); state = 'complete'; detail = '所选范围朗读完成。'; clearHighlight(); event('complete', { id: s.id, total: s.queue.length }); update(); return;
    }
    const index = s.index, generation = ++s.generation;
    s.token = undefined; s.audioSent = false; s.pendingAudio = undefined; s.time = 0; s.duration = 0;
    clearTimeout(s.startTimer);
    state = s.paused ? 'paused' : 'loading'; detail = s.paused ? '已暂停。' : `正在准备第 ${s.queue[index].segment + 1} / ${s.segmentCount} 段…`; clearHighlight(); update();
    try {
      const pending = s.preparation.get(index);
      s.preparation.prefetch(index);
      const result = await pending;
      if (session !== s || s.abort.signal.aborted || generation !== s.generation) return;
      s.duration = result.duration; s.pendingAudio = result;
      if (!s.paused) playPrepared(s);
    } catch (error) { if (session === s && !s.abort.signal.aborted && generation === s.generation) fail(error.message); }
  }
  function playPrepared(s) {
    if (session !== s || !s.pendingAudio || s.paused || s.abort.signal.aborted) return;
    s.token = `${s.id}:${s.index}:${s.generation}`; s.audioSent = true;
    const result = s.pendingAudio; s.pendingAudio = undefined;
    s.audioSentAt = s.preparation.timings.now();
    postPlayback({ type: 'audio', token: s.token, data: result.audio.toString('base64'), speed: s.settings.speed, volume: s.settings.volume });
    state = 'loading'; detail = '音频已准备好，正在播放…'; update();
    s.startTimer = setTimeout(() => { if (session === s && state === 'loading') fail('音频未能开始播放，请点击重试。'); }, 15000);
  }
  function togglePlayback() {
    const s = session;
    if (!s || s.abort.signal.aborted || !['loading', 'playing', 'ready', 'paused'].includes(state)) return;
    if (state === 'ready') { s.paused = false; postPlayback({ type: 'resume' }); return; }
    s.paused = !s.paused; s.preparation.pause(s.paused);
    clearTimeout(s.startTimer); s.preparation.timings.suspend();
    if (s.paused) { postPlayback({ type: 'pause' }); state = 'paused'; detail = '已暂停'; update(); }
    else if (s.pendingAudio) playPrepared(s);
    else if (s.audioSent) { postPlayback({ type: 'resume' }); }
    else { state = 'loading'; detail = '正在准备音频…'; update(); }
    if (!s.paused) s.preparation.prefetch(s.index, s.time, s.duration);
  }
  function movePart(delta) {
    const s = session;
    if (!s || s.abort.signal.aborted) return;
    const index = Math.max(0, Math.min(s.queue.length - 1, s.index + delta));
    if (index === s.index) return;
    postPlayback({ type: 'stop' }); s.index = index; s.preparation.select(index); s.preparation.timings.begin('jumpAudio'); void prepareNext(s);
  }
  function fail(message) {
    session?.abort.abort(); clearTimeout(session?.startTimer); postPlayback({ type: 'stop' });
    state = 'error'; detail = message || '朗读失败。'; clearHighlight(); event('error', { message: detail }); update();
  }
  async function startReading(mode = 'section', id, overrides = {}, surface = 'reader', position) {
    const started = now();
    const h = position && parsed ? { ...sectionAt(parsed, position.from), from: position.from, to: parsed.length } : findSection(id), source = doc;
    if (!h || !source || !parsed) return;
    const sourceParsed = parsed, sourceVersion = source.version;
    stop('正在准备朗读…');
    const attempt = serial;
    state = 'loading'; update();
    const current = () => attempt === serial && source === doc && !source.isClosed && source.version === sourceVersion;
    try {
      if (surface !== 'preview') await ensureView();
      else if (!readingPreview || !previewReady || previewDoc !== source) throw new Error('朗读预览尚未就绪，请重新打开。');
      if (!current()) return;
      const planningStarted = now();
      const plan = makeReadingPlan(sourceParsed, h, mode, readSettings(overrides), position);
      const preparationMilliseconds = now() - planningStarted;
      const { settings, queue, segmentCount } = plan;
      if (!queue.length) { state = 'idle'; detail = position ? '该位置之后没有可朗读的正文。' : '所选章节没有可朗读的正文。'; update(); return; }
      let key;
      if (settings.engine === 'mimo') {
        key = await context.secrets.get('mimo-api-key');
        if (!key) throw new Error('请先设置或从 Obsidian 导入 MiMo 密钥。');
      } else {
        const voices = await systemVoices();
        settings.voices = voices;
        settings.systemVoice ||= voices.find(v => /^zh/i.test(v.language))?.id || voices[0]?.id || '';
      }
      if (!current()) return;
      const liveSettings = readSettings(overrides);
      settings.speed = liveSettings.speed; settings.volume = liveSettings.volume;
      selected = position ? sectionAt(sourceParsed, h.from) : h;
      session = { id: attempt, index: 0, queue, settings, key, segmentCount, surface, generation: 0, paused: false, abort: new AbortController(), document: source,
        version: source.version, mode, from: h.from, to: mode === 'from' ? source.getText().length : h.to };
      const s = session;
      s.preparation = new AudioPreparation({ queue, settings, key, signal: s.abort.signal, synthesize, cache: audioCache,
        onPrepared: ({ index, result, cached, milliseconds }) => {
          if (session === s) event('synthesized', { id: s.id, index, engine: settings.engine, duration: result.duration, bytes: result.audio.length, cached, milliseconds });
        } });
      s.preparation.timings.record('textPreparation', preparationMilliseconds);
      s.preparation.timings.begin('firstAudio', started);
      event('start', { id: attempt, engine: settings.engine, surface, mode, from: session.from, to: session.to, total: queue.length });
      void prepareNext(session);
    } catch (error) { if (attempt === serial) fail(error.message); }
  }
  function onAudioMessage(m) {
    const s = session;
    if (!s || m.token !== s.token || s.abort.signal.aborted) return;
    if (m.type === 'playing' && ['loading', 'ready', 'paused'].includes(state)) {
      clearTimeout(s.startTimer);
      if (s.paused) { postPlayback({ type: 'pause' }); return; }
      if (s.lastPlayingToken !== s.token) {
        if (!s.awaitingUserPlayback) s.preparation.timings.playing(s.audioSentAt);
        s.lastPlayingToken = s.token; s.awaitingUserPlayback = false;
      }
      state = 'playing'; detail = `正在朗读第 ${s.queue[s.index].segment + 1} / ${s.segmentCount} 段`;
      mark(); event('playing', { id: s.id, index: s.index, from: s.queue[s.index].from, to: s.queue[s.index].to }); update();
      s.preparation.prefetch(s.index, s.time, s.duration);
    } else if (m.type === 'paused' && s.paused) {
      if (Number.isFinite(m.time) && m.time >= 0 && m.time <= s.duration + 1) s.time = m.time;
      state = 'paused'; detail = '已暂停'; event('paused'); mark(); update();
    }
    else if (m.type === 'time' && Number.isFinite(m.time) && m.time >= 0 && m.time <= s.duration + 1) {
      s.time = m.time; if (state === 'playing') s.preparation.prefetch(s.index, s.time, s.duration);
    }
    else if (m.type === 'ended' && ['playing', 'paused'].includes(state)) {
      s.preparation.timings.ended(); event('ended', { id: s.id, index: s.index, time: m.time }); s.token = undefined; s.index++; void prepareNext(s);
    } else if (m.type === 'audioBlocked') {
      s.awaitingUserPlayback = true; s.preparation.timings.suspend();
      clearTimeout(s.startTimer); state = 'ready'; detail = '语音已准备好，点击“播放”开始。'; event('awaitingUserPlayback'); update();
    } else if (m.type === 'audioError') { event('audioFailure', { name: String(m.name || '').slice(0, 60), code: m.code }); fail('音频播放失败，请重新开始朗读。'); }
  }
  const safe = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(e => { vscode.window.showErrorMessage(e.message || '操作失败'); });
  async function chooseVoice() {
    if (config().get('engine') === 'mimo') {
      const value = await vscode.window.showQuickPick(['冰糖', '茉莉', '苏打', '白桦', 'Dean', 'Milo', 'Mia', 'Chloe'], { title: '选择 MiMo 音色' });
      if (value) await config().update('mimoVoice', value, vscode.ConfigurationTarget.Global);
    } else {
      voiceCache = await systemVoices(true);
      const item = await vscode.window.showQuickPick(voiceCache.map(v => ({ label: v.name, description: v.language })), { title: '选择本机已安装的系统语音' });
      if (item) await config().update('systemVoice', item.label, vscode.ConfigurationTarget.Global);
    }
  }
  async function importKey(vault) {
    const key = await importObsidianSecret(typeof vault === 'string' ? vault : '');
    await context.secrets.store('mimo-api-key', key);
    vscode.window.showInformationMessage('MiMo 密钥已从 Obsidian 导入并存入当前 IDE 的密钥库。');
    event('credentialImported');
  }
  async function importCozySettings() {
    const profile = await readObsidianSpeechPreferences();
    const engine = profile.speechEngine === 'mimo-tts' ? 'mimo' : 'system';
    const settings = normalizeReadingSettings({ engine, mimoVoice: profile.mimoVoice,
      systemVoice: process.platform === 'win32' ? profile.systemVoiceWindows : profile.systemVoiceMac,
      speed: profile.playbackSpeed, volume: profile.playbackVolume, chunkLimit: profile.mimoChunkLimit,
      buffering: Number(profile.onlinePrefetchChunks) === 0 ? 'on-demand' : profile.continuousListening ? 'continuous' : 'balanced',
      quickStart: profile.smartQuickStart === false ? 'off' : profile.rapidQuickStart ? 'rapid' : 'standard',
      ...Object.fromEntries(['academicMathMode', 'academicMathStyle', 'academicIntervalStyle', 'academicFunctionStyle', 'academicTableMode', 'academicTableRepeatHeaders', 'academicSkipNotice', 'mathReadingLanguage', 'speechTermsEnabled', 'speechTerms'].map(k => [k, profile[k]])) });
    // 先确认语音所需密钥可用，再启用对应引擎。
    if (engine === 'mimo') {
      const key = await importObsidianSecret('', profile.mimoSecretName || 'xiaomi-mimo');
      await context.secrets.store('mimo-api-key', key);
    }
    stop(); audioCache.clear();
    for (const [name, value] of Object.entries(settings)) if (name !== 'engine' && value !== undefined) await config().update(name, value, vscode.ConfigurationTarget.Global);
    await config().update('engine', engine, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('已导入 Cozy 的语音、倍速、公式、术语与缓冲设置。MiMo 密钥保存在当前 IDE 的密钥库中。');
  }
  const commands = {
    open: ensureView, openPreview, copyPreviewSelectionReference, addPreviewSelectionToChat, readFromPreviewSelection, toggleControls: () => setControlsCollapsed(!controlsCollapsed), readSection: () => startReading('section'), readFrom: () => startReading('from'),
    pause: togglePlayback, stop: () => stop(), chooseVoice,
    previous: () => movePart(-1), next: () => movePart(1),
    seekBackward: () => postPlayback({ type: 'seek', seconds: -5 }), seekForward: () => postPlayback({ type: 'seek', seconds: 5 }),
    configure: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-tools.markdown-section-reader'),
    clearAudioCache: () => { stop(); audioCache.clear(); vscode.window.showInformationMessage('本次 IDE 运行期间的朗读音频缓存已清除。'); },
    importObsidianKey: importKey, importCozySettings,
    setKey: async () => {
      const value = await vscode.window.showInputBox({ title: '设置 MiMo 密钥', prompt: '只保存到当前 IDE 的密钥库，不写入工作区。', password: true, ignoreFocusOut: true });
      if (value?.trim()) {
        if (value.length > 4096 || /[\r\n\x00]/.test(value)) throw new Error('密钥格式不正确。');
        await context.secrets.store('mimo-api-key', value.trim()); vscode.window.showInformationMessage('MiMo 密钥已保存。');
      }
    }
  };
  for (const [id, handler] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`mdReader.${id}`, safe(handler)));
  function resolveReader(v, surface = 'sidebar') {
      if (surface === 'sidebar' && panel) {
        v.webview.html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><p>目录与朗读已在编辑区的标签页中打开。</p></body></html>';
        return;
      }
      event('viewResolved', { surface });
      view = v; ready = false;
      const media = vscode.Uri.joinPath(context.extensionUri, 'media');
      v.webview.options = { enableScripts: true, localResourceRoots: [media] };
      const nonce = randomBytes(24).toString('base64');
      const uri = name => v.webview.asWebviewUri(vscode.Uri.joinPath(media, name));
      v.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource}; script-src 'nonce-${nonce}'; media-src blob:;"><link rel="stylesheet" href="${uri('reader.css')}"></head><body>
      <header><div id="file">打开 Markdown 文档</div><div class="compact-row"><button id="collapse" aria-expanded="true" aria-controls="controls">▾ 朗读控制</button><button id="preview" title="在朗读预览中跳转并高亮">朗读预览</button><span id="compact-playback" hidden><button id="compact-pause">暂停</button><button id="compact-stop">停止</button></span></div><div id="controls"><div class="toolbar"><select id="engine" aria-label="朗读引擎"><option value="system">系统语音 · 离线</option><option value="mimo">MiMo · 在线</option></select><button id="voice" title="选择语音">音色</button></div>
      <div class="toolbar"><button id="read">只读本节</button><button id="from">从本节开始</button></div>
      <div class="toolbar"><button id="pause" disabled>暂停</button><button id="stop" disabled>停止</button><button id="setup" title="从 Obsidian 导入 MiMo 密钥">导入 MiMo</button></div>
      <div class="toolbar"><button id="previous" title="上一音频片段">上一段</button><button id="backward" title="后退五秒">−5 秒</button><button id="forward" title="前进五秒">+5 秒</button><button id="next" title="下一音频片段">下一段</button></div>
      <details id="preferences"><summary>朗读设置</summary>
      <label>倍速<select id="speed"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2">2×</option></select></label>
      <label>音量<input id="volume" type="range" min="0" max="1" step="0.05" aria-label="音量"></label>
      <label>播放衔接<select id="buffering"><option value="continuous">连续播放</option><option value="balanced">提前准备一段</option><option value="on-demand">按需生成</option></select></label>
      <label>公式<select id="academicMathMode"><option value="smart">智能简读</option><option value="all">尽量完整读出</option><option value="skip">略过公式</option></select></label>
      <label>公式读法<select id="academicMathStyle"><option value="concise">简洁</option><option value="verbose">完整结构</option></select></label>
      <label>区间读法<select id="academicIntervalStyle"><option value="precise">保留端点条件</option><option value="range">起点到终点</option></select></label>
      <label>简单函数读法<select id="academicFunctionStyle"><option value="of">保留 of：f of x</option><option value="compact">省略 of：f x</option></select></label>
      <label class="check-setting"><input id="academicTableRepeatHeaders" type="checkbox">每行重复表头</label>
      <details id="academic-preview"><summary>实际读法预览（本地文字）</summary><dl></dl></details>
      <label>起播<select id="quickStart"><option value="standard">标准快启</option><option value="rapid">快速起播</option><option value="off">完整片段</option></select></label>
      <label class="check-setting"><input id="doubleClickRead" type="checkbox">双击标题从本节开始朗读</label>
      <label class="check-setting"><input id="floatingButton" type="checkbox">在朗读预览中显示悬浮按钮</label>
      <label class="check-setting"><input id="showHeadingLevels" type="checkbox">显示标题层级标记（H1–H6）</label>
      <div class="toolbar"><button id="configure">术语与更多设置</button><button id="import-cozy">导入 Cozy 设置</button></div></details>
      <div id="status" role="status" aria-live="polite"></div><div id="notice">点击目录标题跳转；本节包含子节。</div></div><div id="compact-status" role="status" hidden></div></header><main id="outline" aria-label="Markdown 章节目录"></main>
      <script nonce="${nonce}" src="${uri('player.js')}"></script><script nonce="${nonce}" src="${uri('reader.js')}"></script></body></html>`;
      v.webview.onDidReceiveMessage(safe(async m => {
        if (!m || typeof m.type !== 'string') return;
        if (m.type === 'ready') { ready = true; update(); return; }
        if (m.type === 'academicPreview') {
          const rows=academicPreview(readSettings({speechTermsEnabled:false,speechTerms:''}));
          v.webview.postMessage({type:'academicPreview',rows}); return;
        }
        if (m.type === 'collapse') { await setControlsCollapsed(m.value); return; }
        if (m.type === 'preview') { await openPreview(); return; }
        if (['playing', 'paused', 'time', 'ended', 'audioError', 'audioBlocked'].includes(m.type)) { if (session?.surface === 'reader') onAudioMessage(m); return; }
        if (m.type === 'engine' && ['system', 'mimo'].includes(m.value)) { stop(); await config().update('engine', m.value, vscode.ConfigurationTarget.Global); update(); return; }
        if (m.type === 'jump' && m.revision === revision && typeof m.id === 'string') { await jump(m.id); return; }
        if (m.type === 'readHeading' && m.revision === revision && config().get('doubleClickRead', true) && parsed?.headings.some(h => h.id === m.id)) {
          event('headingDoubleClick', { surface: 'reader', id: m.id }); await startReading('from', m.id); return;
        }
        if (m.type === 'read' && m.revision === revision && ['section', 'from'].includes(m.mode)) { await startReading(m.mode); return; }
        if (m.type === 'pause') commands.pause();
        if (m.type === 'stop') stop();
        if (['previous', 'next', 'seekBackward', 'seekForward', 'configure', 'importCozySettings'].includes(m.type)) await commands[m.type]?.();
        if (m.type === 'setting') {
          const allowed = { buffering: ['continuous', 'balanced', 'on-demand'], academicMathMode: ['smart', 'all', 'skip'],
            academicMathStyle: ['concise', 'verbose'], academicIntervalStyle: ['precise', 'range'], academicFunctionStyle: ['of', 'compact'], quickStart: ['off', 'standard', 'rapid'] };
          const numeric = m.name === 'speed' && Number.isFinite(m.value) && m.value >= .5 && m.value <= 2
            || m.name === 'volume' && Number.isFinite(m.value) && m.value >= 0 && m.value <= 1;
          const interaction = ['doubleClickRead', 'floatingButton', 'showHeadingLevels', 'academicTableRepeatHeaders'].includes(m.name) && typeof m.value === 'boolean';
          if (numeric || interaction || allowed[m.name]?.includes(m.value)) await config().update(m.name, m.value, vscode.ConfigurationTarget.Global);
        }
        if (m.type === 'voice') await chooseVoice();
        if (m.type === 'setup') await importKey();
      }), undefined, context.subscriptions);
      v.onDidDispose(() => {
        if (panel === v) panel = undefined;
        if (view === v) { ready = false; view = undefined; if (session?.surface !== 'preview') stop('朗读面板已关闭。'); }
      }, undefined, context.subscriptions);
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('markdown-reader.outline', {
    resolveWebviewView: v => resolveReader(v)
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('mdReader.reader', {
    async deserializeWebviewPanel(p) { panel = p; resolveReader(p, 'editor'); }
  }));
  context.subscriptions.push(highlight,
    vscode.window.onDidChangeActiveTextEditor(setDocument),
    vscode.window.tabGroups.onDidChangeTabs(() => void syncActiveMarkdownTab()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => void syncActiveMarkdownTab()),
    vscode.window.onDidChangeVisibleTextEditors(mark),
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (doc && e.textEditor.document === doc) { selected = sectionAt(parsed, doc.offsetAt(e.selections[0].active)); update(); }
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (!e.contentChanges.length) return;
      if (e.document !== doc) { if (e.document === previewDoc) previewContent(); return; }
      stop('文档已修改，朗读已停止。'); parsed = parseMarkdown(doc.getText()); revision++;
      if (e.document === previewDoc) previewContent();
      selected = sectionAt(parsed, vscode.window.activeTextEditor?.document === doc ? doc.offsetAt(vscode.window.activeTextEditor.selection.active) : 0); update();
    }),
    vscode.workspace.onDidCloseTextDocument(d => { if (d === previewDoc) readingPreview?.dispose(); if (d === doc) { stop('文档已关闭。'); doc = undefined; parsed = undefined; selected = undefined; revision++; update(); } }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('mdReader')) return;
      const live = ['speed', 'volume', 'follow', 'doubleClickRead', 'floatingButton', 'showHeadingLevels'];
      const restart = Object.keys(context.extension.packageJSON.contributes.configuration.properties)
        .some(key => !live.includes(key.slice('mdReader.'.length)) && e.affectsConfiguration(key));
      if (restart && (session || state === 'loading')) stop('朗读设置已更改，请重新开始。');
      else if (session && (e.affectsConfiguration('mdReader.speed') || e.affectsConfiguration('mdReader.volume'))) {
        session.settings.speed = config().get('speed', 1); session.settings.volume = config().get('volume', 1);
        postPlayback({ type: 'playbackOptions', speed: session.settings.speed, volume: session.settings.volume });
      }
      update();
    }),
    { dispose: () => { clearTimeout(session?.startTimer); stop(); audioCache.clear(); } }
  );
  setDocument(vscode.window.activeTextEditor || vscode.window.visibleTextEditors.find(e => e.document.languageId === 'markdown'));
  void syncActiveMarkdownTab();
  // 测试接口返回目录、位置和播放状态，不返回密钥、正文或音频。
  return { getState: () => ({ ...snapshot(), trace: [...trace] }), startReading, jump };
}
module.exports = { activate };
