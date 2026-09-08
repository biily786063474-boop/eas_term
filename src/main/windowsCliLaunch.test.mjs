// Windows child-process integration against representative official package-layout fixtures.
// No real model acceptance, credentials, network services or install/update commands.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { finished } from 'node:stream/promises'
import {spawn,execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolveCliInvocation,cliInvocationEnv} from '../../mcp/cli-entry.mjs'
import {ownCodexLauncher,stopAgentProcess} from '../../mcp/owned-launcher-control.mjs'
import {readAndMergeCodexConfig} from '../../mcp/codex-capability-config.mjs'
// Compile a small native PE fixture using the Windows runner's existing .NET
// compiler. It is a protocol fixture, never a downloaded CLI or model acceptance.
function nativeFixture(root, output) {
 const source=path.join(root,'Fixture.cs')
 fs.writeFileSync(source, `using System; using System.IO; using System.Text; using System.Threading; using System.Diagnostics; using System.Collections.Generic; using System.Web.Script.Serialization;
class Fixture {
 static void Main(string[] args) {
  Console.OutputEncoding = new UTF8Encoding(false); Console.InputEncoding = new UTF8Encoding(false);
  var json = new JavaScriptSerializer();
  File.AppendAllText(Environment.GetEnvironmentVariable("FIXTURE_LOG"), json.Serialize(new { pid=Process.GetCurrentProcess().Id, args=args })+"\\n", new UTF8Encoding(false));
  if(args.Length>0 && args[0]=="app-server") {
   if(Environment.GetEnvironmentVariable("FIXTURE_HANG")=="1") {Thread.Sleep(Timeout.Infinite);return;}
   string line; while((line=Console.ReadLine())!=null) {
    var m=json.Deserialize<Dictionary<string,object>>(line); if(!m.ContainsKey("id"))continue;
    object result=new {}; if((string)m["method"]=="config/read")result=new {config=new {instructions="USER",mcp_servers=new {},skills=new {config=new object[0]}}};
    Console.WriteLine(json.Serialize(new {id=m["id"],result=result}));
   }
  } else { if(Environment.GetEnvironmentVariable("FIXTURE_HANG_EXEC")=="1") {Thread.Sleep(Timeout.Infinite);return;} Console.WriteLine(json.Serialize(new {args=args,root=Environment.GetEnvironmentVariable("CODEX_MANAGED_PACKAGE_ROOT"),npm=Environment.GetEnvironmentVariable("CODEX_MANAGED_BY_NPM"),bun=Environment.GetEnvironmentVariable("CODEX_MANAGED_BY_BUN"),pnpm=Environment.GetEnvironmentVariable("CODEX_MANAGED_BY_PNPM"),vite=Environment.GetEnvironmentVariable("CODEX_MANAGED_BY_VITE_PLUS"),firstPath=Environment.GetEnvironmentVariable("PATH").Split(';')[0]})); }
 }
}`)
 fs.mkdirSync(path.dirname(output),{recursive:true})
 const compiler=path.join(process.env.SystemRoot||process.env.SYSTEMROOT||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe')
 execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll','/out:'+output,source],{windowsHide:true,timeout:30000})
}
function fixture(t,kind){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'Windows CLI 中文-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const pkg=path.join(root,'node_modules',kind==='codex'?'@openai/codex':'@anthropic-ai/claude-code'),bin=kind==='codex'?'bin/codex.js':'cli.js'
 fs.mkdirSync(path.dirname(path.join(pkg,bin)),{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:kind==='codex'?'@openai/codex':'@anthropic-ai/claude-code',version:'1.2.3',bin:{[kind]:bin}}))
 const source=`const fs=require('fs'),rl=require('readline');const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({pid:process.pid,args})+'\\n');if(args[0]==='app-server'){rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(process.env.FIXTURE_HANG)return;if(m.id)console.log(JSON.stringify({id:m.id,result:m.method==='config/read'?{config:{instructions:'USER',mcp_servers:{audit:{enabled:false,disabled_tools:['user']}},skills:{config:[]}}}:{}}))})}else console.log(JSON.stringify({args,lease:process.env.EAS_CAPABILITY_LEASE,parent:process.env.EAS_CAPABILITY_PARENT}))`
 fs.writeFileSync(path.join(pkg,bin),source);const shim=path.join(root,kind+'.cmd');fs.writeFileSync(shim,'@echo SHIM MUST NOT EXECUTE\nexit /b 99')
 let native
 if(kind==='codex'){
  native=path.join(pkg,'vendor','x86_64-pc-windows-msvc','codex','codex.exe');nativeFixture(root,native);fs.mkdirSync(path.join(pkg,'vendor','x86_64-pc-windows-msvc','path'))
  // Actual dispatcher topology if mistakenly executed: Node -> native child.
  fs.writeFileSync(path.join(pkg,bin),`require('fs').writeFileSync(${JSON.stringify(path.join(root,'dispatcher-ran'))},'BAD');const c=require('child_process').spawn(${JSON.stringify(native)},process.argv.slice(2),{stdio:'inherit'});c.on('exit',code=>process.exit(code));`)
 }
 return {root,pkg,native,shim,log:path.join(root,'log')}
}
const interpreter=process.env.EAS_TEST_NODE_RUNNER||process.execPath
const interpreterEnv=process.env.EAS_TEST_NODE_RUNNER?{ELECTRON_RUN_AS_NODE:'1',EAS_CAPABILITY_NODE_FALLBACK:'1'}:{}
function start(script,args,env,cwd,controlled=false){
 const p=spawn(interpreter,[script,...args],{cwd,env:{...process.env,...env,...interpreterEnv},stdio:controlled?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe']})
 if(controlled)ownCodexLauncher(p)
 let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x)
 // Node can omit ChildProcess close after parent.disconnect(); wait for exit and
 // both pipes explicitly, so cancellation tests still prove complete stream cleanup.
 const exited=new Promise((resolve,reject)=>{p.on('error',reject);p.once('exit',(code,signal)=>resolve({code,signal}))})
 const done=Promise.all([exited,finished(p.stdout),finished(p.stderr)]).then(([result])=>({...result,out,err}))
 return {p,done}
}
function run(script,args,env,cwd,controlled=false){return start(script,args,env,cwd,controlled).done}
const args=['exec','--','中文 空格','a"b','&','|','^','%PATH%','!','line\nbreak']
test('Windows Codex owned launcher uses npm entry for both config reads and final exact argv', {skip:process.platform!=='win32'},async t=>{
 const f=fixture(t,'codex'),script=fileURLToPath(new URL('../../mcp/eas-codex-launcher.mjs',import.meta.url))
 const r=await run(script,[JSON.stringify({binary:f.shim,args,managedAssignments:[]})],{FIXTURE_LOG:f.log,CODEX_MANAGED_PACKAGE_ROOT:'stale-root',CODEX_MANAGED_BY_BUN:'1',CODEX_MANAGED_BY_PNPM:'1',CODEX_MANAGED_BY_VITE_PLUS:'1'},f.root,true)
 assert.equal(r.code,0,r.err);assert.deepEqual(JSON.parse(r.out),{args,root:fs.realpathSync(f.pkg),npm:'1',bun:null,pnpm:null,vite:null,firstPath:fs.realpathSync(path.join(f.pkg,'vendor','x86_64-pc-windows-msvc','path'))});assert.equal(fs.existsSync(path.join(f.root,'dispatcher-ran')),false)
 const rows=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.args[0]==='app-server').length,2)
 for(const row of rows)assert.throws(()=>process.kill(row.pid,0))
})
test('Windows Claude PTY resolves npm before lease, preserves argv and closes lease', {skip:process.platform!=='win32'},async t=>{
 const f=fixture(t,'claude'),calls=[],parent={instanceId:'fixture',generation:'g',id:'p',secret:'fixture'}
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);calls.push(req.url);if(req.url.endsWith('/close'))return res.end(JSON.stringify({ok:true}));const launch=resolveCliInvocation('claude',body.binary,body.args,{}, {command:process.execPath,args:[]});res.end(JSON.stringify({ok:true,result:{...launch,leaseId:'child',env:{EAS_CAPABILITY_LEASE:'fixture-lease'}}}))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const script=fileURLToPath(new URL('../../mcp/eas-pty-launcher.mjs',import.meta.url))
 const r=await run(script,['claude',...args],{PATH:f.root,PATHEXT:'.EXE;.CMD',FIXTURE_LOG:f.log,EAS_TERM_PORT:String(server.address().port),EAS_CAPABILITY_PARENT:JSON.stringify(parent)},f.root)
 assert.equal(r.code,0,r.err);assert.deepEqual(JSON.parse(r.out),{args,lease:'fixture-lease'});assert.deepEqual(calls,['/capability/launch','/capability/launch/close'])
})
test('Windows cancellation aborts the owned npm config child before model invocation', {skip:process.platform!=='win32'},async t=>{
 const f=fixture(t,'codex'),controller=new AbortController(),launch=resolveCliInvocation('codex',f.shim,[],{}, {command:process.execPath,args:[]})
 assert.equal(launch.command,fs.realpathSync(f.native));assert.deepEqual(launch.args,[])
 const pending=readAndMergeCodexConfig({binary:launch.command,prefixArgs:launch.args,cwd:f.root,env:cliInvocationEnv({...process.env,FIXTURE_LOG:f.log,FIXTURE_HANG:'1'},launch),signal:controller.signal})
 const rejection=assert.rejects(pending,/取消/)
 const deadline=Date.now()+5000;while(!fs.existsSync(f.log)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10))
 assert.ok(fs.existsSync(f.log));controller.abort();await rejection
 const rows=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,1);assert.equal(fs.existsSync(path.join(f.root,'dispatcher-ran')),false);assert.throws(()=>process.kill(rows[0].pid,0))
})

for(const phase of ['config','exec']) for(const action of ['cancel','disconnect']) test(`Windows outer launcher ${action} during ${phase} removes its owned native child`,{skip:process.platform!=='win32',timeout:15000},async t=>{
 const f=fixture(t,'codex'),script=fileURLToPath(new URL('../../mcp/eas-codex-launcher.mjs',import.meta.url))
 const {p,done}=start(script,[JSON.stringify({binary:f.shim,args:['exec','fixture'],managedAssignments:[]})],{FIXTURE_LOG:f.log,...(phase==='config'?{FIXTURE_HANG:'1'}:{FIXTURE_HANG_EXEC:'1'})},f.root,true)
 const read=()=>fs.existsSync(f.log)?fs.readFileSync(f.log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
 try{
  const deadline=Date.now()+5000
  while(!read().some(r=>phase==='config'?r.args[0]==='app-server':r.args[0]==='exec')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10))
  assert.ok(read().some(r=>phase==='config'?r.args[0]==='app-server':r.args[0]==='exec'))
  if(action==='cancel'){stopAgentProcess(p);stopAgentProcess(p,'SIGKILL')}else p.disconnect()
  const result=await done;assert.notEqual(result.code,0)
  for(const row of read())assert.throws(()=>process.kill(row.pid,0))
  assert.equal(read().filter(r=>r.args[0]==='exec').length,phase==='config'?0:1)
  assert.equal(fs.existsSync(path.join(f.root,'dispatcher-ran')),false)
 }finally{if(p.exitCode===null&&p.signalCode===null){stopAgentProcess(p,'SIGKILL');if(p.connected)p.disconnect();await done}}
})
test('Windows parent disconnect before launcher preflight cannot invoke a model', {skip:process.platform!=='win32',timeout:15000},async t=>{
 const f=fixture(t,'codex'),script=fileURLToPath(new URL('../../mcp/eas-codex-launcher.mjs',import.meta.url))
 const {p,done}=start(script,[JSON.stringify({binary:f.shim,args:['exec','fixture'],managedAssignments:[]})],{FIXTURE_LOG:f.log,FIXTURE_HANG:'1'},f.root,true)
 p.disconnect();const result=await done;assert.notEqual(result.code,0)
 const rows=fs.existsSync(f.log)?fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse):[]
 assert.equal(rows.some(r=>r.args[0]==='exec'),false);for(const row of rows)assert.throws(()=>process.kill(row.pid,0))
})

test('Windows owned IPC launcher exits on invalid installation without starting native', {skip:process.platform!=='win32',timeout:15000},async t=>{
 const f=fixture(t,'codex'),script=fileURLToPath(new URL('../../mcp/eas-codex-launcher.mjs',import.meta.url))
 fs.writeFileSync(path.join(f.pkg,'package.json'),JSON.stringify({name:'unknown',version:'1.2.3',bin:{codex:'bin/codex.js'}}))
 const {p,done}=start(script,[JSON.stringify({binary:f.shim,args:['exec','fixture']})],{FIXTURE_LOG:f.log},f.root,true)
 const result=await done;assert.notEqual(result.code,0);assert.equal(p.connected,false);assert.equal(fs.existsSync(f.log),false)
})
