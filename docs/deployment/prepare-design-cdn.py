"""Prepare a public resource tree; never upload the raw backup or credentials."""
import json
import pathlib
import re
import shutil

source = next(pathlib.Path('/Users/biily/Biily/cowork').glob('*/vechooool-backup'))
dest = source.parent / 'design-cdn-upload'
dest.mkdir(exist_ok=True)
for name in ('cdn-mirror', 'design-library'):
    shutil.copytree(source / name, dest / name, dirs_exist_ok=True)
index = dest / 'design-library/index.html'
html = index.read_text()
html = '\n'.join(line for line in html.split('\n') if 'k.pricingType' not in line and '.tag.paid{' not in line and '.tag.free{' not in line)
data = json.loads((dest / 'design-library/index.json').read_text())
for item in data:
    item.pop('pricingType', None)
    item.pop('buyoutPrice', None)
html = re.sub(r'const DATA = .*?;\n', lambda _: 'const DATA = ' + json.dumps(data, ensure_ascii=False) + ';\n', html, count=1)
index.write_text(html)
(dest / 'design-library/index.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
# Keep original paths and local dependencies intact. Only replace old CDN origin.
for path in dest.rglob('*'):
    if path.is_file() and path.suffix.lower() in ('.html', '.css', '.js', '.json', '.svg'):
        try:
            text = path.read_text()
        except UnicodeError:
            continue
        changed = text.replace('https://cdn.vechooool.com/', 'https://design.biily.top/cdn-mirror/')
        changed = changed.replace('http://cdn.vechooool.com/', 'https://design.biily.top/cdn-mirror/')
        if changed != text:
            path.write_text(changed)
files = [p for p in dest.rglob('*') if p.is_file()]
assert not any(p.suffix in ('.key', '.pem', '.env') for p in files)
assert 'k.pricingType' not in index.read_text()
manifest = {'root': str(dest), 'files': len(files), 'bytes': sum(p.stat().st_size for p in files), 'kits': len(data)}
print(json.dumps(manifest, ensure_ascii=False))
