'use strict';
// 标准 ZIP / VSIX；无需额外打包依赖，也无需在用户机器执行安装脚本。
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const hash = data => createHash('sha256').update(data).digest('hex');
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function list(folder) {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => e.isDirectory() ? list(`${folder}/${e.name}`) : e.isFile() ? [`${folder}/${e.name}`] : []);
}
const names = ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', ...list('out'), ...list('media'), ...list('vendor/licenses')];
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="${escape(pkg.name)}" Version="${escape(pkg.version)}" Publisher="${escape(pkg.publisher)}"/>
<DisplayName>${escape(pkg.displayName)}</DisplayName><Description xml:space="preserve">${escape(pkg.description)}</Description><Tags>cursor,markdown,tts</Tags><Categories>Other</Categories><GalleryFlags/>
<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escape(pkg.engines.vscode)}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties><License>extension/LICENSE</License></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>`;
const types = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + Object.entries({ json: 'application/json', vsixmanifest: 'text/xml', md: 'text/markdown', cjs: 'application/javascript', js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', txt: 'text/plain', '': 'text/plain' }).map(([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`).join('') + '</Types>';
const contents = { 'extension.vsixmanifest': Buffer.from(manifest), '[Content_Types].xml': Buffer.from(types) };
for (const name of names) contents[`extension/${name}`] = fs.readFileSync(path.join(root, name));
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = data => { let n = 0xffffffff; for (const b of data) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
const local = [], central = [];
let offset = 0;
for (const [name, data] of Object.entries(contents).sort(([a], [b]) => a.localeCompare(b))) {
  const filename = Buffer.from(name), compressed = deflateRawSync(data), crc = crc32(data);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0x5d5c, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42);
  local.push(header, filename, compressed); central.push(directory, filename);
  offset += header.length + filename.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(contents).length, 8); end.writeUInt16LE(Object.keys(contents).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const data = Buffer.concat([...local, directory, end]);
const dist = path.join(root, 'dist'); fs.mkdirSync(dist, { recursive: true });
const filename = `${pkg.name}-${pkg.version}.vsix`, target = path.join(dist, filename);
fs.writeFileSync(target, data);
fs.writeFileSync(`${target}.sha256`, `${hash(data)}  ${filename}\n`);
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify({ package: filename, sha256: hash(data), files: Object.fromEntries(Object.entries(contents).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, hash(value)])) }, null, 2) + '\n');
console.log(JSON.stringify({ path: target, bytes: data.length, sha256: hash(data) }));
