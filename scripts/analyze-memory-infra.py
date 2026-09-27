#!/usr/bin/env python3
import json,pathlib,sys
out=pathlib.Path('docs/verification/native-engine');src=pathlib.Path('docs/verification/memory-attribution')
tag=sys.argv[1] if len(sys.argv)>1 else 'infra-filtered'
es=json.loads((src/(tag+'-combined.local.trace.json')).read_text())['traceEvents']
r=json.loads((src/(tag+'-combined.json')).read_text())
starts=sorted([e for e in es if e.get('name')=='GlobalMemoryDump' and e.get('ph')=='b'],key=lambda e:e['ts']);assert len(starts)==len(r['memoryDumps'])
labels={d['dumpGuid']:d['label'] for d in r['memoryDumps']}
names={e['pid']:e['args']['name'] for e in es if e.get('name')=='process_name'}
allocEvents=[e for e in es if e.get('args',{}).get('dumps',{}).get('allocators')]
first=[e for e in allocEvents if starts[0]['ts']<=e['ts']<starts[1]['ts']]
ui=next(e['pid'] for e in first if names.get(e['pid'])=='Renderer')
selected=['gpu','gpu/shared_images','gpu/transfer_cache','gpu/gr_shader_cache','gpu/shader_cache','gpu/dawn','ioaccelerator','iosurface','skia/gpu_resources','skia/sk_glyph_cache','discardable','malloc','malloc/allocated_objects','malloc/partitions/allocator','malloc/partitions/original','partition_alloc/address_space','v8','blink_gc']
rows=[]
for i,start in enumerate(starts):
 end=starts[i+1]['ts'] if i+1<len(starts) else float('inf');byPid={}
 for e in allocEvents:
  if start['ts']<=e['ts']<end:byPid.setdefault(e['pid'],{}).update(e['args']['dumps']['allocators'])
 for pid,alloc in byPid.items():
  role='uiRenderer' if pid==ui else {'Browser':'main','GPU Process':'gpu'}.get(names.get(pid))
  if not role:continue
  values={}
  for key in selected:
   if key in alloc:
    values[key]={k:{'value':int(v['value'],16),'units':v['units']} for k,v in alloc[key].get('attrs',{}).items() if v.get('type')=='scalar'}
  rows.append({'phase':labels[start['args']['dump_guid']],'role':role,'allocators':values})
assert len(rows)==3*len(starts)
result={'method':'GlobalMemoryDump begin timestamps define each explicit dump window; do not equate remapped periodic_interval id with CDP dumpGuid. Explicit detailed dumps, one real mixed-component cycle; nested/effective/size ownership fields must not be summed.','samples':rows}
(out/('memory-infra-summary.json' if tag=='infra-filtered' else tag+'-infra-summary.json')).write_text(json.dumps(result,indent=2)+'\n')
for role in ['main','gpu','uiRenderer']:
 rr={r['phase']:r for r in rows if r['role']==role};print('\n'+role)
 for key in selected:
  vals=[rr[p]['allocators'].get(key,{}).get('size',{}).get('value',0)/1048576 for p in [d['label'] for d in r['memoryDumps']]]
  if any(vals):print(key,[round(v,2) for v in vals])
 print('partition allocator final',rr['natural']['allocators'].get('malloc/partitions/allocator'))
