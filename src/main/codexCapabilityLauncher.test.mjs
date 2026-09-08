import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const launcher=fileURLToPath(new URL('../../mcp/eas-codex-launcher.mjs',import.meta.url))
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-launch 合并-')),binary=path.join(root,'native.mjs'),log=path.join(root,'log')
 fs.mkdirSync(path.join(root,'子项目'))
 fs.writeFileSync(binary,`#!${process.execPath}
import fs from 'node:fs';import readline from 'node:readline';
const args=process.argv.slice(2);const record=x=>fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(x)+'\\n');
record({args,pid:process.pid,cwd:process.cwd()});
if(args[0]==='app-server'){
 if(process.env.FIXTURE_HANG==='1'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}
 else {const rl=readline.createInterface({input:process.stdin});rl.on('line',line=>{
 const m=JSON.parse(line);record({method:m.method,cwd:m.params?.cwd});
 if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');
 if(m.method==='config/read'){
 const managed=args.includes('instructions="MANAGED"');
 const config={instructions:managed?'MANAGED':'USER\\nCLI',developer_instructions:'USER_DEV',mcp_servers:{audit:{command:'node',disabled_tools:managed?['role']:['user']}},skills:{config:[]}};
 process.stdout.write(JSON.stringify({id:m.id,result:{config}})+'\\n');
 }
 })}
}else {record({executed:true,args,fallback:process.env.EAS_CAPABILITY_NODE_FALLBACK,electronMode:process.env.ELECTRON_RUN_AS_NODE});if(process.env.FIXTURE_HANG_EXEC==='1')setInterval(()=>{},1000)}
`,{mode:0o700})
 const read=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
 return {root,binary,log,read,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})}
}
function start(f,args,extraEnv={},ipc=false){
 const p=spawn(process.execPath,[launcher,JSON.stringify({binary:f.binary,args,managedAssignments:['instructions="MANAGED"','mcp_servers.audit.disabled_tools=["role"]']})],{cwd:f.root,env:{...process.env,FIXTURE_LOG:f.log,...extraEnv},stdio:ipc?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe']})
 let stderr='';p.stderr.on('data',x=>stderr+=x)
 const done=new Promise(resolve=>p.on(ipc?'exit':'close',(code,signal)=>resolve({code,signal,stderr})))
 return {p,done}
}
test('actual owned launcher separates user CLI overrides, preserves prompt after --, and forwards effective cwd',async()=>{
 const f=fixture()
 try{
  const args=['--config=instructions="USER\\nCLI"','-cmcp_servers.audit.disabled_tools=["user"]','--cd','子项目','exec','--','-c','literal prompt']
  const {done}=start(f,args,{EAS_CAPABILITY_NODE_FALLBACK:'1',ELECTRON_RUN_AS_NODE:'1'})
  assert.equal((await done).code,0)
  const rows=f.read(),probes=rows.filter(r=>r.args?.[0]==='app-server'),runs=rows.filter(r=>r.executed)
  assert.equal(probes.length,2);assert.equal(runs.length,1)
  assert.ok(probes.every(r=>r.args.includes('instructions="USER\\nCLI"')&&r.args.includes('mcp_servers.audit.disabled_tools=["user"]')))
  assert.ok(rows.filter(r=>r.method==='config/read').every(r=>r.cwd===fs.realpathSync(path.join(f.root,'子项目'))))
  assert.ok(runs[0].args.includes('instructions="USER\\nCLI\\n\\nMANAGED"'))
  assert.ok(runs[0].args.includes('mcp_servers.audit.disabled_tools=["user","role"]'))
  assert.deepEqual(runs[0].args.slice(-4),['exec','--','-c','literal prompt'])
  assert.equal(runs[0].fallback,undefined);assert.equal(runs[0].electronMode,undefined)
  for(const row of rows.filter(r=>r.pid))assert.throws(()=>process.kill(row.pid,0))
 }finally{f.cleanup()}
})
test('SIGTERM during actual launcher config probe kills only its owned probe and never executes native turn',async()=>{
 const f=fixture()
 try{
  const {p,done}=start(f,['exec','not sent'],{FIXTURE_HANG:'1'})
  const deadline=Date.now()+5000
  while(!f.read().some(r=>r.pid)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10))
  assert.ok(f.read().some(r=>r.pid))
  p.kill('SIGTERM')
  assert.notEqual((await done).code,0)
  const rows=f.read();assert.equal(rows.filter(r=>r.executed).length,0)
  for(const row of rows.filter(r=>r.pid))assert.throws(()=>process.kill(row.pid,0))
 }finally{f.cleanup()}
})

for(const phase of ['config','exec']) for(const action of ['cancel','disconnect']) test(`owned IPC ${action} during ${phase} waits for the actual child to exit`,{skip:process.platform==='win32'},async()=>{
 const f=fixture(), {p,done}=start(f,['exec','not sent'],phase==='config'?{FIXTURE_HANG:'1'}:{FIXTURE_HANG_EXEC:'1'},true)
 try{
  const deadline=Date.now()+5000
  while(!f.read().some(r=>phase==='config'?r.pid:r.executed)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10))
  assert.ok(f.read().some(r=>phase==='config'?r.pid:r.executed))
  if(action==='cancel')p.send({type:'eas:codex:cancel',signal:'SIGTERM'});else p.disconnect()
  const result=await Promise.race([done,new Promise(resolve=>setTimeout(()=>resolve(null),1500))])
  assert.ok(result,'outer launcher ignored owned cancellation channel')
  for(const row of f.read().filter(r=>r.pid))assert.throws(()=>process.kill(row.pid,0))
 }finally{if(p.exitCode===null&&p.signalCode===null){p.kill('SIGTERM');await done}f.cleanup()}
})
