import concurrent.futures
import json
import pathlib
import urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
data = json.loads((root / '.worktrees/voice-regression/src/renderer/src/features/dict/design-previews.json').read_text())
def check(item):
    slug, entry = item
    try:
        req = urllib.request.Request(entry['previewUrl'], method='HEAD')
        with urllib.request.urlopen(req, timeout=25) as res:
            return {'slug': slug, 'status': res.status, 'bytes': res.headers.get('Content-Length')}
    except Exception as error:
        return {'slug': slug, 'error': str(error)}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(check, data.items()))
(root / 'docs/deployment/design-cdn-url-check.json').write_text(json.dumps(results, indent=2))
print(json.dumps({'total': len(results), 'ok': sum(r.get('status') == 200 for r in results), 'failed': [r for r in results if r.get('status') != 200]}))
