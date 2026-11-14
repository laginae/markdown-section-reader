'use strict';
const { execFileSync } = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const child = `const Module=require('node:module'),{performance}=require('node:perf_hooks');
  const original=Module._load;Module._load=function(name,...args){return name==='vscode'?{}:original.call(this,name,...args)};
  const start=performance.now();require('./src/extension.cjs');const loaded=performance.now();
  const text=Array.from({length:300},(_,i)=>'# Public heading '+i+'\\n\\nA value $f(x)$ appears here.\\n').join('\\n');
  require('./src/markdown.cjs').parseMarkdown(text);const parsed=performance.now();
  const eagerKatex=Object.keys(require.cache).some(name=>/[\\\\/]katex[\\\\/]/.test(name));
  require('./src/preview.cjs').buildPreview('$f(x)$');const rendered=performance.now();
  console.log(JSON.stringify({moduleMs:loaded-start,parseMs:parsed-loaded,firstRenderMs:rendered-parsed,eagerKatex}));`;
const median = values => +values.sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3);
const measure = cwd => {
  const runs = Array.from({ length: 7 }, () => JSON.parse(execFileSync(process.execPath, ['-e', child], { cwd, encoding: 'utf8' })));
  return { moduleMs: median(runs.map(run => run.moduleMs)), parseMs: median(runs.map(run => run.parseMs)),
    firstRenderMs: median(runs.map(run => run.firstRenderMs)), eagerKatex: runs.every(run => run.eagerKatex) };
};
const bundleChild = `const Module=require('node:module'),{performance}=require('node:perf_hooks');
  const original=Module._load;Module._load=function(name,...args){return name==='vscode'?{}:original.call(this,name,...args)};
  const start=performance.now();require('./out/extension.cjs');console.log(performance.now()-start);`;
const bundle = cwd => median(Array.from({ length: 7 }, () => Number(execFileSync(process.execPath, ['-e', bundleChild], { cwd, encoding: 'utf8' }))));
const result = { scope: 'Seven fresh Node processes per version; public synthetic text only; not IDE activation or speech latency.',
  samples: 7, headings: 300, current: { ...measure(root), bundleLoadMs: bundle(root) }, speechRequests: 0 };
if (process.argv[2]) { const baseline = path.resolve(process.argv[2]); result.baseline = { ...measure(baseline), bundleLoadMs: bundle(baseline) }; }
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(path.join(root, 'qa/startup-benchmark.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
