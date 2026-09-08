// Windows child-process integration against representative official JS-bin fixtures.
// No real model acceptance, credentials, network services or install/update commands.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolveCliInvocation} from '../../mcp/cli-entry.mjs'
import {readAndMergeCodexConfig} from '../../mcp/codex-capability-config.mjs'
function fixture(t,kind){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'Windows CLI 中文-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const pkg=path.join(root,'node_modules',kind==='codex'?'@openai/codex':'@anthropic-ai/claude-code'),bin=kind==='codex'?'bin/codex.js':'cli.js'
 fs.mkdirSync(path.dirname(path.join(pkg,bin)),{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:kind==='codex'?'@openai/codex':'@anthropic-ai/claude-code',version:'1.2.3',bin:{[kind]:bin}}))
 const source=`const fs=require('fs'),rl=require('readline');const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({pid:process.pid,args})+'\\n');if(args[0]==='app-server'){rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(process.env.FIXTURE_HANG)return;if(m.id)console.log(JSON.stringify({id:m.id,result:m.method==='config/read'?{config:{instructions:'USER',mcp_servers:{audit:{enabled:false,disabled_tools:['user']}},skills:{config:[]}}}:{}}))})}else console.log(JSON.stringify({args,lease:process.env.EAS_CAPABILITY_LEASE,parent:process.env.EAS_CAPABILITY_PARENT}))`
 fs.writeFileSync(path.join(pkg,bin),source);const shim=path.join(root,kind+'.cmd');fs.writeFileSync(shim,'@echo SHIM MUST NOT EXECUTE\nexit /b 99')
 return {root,shim,log:path.join(root,'log')}
}
function run(script,args,env,cwd){const p=spawn(process.execPath,[script,...args],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);return new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,out,err}))})}
const args=['exec','--','中文 空格','a"b','&','|','^','%PATH%','!','line\nbreak']
test('Windows Codex owned launcher uses npm entry for both config reads and final exact argv', {skip:process.platform!=='win32'},async t=>{
 const f=fixture(t,'codex'),script=fileURLToPath(new URL('../../mcp/eas-codex-launcher.mjs',import.meta.url))
 const r=await run(script,[JSON.stringify({binary:f.shim,args,managedAssignments:[]})],{FIXTURE_LOG:f.log},f.root)
 assert.equal(r.code,0,r.err);assert.deepEqual(JSON.parse(r.out).args,args)
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
 const pending=readAndMergeCodexConfig({binary:launch.command,prefixArgs:launch.args,cwd:f.root,env:{...process.env,FIXTURE_LOG:f.log,FIXTURE_HANG:'1'},signal:controller.signal})
 const rejection=assert.rejects(pending,/取消/)
 const deadline=Date.now()+5000;while(!fs.existsSync(f.log)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10))
 assert.ok(fs.existsSync(f.log));controller.abort();await rejection
 const rows=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,1);assert.throws(()=>process.kill(rows[0].pid,0))
})
