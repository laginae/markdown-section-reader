'use strict';
const esbuild = require('esbuild'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const host = esbuild.buildSync({ entryPoints: ['src/extension.cjs'], outfile: 'out/extension.cjs', bundle: true, platform: 'node', target: 'node20', external: ['vscode'], minify: false, sourcemap: false, metafile: true });
const browser = esbuild.buildSync({ entryPoints: ['src/web/mermaid.mjs'], outfile: 'media/renderers/mermaid.js', bundle: true, platform: 'browser', format: 'iife', globalName: 'MarkdownReaderMermaid', target: 'es2022', minify: true, sourcemap: false, metafile: true });
fs.mkdirSync('media/katex/fonts', { recursive: true });
fs.copyFileSync('node_modules/katex/dist/katex.min.css', 'media/katex/katex.min.css');
for (const f of fs.readdirSync('node_modules/katex/dist/fonts')) if (/\.woff2$/.test(f)) fs.copyFileSync(`node_modules/katex/dist/fonts/${f}`, `media/katex/fonts/${f}`);
const packages = new Set();
for (const name of [...Object.keys(host.metafile.inputs), ...Object.keys(browser.metafile.inputs)]) {
  const match = name.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
for (const p of [...packages].sort()) {
  const label = p.replace(/^.*node_modules\//, '').replaceAll('/', '-');
  for (const f of fs.readdirSync(p)) if (/^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(f) && fs.statSync(path.join(p, f)).isFile()) fs.copyFileSync(path.join(p, f), `vendor/licenses/${label}-${f}`);
}
const assets = ['out/extension.cjs', 'media/renderers/mermaid.js', 'media/katex/katex.min.css', ...fs.readdirSync('media/katex/fonts').map(f => `media/katex/fonts/${f}`)];
fs.mkdirSync('qa', { recursive: true });
fs.writeFileSync('qa/build-assets.json', JSON.stringify({ dependencies: [...packages].sort().map(p => { const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'))); return { path: p, name: pkg.name, version: pkg.version }; }), assets: assets.map(file => ({ file, bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })) }, null, 2) + '\n');
console.log(JSON.stringify({ browserBundleBytes: fs.statSync('media/renderers/mermaid.js').size, fonts: fs.readdirSync('media/katex/fonts').length, bundledPackages: packages.size }));
