#!/usr/bin/env python3
import json,pathlib
out=pathlib.Path('docs/verification/pressure-recovery')
r=json.loads((out/'media-result.json').read_text());assert r['passed']
es=json.loads((out/'media.local.trace.json').read_text())['traceEvents']
starts=sorted((e for e in es if e.get('name')=='GlobalMemoryDump' and e.get('ph')=='b'),key=lambda e:e['ts']);assert len(starts)==len(r['dumps'])
labels={d['dumpGuid']:d['label'] for d in r['dumps']}
names={e['pid']:e['args']['name'] for e in es if e.get('name')=='process_name'}
events=[e for e in es if e.get('args',{}).get('dumps',{}).get('allocators')]
first=[e for e in events if starts[0]['ts']<=e['ts']<starts[1]['ts']]
ui=next(e['pid'] for e in first if names.get(e['pid'])=='Renderer')
keys=['gpu','gpu/shared_images','gpu/transfer_cache','gpu/dawn','skia/gpu_resources','malloc/allocated_objects','malloc/partitions/allocator','v8','blink_gc']
rows=[]
for i,start in enumerate(starts):
 end=starts[i+1]['ts'] if i+1<len(starts) else float('inf');byPid={}
 for e in events:
  if start['ts']<=e['ts']<end:byPid.setdefault(e['pid'],{}).update(e['args']['dumps']['allocators'])
 for pid,alloc in byPid.items():
  role='uiRenderer' if pid==ui else {'Browser':'main','GPU Process':'gpu'}.get(names.get(pid))
  if not role:continue
  values={key:{k:{'value':int(v['value'],16),'units':v['units']} for k,v in alloc[key].get('attrs',{}).items() if v.get('type')=='scalar'} for key in keys if key in alloc}
  rows.append({'phase':labels[start['args']['dump_guid']],'role':role,'allocators':values})
result={'method':'Explicit GlobalMemoryDump begin-time windows, not remapped periodic_interval IDs. Absent allocator is not assumed zero. Nested/shared sizes must not be summed.','samples':rows}
(out/'allocation-summary.json').write_text(json.dumps(result,indent=2)+'\n')
for role in ['gpu','uiRenderer']:
 print(role)
 for s in rows:
  if s['role']!=role or not (s['phase']=='baseline' or s['phase'].startswith('closed-')):continue
  print(s['phase'],{k:round(v['size']['value']/1048576,3) for k,v in s['allocators'].items() if 'size' in v and k in ['gpu/shared_images','gpu/transfer_cache','malloc/allocated_objects','v8']})
