#!/usr/bin/env python3
"""Parse VM region tags only, not malloc-zone allocation attribution."""
import pathlib,re,json
src=pathlib.Path('docs/verification/memory-attribution');out=pathlib.Path('docs/verification/native-engine')
def number(x):
 m=re.fullmatch(r'([\d.]+)([BKMGT]?)',x)
 return round(float(m[1])*1024**('BKMGT'.index(m[2]) if m[2] else 0))
rows=[]
for p in sorted(src.glob('native-combined-*.local.vmmap.txt')):
 label,role=p.name.removeprefix('native-combined-').removesuffix('.local.vmmap.txt').rsplit('-',1)
 text=p.read_text();regions={}
 for line in text.split('\nMALLOC ZONE')[0].splitlines():
  m=re.match(r'^(.*?)\s{2,}((?:\d+(?:\.\d+)?[BKMGT]?\s+){7}\d+)\s*(?:see.*|reserved.*)?$',line)
  if m:
   vals=m[2].split();regions[m[1].strip()]={k:number(v) for k,v in zip(['virtual','resident','dirty','swapped','volatile','nonvolatile','empty'],vals[:7])}
 assert 'Memory Tag 253' in regions and '__TEXT' in regions,p
 footprint=re.search(r'^Physical footprint:\s*([\d.]+[BKMGT]?)',text,re.M)
 rows.append({'phase':label,'role':role,'footprintBytes':number(footprint[1]) if footprint else None,'regions':regions})
result={'warning':'vmmap cannot examine Chromium PartitionAlloc malloc zone; VM-tag classification only, no allocation-stack proof. Total resident includes shared library pages and must not be equated with ps RSS.','tagSource':'https://github.com/chromium/chromium/blob/138.0.7204.251/base/allocator/partition_allocator/src/partition_alloc/page_allocator.h','snapshots':rows}
(out/'native-categories.json').write_text(json.dumps(result,indent=2)+'\n')
for role in ['main','gpu','uiRenderer']:
 rr={r['phase']:r for r in rows if r['role']==role};b=rr['baseline'];e=rr['natural'];g=rr['after-gc']
 print(role,'physical footprint MiB:',[round(r['footprintBytes']/1048576,1) for r in [b,e,g]])
 for k in ['Memory Tag 253','Memory Tag 255','IOAccelerator (graphics)','IOSurface','MALLOC_SMALL','MALLOC_TINY','mapped file','__TEXT']:
  if k not in e['regions']:continue
  print(k,'dirtyMiB baseline/natural/GC',[round(r['regions'].get(k,{}).get('dirty',0)/1048576,2) for r in[b,e,g]])
