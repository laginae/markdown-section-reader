"""封装插件源码、安装包与公开样例验证记录。"""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
pkg = json.loads((root / 'package.json').read_text('utf-8'))
manifest = json.loads((dist / 'manifest.json').read_text('utf-8'))
summary = json.loads((root / 'qa/verification-summary.json').read_text('utf-8'))
vsix = dist / manifest['package']
assert pkg['version'] == summary['version']
assert summary['vsixSha256'] == manifest['sha256'] == hashlib.sha256(vsix.read_bytes()).hexdigest()
audit = json.loads((root / 'qa/release-audit.json').read_text('utf-8'))
assert audit['installedMatches'] and audit['utf8Passed'] and audit['vsixMatches']
with ZipFile(vsix) as z:
    assert z.testzip() is None

def pack(target, entries):
    with ZipFile(target, 'w', ZIP_DEFLATED) as z:
        for name, data in sorted(entries):
            info = ZipInfo(name, (2026, 11, 14, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    with ZipFile(target) as z:
        assert z.testzip() is None
        assert all(not n.startswith(('/', '\\')) and '..' not in Path(n).parts for n in z.namelist())
    sha = hashlib.sha256(target.read_bytes()).hexdigest()
    Path(str(target) + '.sha256').write_text(f'{sha}  {target.name}\n', 'utf-8')
    return sha

entries = []
for folder in ['src', 'media', 'vendor', 'test', 'scripts', 'out']:
    entries.extend((f'{root.name}/{p.relative_to(root).as_posix()}', p.read_bytes()) for p in (root / folder).rglob('*') if p.is_file())
for name in ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
             'qa/README.md', 'qa/formula-reading.md', 'qa/build-assets.json',
             'qa/offline-tests.tap', 'qa/release-audit.json', 'qa/verification-summary.json', 'qa/startup-benchmark.json']:
    entries.append((f'{root.name}/{name}', (root / name).read_bytes()))
prefix = f"{pkg['name']}-{pkg['version']}"
source = dist / f'{prefix}-source.zip'
source_sha = pack(source, entries)
release = dist / f'{prefix}-release.zip'
names = [vsix.name, vsix.name + '.sha256', source.name, source.name + '.sha256']
release_entries = [(name, (dist / name).read_bytes()) for name in names]
release_entries.extend([('README.md', (root / 'README.md').read_bytes()),
                        ('verification-summary.json', (root / 'qa/verification-summary.json').read_bytes())])
release_sha = pack(release, release_entries)
print(json.dumps({'source': str(source), 'sourceSha256': source_sha, 'release': str(release), 'releaseSha256': release_sha}, ensure_ascii=False))
