'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
if (!process.argv[2]) throw new Error('Usage: node scripts/sync-cozy.cjs <Cozy source checkout>');
const source = path.resolve(process.argv[2]), root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
if (pkg.name !== 'note-reader-cosyvoice') throw new Error('Unexpected source package.');
const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw new Error('Use a clean, committed source checkout.');
const modules = ['academic-speech.js', 'structured-math.js', 'math-symbols.js', 'math-functions.js',
  'math-variable-labels.js', 'math-collections.js', 'math-fractions.js', 'speech-options.js', 'speech-parts.js',
  'semantic-chunker.js', 'playback-estimate.js', 'listening-buffer.js', 'preparation-pool.js'];
const hash = data => createHash('sha256').update(data).digest('hex');
const coreRoot = path.join(source, 'node_modules/@laginae/note-reader-core');
const corePackage = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
if (corePackage.name !== '@laginae/note-reader-core') throw Error('Unexpected core package');
fs.cpSync(path.join(coreRoot, 'src'), path.join(root, 'vendor/core/src'), { recursive: true });
fs.cpSync(path.join(coreRoot, 'test'), path.join(root, 'vendor/core/test'), { recursive: true });
for (const file of ['index.js', 'package.json', 'LICENSE']) fs.copyFileSync(path.join(coreRoot, file), path.join(root, 'vendor/core', file));
const coreFiles = [];
function recordCore(relative) {
  const location = path.join(root, 'vendor/core', relative);
  if (fs.statSync(location).isDirectory()) for (const name of fs.readdirSync(location)) recordCore(path.posix.join(relative, name));
  else coreFiles.push({ file: relative, sha256: hash(fs.readFileSync(location)) });
}
for (const entry of ['src', 'test', 'index.js', 'package.json', 'LICENSE']) recordCore(entry);
const entries = modules.map(file => {
  const sourceData = fs.readFileSync(path.join(source, 'src', file));
  let data = sourceData, adaptation = null;
  const text = data.toString('utf8');
  const adapted = text.replace(/require\('@laginae\/note-reader-core(?:\/([a-z-]+))?'\)/g,
    (_match, name) => `require('../core${name ? '/src/' + name : ''}')`);
  if (adapted !== text) { data = Buffer.from(adapted); adaptation = 'Replace npm core imports with the bundled portable core.'; }
  return { file, data, sourceSha256: hash(sourceData), vendoredSha256: hash(data), adaptation };
});
for (const { file, data } of entries) fs.writeFileSync(path.join(root, 'vendor/cozy', file), data);
const provenance = { version: pkg.version, sourceCommit: git(['rev-parse', 'HEAD']),
  coreVersion: corePackage.version, coreCommit: pkg.dependencies['@laginae/note-reader-core'].split('#')[1],
  coreFiles,
  sourceRepository: 'https://github.com/laginae/note-reader-cosyvoice',
  snapshotNote: 'Commit-pinned source snapshot, not a claim of a new upstream release.', license: 'MIT',
  modules: entries.map(({ data, ...entry }) => entry) };
fs.writeFileSync(path.join(root, 'vendor/cozy-reading-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify({ syncedModules: entries.length, sourceCommit: provenance.sourceCommit }));
