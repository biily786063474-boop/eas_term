import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readAndMergeCodexConfig as mergeCodexCapabilityConfig } from '../../mcp/codex-capability-config.mjs'

function fixture(mode = 'ok') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex 合并-'))
  const binary = path.join(root, 'fake-codex')
  fs.writeFileSync(binary, `#!/usr/bin/env node
import fs from 'node:fs';import readline from 'node:readline';
fs.appendFileSync(process.env.AUDIT_LOG,JSON.stringify({pid:process.pid,args:process.argv.slice(2)})+'\\n');
${mode === 'hang' ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);" : `
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(process.env.AUDIT_LOG,JSON.stringify({method:m.method,cwd:m.params?.cwd})+'\\n');
if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');
if(m.method==='config/read'){
${mode === 'error' ? "process.stdout.write(JSON.stringify({id:m.id,error:{message:'SECRET_DO_NOT_PRINT'}})+'\\n');" : `
const managed=process.argv.includes('instructions="managed"');
const config=managed?{instructions:'managed',developer_instructions:'USER_DEV',mcp_servers:{audit:{disabled_tools:['role']}},skills:{config:[{path:'/role/SKILL.md',enabled:false},{path:'/user/SKILL.md',enabled:true}]}}:{instructions:'USER\\nRULE',developer_instructions:'USER_DEV',mcp_servers:{audit:{disabled_tools:['user'],enabled:false}},skills:{config:[{path:'/user/SKILL.md',enabled:false}]}};
process.stdout.write(JSON.stringify({id:m.id,result:{config}})+'\\n');`}
}});`}
`, {mode:0o700})
  return { root, binary, log: path.join(root,'log'), cleanup:()=>fs.rmSync(root,{recursive:true,force:true}) }
}

test('native effective configuration is merged without losing user restrictions or multiline rules', async () => {
  const f=fixture()
  try {
    const got=await mergeCodexCapabilityConfig({binary:f.binary,cwd:f.root,env:{...process.env,AUDIT_LOG:f.log},userConfigArgs:['--config','model="user-model"'],managedAssignments:['instructions="managed"']})
    assert.ok(got.includes('instructions="USER\\nRULE\\n\\nmanaged"'))
    assert.ok(got.includes('mcp_servers.audit.disabled_tools=["user","role"]'))
    assert.ok(got.includes('mcp_servers.audit.enabled=false'))
    assert.ok(got.includes('skills.config=[{"path"="/user/SKILL.md","enabled"=false},{"path"="/role/SKILL.md","enabled"=false}]'))
    assert.ok(!got.some(s=>s.startsWith('developer_instructions=')))
    const log=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(log.filter(x=>x.method==='config/read').length,2)
    assert.ok(log.filter(x=>x.args).every(x=>x.args.includes('model="user-model"')))
    assert.ok(log.filter(x=>x.method==='config/read').every(x=>x.cwd===f.root))
    for(const {pid} of log.filter(x=>x.pid))assert.throws(()=>process.kill(pid,0))
  } finally {f.cleanup()}
})
for(const mode of ['hang','error'])test(mode+' fails closed and cleans probe processes without exposing upstream errors',async()=>{
 const f=fixture(mode)
 try{
  await assert.rejects(mergeCodexCapabilityConfig({binary:f.binary,cwd:f.root,env:{...process.env,AUDIT_LOG:f.log},managedAssignments:[],timeoutMs:mode==='hang'?1000:10000}), e=>!e.message.includes('SECRET_DO_NOT_PRINT'))
  for(const {pid} of (fs.existsSync(f.log)?fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse):[]).filter(x=>x.pid))assert.throws(()=>process.kill(pid,0))
 }finally{f.cleanup()}
})

test('profile-v2 is rejected rather than reading a different effective configuration', async()=>{
 await assert.rejects(mergeCodexCapabilityConfig({binary:'/must-not-launch',cwd:'/tmp',userConfigArgs:['--profile','work']}),/profile/)
})
test('AbortSignal terminates owned probe and never starts the second probe',async()=>{
 const f=fixture('hang'),controller=new AbortController()
 try{
  const pending=mergeCodexCapabilityConfig({binary:f.binary,cwd:f.root,env:{...process.env,AUDIT_LOG:f.log},signal:controller.signal})
  const rejection=assert.rejects(pending,/已取消/)
  // The full suite launches many native processes; wait for the fixture's ready evidence.
  const deadline=Date.now()+10000
  while(!fs.existsSync(f.log)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10))
  controller.abort();await rejection
  const processes=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).filter(x=>x.pid)
  assert.equal(processes.length,1)
  assert.throws(()=>process.kill(processes[0].pid,0))
 }finally{f.cleanup()}
})

// Opt-in integration: native binary, isolated CODEX_HOME, no credentials or model calls.
test('native Codex parses final multiline and quoted TOML assignments without losing user settings', {skip: !process.env.EAS_TEST_NATIVE_CODEX}, async()=>{
 const {spawn}=await import('node:child_process')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-native 合并-'))
 const binary=process.env.EAS_TEST_NATIVE_CODEX
 const env={...process.env,CODEX_HOME:root}
 const original='用户第一行\n第二行 "引用" \\ 路径\t制表符\u007f'
 const dev='用户 developer 规则'
 const managed='managed\n第二行'
 try{
  fs.writeFileSync(path.join(root,'config.toml'),[
   'instructions='+JSON.stringify(original).replace(/\x7f/g,'\\u007f'),
   'developer_instructions='+JSON.stringify(dev),
   '[mcp_servers.audit]','command="node"','enabled=false','disabled_tools=["user_disabled"]',
   '[[skills.config]]','path="/tmp/user 技能/SKILL.md"','enabled=false'
  ].join('\n'))
  const assignments=await mergeCodexCapabilityConfig({binary,cwd:root,env,userConfigArgs:['--config','model_reasoning_effort="low"'],managedAssignments:[
   'instructions='+JSON.stringify(managed),
   'mcp_servers.audit.disabled_tools=["role_disabled"]',
   'skills.config=[{path="/tmp/role/SKILL.md",enabled=false}]'
  ]})
  const config=await new Promise((resolve,reject)=>{
   const p=spawn(binary,['app-server','-c','model_reasoning_effort="low"',...assignments.flatMap(a=>['-c',a])],{env,cwd:root,stdio:['pipe','pipe','ignore']})
   let result,error,buffer=''
   const timer=setTimeout(()=>{error=new Error('native config probe timeout');p.kill('SIGKILL')},10000)
   const send=m=>p.stdin.write(JSON.stringify(m)+'\n')
   p.on('error',e=>{error=e})
   p.on('close',()=>{clearTimeout(timer);error?reject(error):result?resolve(result):reject(new Error('no native config'))})
   p.stdout.setEncoding('utf8');p.stdout.on('data',chunk=>{
    buffer+=chunk;let end
    while((end=buffer.indexOf('\n'))>=0){
     const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue
     const m=JSON.parse(line)
     if(m.error){error=new Error('native config rejected');p.kill('SIGKILL');return}
     if(m.id===1){send({method:'initialized'});send({id:2,method:'config/read',params:{cwd:root,includeLayers:false}})}
     if(m.id===2){result=m.result.config;p.kill('SIGTERM')}
    }
   })
   send({id:1,method:'initialize',params:{clientInfo:{name:'merge_validation',version:'1'},capabilities:{experimentalApi:true}}})
  })
  assert.equal(config.instructions,original+'\n\n'+managed)
  assert.equal(config.developer_instructions,dev)
  assert.equal(config.model_reasoning_effort,'low')
  assert.equal(config.mcp_servers.audit.enabled,false)
  assert.deepEqual(config.mcp_servers.audit.disabled_tools,['user_disabled','role_disabled'])
  assert.deepEqual(config.skills.config,[{path:'/tmp/user 技能/SKILL.md',enabled:false},{path:'/tmp/role/SKILL.md',enabled:false}])
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
