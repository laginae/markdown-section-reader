'use strict';
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.join(__dirname, '../..'), pkg = require('../../package.json');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function readerHost(options = {}) {
  const commands = new Map(), events = {}, messages = [], errors = [], subscriptions = [];
  const values = Object.fromEntries(Object.entries(pkg.contributes.configuration.properties).map(([key, value]) => [key.slice('mdReader.'.length), value.default]));
  Object.assign(values, { buffering: 'on-demand', quickStart: 'off' }, options.settings);
  const calls = { voices: 0, plans: 0, syntheses: 0, writes: [] };
  const uri = { path: '/public.md', toString: () => 'file:///public.md' };
  const doc = { uri, fileName: 'public.md', languageId: 'markdown', version: 1, isClosed: false,
    getText: () => '# Public chapter\n\nA public example uses $f(x)$ in a sentence.', offsetAt: () => 0,
    positionAt: offset => ({ line: 0, character: offset }) };
  let provider, receiver, resolved = false;
  const disposable = () => ({ dispose() {} });
  const listen = name => handler => { events[name] = handler; return disposable(); };
  const view = { webview: { cspSource: 'https://public.invalid', asWebviewUri: value => value.toString(),
    postMessage: message => { messages.push(message); return Promise.resolve(true); },
    onDidReceiveMessage: handler => { receiver = handler; return disposable(); } }, onDidDispose: () => disposable() };
  const config = { get: (key, fallback) => values[key] ?? fallback,
    update: async (key, value, target) => { values[key] = value; calls.writes.push({ key, value, target }); } };
  const vscode = {
    ThemeColor: class { constructor(id) { this.id = id; } }, Range: class {}, Position: class {},
    OverviewRulerLane: { Center: 1 }, TextEditorRevealType: {}, ConfigurationTarget: { Global: 1 }, ViewColumn: { One: 1, Beside: 2 },
    Uri: { joinPath: (base, ...parts) => ({ path: path.posix.join(base.path, ...parts), toString: () => 'https://public.invalid/' + parts.join('/') }) },
    window: { activeTextEditor: { document: doc, selection: { active: { line: 0, character: 0 } } }, visibleTextEditors: [],
      tabGroups: { activeTabGroup: { activeTab: {} }, onDidChangeTabs: listen('tabs'), onDidChangeTabGroups: listen('tabGroups') },
      createTextEditorDecorationType: () => disposable(),
      registerWebviewViewProvider: (_id, value) => { provider = value; return disposable(); }, registerWebviewPanelSerializer: () => disposable(),
      onDidChangeActiveTextEditor: listen('editor'), onDidChangeVisibleTextEditors: listen('visible'), onDidChangeTextEditorSelection: listen('selection'),
      showErrorMessage: message => errors.push(message), showInformationMessage() {}, showQuickPick: async () => undefined },
    workspace: { getConfiguration: () => config, onDidChangeTextDocument: listen('document'), onDidCloseTextDocument: listen('close'), onDidChangeConfiguration: listen('configuration') },
    commands: { registerCommand: (id, handler) => { commands.set(id, handler); return disposable(); }, executeCommand: async id => {
      if (id === 'workbench.view.extension.markdown-reader') {
        await options.viewGate?.promise;
        if (!resolved) { resolved = true; provider.resolveWebviewView(view); await receiver({ type: 'ready' }); }
      }
    } }, env: {}
  };
  const filename = path.join(root, 'src/extension.cjs'), localRequire = createRequire(filename), loaded = { exports: {} };
  const speechPlan = localRequire('./speech-plan.cjs');
  const fakeRequire = name => name === 'vscode' ? vscode : name === './speech-plan.cjs'
    ? { ...speechPlan, makeReadingPlan: (...args) => { calls.plans++; return speechPlan.makeReadingPlan(...args); } }
    : name === './speech.cjs' ? {
      listSystemVoices: () => { calls.voices++; return options.voices ? options.voices() : Promise.resolve([{ id: 'Public voice', name: 'Public voice', language: 'en' }]); },
      synthesize: async () => { calls.syntheses++; return { audio: Buffer.alloc(16), duration: 10 }; },
      readObsidianSpeechPreferences: async () => options.profile || { speechEngine: 'system-tts' },
      importObsidianSecret: async () => { throw new Error('No credential access in offline tests.'); }
    } : localRequire(name);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(fakeRequire, loaded, loaded.exports);
  const context = { extensionUri: { path: '/extension' }, extension: { packageJSON: pkg }, subscriptions,
    globalState: { get: (_key, fallback) => fallback, update: async () => {} },
    secrets: { get: async () => { throw new Error('No credential access in offline tests.'); } } };
  const api = loaded.exports.activate(context);
  return { api, values, calls, doc, view, messages, errors, events, commands, receive: message => receiver(message),
    open: () => commands.get('mdReader.open')(),
    dispose: () => { for (const value of subscriptions) value.dispose?.(); } };
}
module.exports = { readerHost, deferred, tick };
