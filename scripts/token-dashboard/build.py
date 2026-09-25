#!/usr/bin/env python3
"""Generate an offline dashboard from this project's local Codex logs; --watch regenerates only on change."""
import argparse, datetime, json, os, subprocess, sys, time
from pathlib import Path
from analyze import analyze_records, estimate, METHOD
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/token-dashboard.html'
CACHE={}
def events(p):
 with p.open(errors='replace') as f:
  for line in f:
   try:yield json.loads(line)
   except (ValueError,TypeError):continue # in-flight partial last line is retried on next refresh

def generate(limit):
 base=Path.home()/'.codex/sessions'
 files=sorted(base.rglob('*.jsonl'),key=lambda p:p.stat().st_mtime,reverse=True)
 sessions=[]
 for p in files:
  if p.is_symlink():continue
  it=events(p);first=next(it,{})
  if first.get('type')!='session_meta':continue
  meta=first.get('payload',{})
  try:matches=Path(meta.get('cwd','')).resolve()==ROOT
  except (OSError,ValueError):matches=False
  if not matches:continue
  stat=p.stat();key=(stat.st_mtime_ns,stat.st_size)
  if CACHE.get(str(p),{}).get('key')!=key:
   d=analyze_records(events(p));CACHE[str(p)]={'key':key,'data':d}
  d=CACHE[str(p)]['data']
  if not d['turns']:continue
  sessions.append({'internal':isinstance(meta.get('source'),dict),'id':meta.get('id',p.stem),'date':str(meta.get('timestamp',''))[:10],'turns':d['turns'],'invalidUsage':d['invalidUsage']})
  if len(sessions)>=limit:break
 before=subprocess.check_output(['git','show','1ee6e59:src/main/capabilityGuidance.ts'],cwd=ROOT,text=True)
 # Reproduce only string literals used by the old/new pure guidance function through TS node;
 # no Electron, no user config and no model request.
 old=ROOT/'scripts/token-dashboard/.guidance-before.ts'
 if old.exists() or old.is_symlink():raise RuntimeError('Refuse existing guidance temp file')
 try:
  old.write_text(before.replace("../shared/builtinCapabilities.ts","../../src/shared/builtinCapabilities.ts"))
  command="import {buildCapabilityGuidance as b} from './scripts/token-dashboard/.guidance-before.ts';import {buildCapabilityGuidance as a} from './src/main/capabilityGuidance.ts';const o={preferences:{guidance:true,workbench:true,bizone:true},directory:'/Applications/Eas-Term.app/Contents/Resources/plugins/eas-capabilities/guidance',version:'1.0.0',bizoneInstalled:true};console.log(JSON.stringify({before:b(o),after:a(o)}));"
  guidance=json.loads(subprocess.check_output(['node','--input-type=module','-e',command],cwd=ROOT,text=True,stderr=subprocess.DEVNULL))
 finally:old.unlink(missing_ok=True)
 b,a=guidance['before'],guidance['after'];bt,at=estimate(b),estimate(a)
 opt=[{'title':'已修正：Codex 缓存重复计数（开发代码）','description':'input 已包含 cached，不再重复相加；旧历史在显示边界按 Codex 口径兼容。零缓存显示 0%。未发版，不代表正在运行的正式包已更新。'}, {'title':'已精简：能力指引重复路径（开发代码）','description':f'同一指引目录原来重复 5 次，现在只声明一次、文件名按该目录解析。字符 {len(b)} → {len(a)}；代理分词 {bt} → {at}，减少约 {bt-at} Token/次注入。保留报价确认、密钥、安全边界、断线核对和全部指引入口。这是文本对比，不是模型实测 A/B。'}, {'title':'未擅自改动：全局规则、Skills 与工具开关','description':'未删除安全规则、未禁用工具、未改账号配置。隐藏系统指令和完整工具 Schema 无法从 rollout 精确拆分；优先结合可见大项继续定位，而不是盲目删除。'}]
 data={'generated':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':METHOD,'sessions':sessions,'optimization':opt}
 encoded=json.dumps(data,ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
 html=(ROOT/'scripts/token-dashboard/dashboard.html').read_text().replace('__DATA__',encoded)
 if OUT.is_symlink() or OUT.parent.is_symlink():raise RuntimeError('Refuse symlink report output')
 tmp=OUT.with_suffix('.html.tmp')
 if tmp.is_symlink():raise RuntimeError('Refuse symlink temp output')
 with tmp.open('w') as f:f.write(html)
 os.chmod(tmp,0o600);tmp.replace(OUT)
 print(f'{len(sessions)} sessions / {sum(len(s["turns"]) for s in sessions)} turns → {OUT}',flush=True)
 return tuple((k,v['key']) for k,v in CACHE.items())
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--watch',action='store_true');p.add_argument('--limit',type=int,default=30);args=p.parse_args()
 if not 1<=args.limit<=100:raise SystemExit('limit must be 1..100')
 try:
  generate(args.limit)
  if args.watch:
   print('Local watch active (30s). Ctrl+C stops. No model/network calls.',flush=True)
   while True:
    time.sleep(30)
    changed=any(not Path(k).exists() or (Path(k).stat().st_mtime_ns,Path(k).stat().st_size)!=v['key'] for k,v in CACHE.items())
    # New sessions have not entered CACHE yet.
    latest=max((p.stat().st_mtime for p in (Path.home()/'.codex/sessions').rglob('*.jsonl')),default=0)
    if changed or latest>OUT.stat().st_mtime:generate(args.limit)
 except KeyboardInterrupt:print('Stopped local dashboard watch.')
