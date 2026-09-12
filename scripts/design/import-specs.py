"""Import local source-kit documentation; no network, originals unchanged."""
import os,json,re
from pathlib import Path
from html.parser import HTMLParser
lib=Path(os.environ['DESIGN_LIB'])
backup=Path(os.environ['DESIGN_BACKUP'])
out=Path('src/renderer/public/design-specs');out.mkdir(exist_ok=True)
class Text(HTMLParser):
 def __init__(self): super().__init__();self.skip=0;self.parts=[]
 def handle_starttag(self,t,a):
  if t in ('script','style'):self.skip+=1
  if not self.skip and t in ('p','div','section','h1','h2','h3','h4','li','tr','br'):self.parts.append('\n')
 def handle_endtag(self,t):
  if t in ('script','style'):self.skip=max(0,self.skip-1)
 def handle_data(self,d):
  if not self.skip:self.parts.append(d)
manifest={}
for r in json.loads((lib/'index.json').read_text()):
 if not r.get('designHtml'):continue
 p=(backup/'design-library'/r['designHtml']).resolve()
 if not p.is_file():continue
 raw=p.read_text(); parser=Text();parser.feed(raw)
 body='\n'.join(x.strip() for x in ''.join(parser.parts).splitlines() if x.strip())
 css=(lib/r['tokensCss']).read_text()
 # Inert local document: scripts removed, sandbox + CSP disable network/actions.
 safe=re.sub(r'<script\b[^>]*>.*?</script\s*>','',raw,flags=re.I|re.S)
 policy='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; base-uri \'none\'; form-action \'none\'">'
 safe=re.sub(r'(<head\b[^>]*>)',lambda m:m[0]+policy,safe,count=1,flags=re.I)
 (out/(r['slug']+'.html')).write_text(safe)
 (out/(r['slug']+'.json')).write_text(json.dumps({'text':body,'tokensCss':css,'page':'design-specs/'+r['slug']+'.html'},ensure_ascii=False))
 manifest[r['slug']]='design-specs/'+r['slug']
Path('src/renderer/src/features/dict/design-spec-index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Imported',len(manifest),'source design pages')
