// macOS diagnostic-only ownership checks. Never imports into product code.
import assert from 'node:assert/strict'
import {spawnSync,execFileSync} from 'node:child_process'
export function listeners(port){
 assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535,'invalid diagnostic port')
 const r=spawnSync('/usr/sbin/lsof',['-nP','-t','-iTCP:'+port,'-sTCP:LISTEN'],{encoding:'utf8'})
 if(r.error)throw r.error
 if(r.status===1&&!r.stdout.trim()&&!r.stderr.trim())return []
 assert.equal(r.status,0,'cannot prove port ownership: '+r.stderr)
 const pids=[...new Set(r.stdout.trim().split(/\s+/).map(Number))];assert.ok(pids.every(p=>Number.isInteger(p)&&p>0));return pids
}
export function assertPortFree(port){assert.equal(listeners(port).length,0,'diagnostic port already occupied; refusing to connect')}
export function assertOwnedListeners(pids,root,rows){
 assert.ok(Number.isInteger(root)&&root>0,'missing launcher PID')
 const owned=new Set([root]);for(let i=0;i<32;i++)for(const [pid,parent] of rows)if(owned.has(parent))owned.add(pid)
 assert.ok(pids.length&&pids.every(p=>owned.has(p)),'CDP listener is not owned by this launcher')
}
export function assertPortOwned(port,root){
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number))
 assertOwnedListeners(listeners(port),root,rows)
}
export function ownedPids(root){
 if(!Number.isInteger(root)||root<=0)return []
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number)),owned=new Set([root])
 for(let i=0;i<32;i++)for(const [pid,parent] of rows)if(owned.has(parent))owned.add(pid)
 return rows.filter(([pid])=>owned.has(pid)).map(([pid])=>pid)
}
export async function remainingPids(pids){
 let remaining=[]
 for(let i=0;i<20;i++){
  const alive=new Set(execFileSync('/bin/ps',['-axo','pid='],{encoding:'utf8'}).trim().split(/\s+/).map(Number));remaining=pids.filter(p=>alive.has(p))
  if(!remaining.length)break;await new Promise(r=>setTimeout(r,250))
 }
 return remaining
}
