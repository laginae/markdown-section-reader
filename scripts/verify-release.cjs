'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
async function files(dir) {
  return (await Promise.all((await fs.readdir(dir, { withFileTypes: true })).map(async e => {
    if (['node_modules', '.git', 'dist'].includes(e.name)) return [];
    const p = path.join(dir, e.name); return e.isDirectory() ? files(p) : [p];
  }))).flat();
}
(async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
  const checks = [];
  const hosts = process.argv.slice(2).length ? process.argv.slice(2) : ['qoder'];
  if (hosts.some(host => !['cursor', 'qoder'].includes(host))) throw new Error('Unexpected verification host.');
  for (const ide of hosts) {
  const installed = path.join(process.env.USERPROFILE, `.${ide}/extensions/local-tools.markdown-section-reader-${require('../package.json').version}`);
  for (const [name, sha] of Object.entries(manifest.files)) {
    if (!name.startsWith('extension/')) continue;
    const relative = name.slice(10), data = await fs.readFile(path.join(installed, relative));
    let match;
    if (relative === 'package.json') {
      const pkg = JSON.parse(data); delete pkg.__metadata;
      match = JSON.stringify(pkg) === JSON.stringify(JSON.parse(await fs.readFile(path.join(root, relative), 'utf8')));
    } else match = createHash('sha256').update(data).digest('hex') === sha;
    checks.push({ ide, file: relative, match });
  }
  }
  const encodingErrors = [];
  for (const p of await files(root)) {
    const data = await fs.readFile(p);
    if (/\.(?:json|jsonl|js|cjs|md|css|svg)$/.test(p)) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { encodingErrors.push(path.relative(root, p)); }
    }
  }
  const report = { at: new Date().toISOString(), hosts, installedMatches: checks.every(c => c.match), installedFiles: checks,
    utf8Passed: !encodingErrors.length, encodingErrors,
    vsix: manifest.package, sha256: manifest.sha256 };
  const { inflateRawSync } = require('node:zlib');
  const vsix = await fs.readFile(path.join(root, 'dist', manifest.package));
  report.vsixMatches = createHash('sha256').update(vsix).digest('hex') === manifest.sha256;
  let offset = 0, archiveFiles = 0;
  while (offset + 30 <= vsix.length && vsix.readUInt32LE(offset) === 0x04034b50) {
    const size = vsix.readUInt32LE(offset + 18), nameLength = vsix.readUInt16LE(offset + 26), extra = vsix.readUInt16LE(offset + 28);
    const name = vsix.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extra;
    const data = inflateRawSync(vsix.subarray(start, start + size));
    if (createHash('sha256').update(data).digest('hex') !== manifest.files[name]) report.vsixMatches = false;
    offset = start + size; archiveFiles++;
  }
  report.archiveFiles = archiveFiles; report.vsixMatches &&= archiveFiles === Object.keys(manifest.files).length;
  await fs.writeFile(path.join(root, 'qa/release-audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ installedMatches: report.installedMatches, files: checks.length, utf8Passed: report.utf8Passed, vsixMatches: report.vsixMatches }));
  if (!report.installedMatches || !report.vsixMatches || encodingErrors.length) process.exitCode = 1;
})().catch(() => { console.error('Release audit could not complete.'); process.exitCode = 1; });
