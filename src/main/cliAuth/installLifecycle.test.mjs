import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { build } from 'esbuild'
import path from 'node:path'

test('安装真实控制器：重入、快照、窗口/代次取消、真实 close、晚到验证', async () => {
 const handlers=new Map(),processes=[],messages=[],signals=[],cacheRefreshes=[]
 let verification=()=>Promise.resolve({installed:true})
 const fixture={handlers,messages,cacheRefreshes,spawn:()=>{
  const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.pid=424242;p.kill=()=>signals.push('kill');processes.push(p);return p
 },check:()=>verification()}
 globalThis.__installLifecycle=fixture
 const stubs={
 electron:"export const BrowserWindow={getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(_c,s)=>globalThis.__installLifecycle.messages.push({...s})}}]}",
 child_process:"export const spawn=(...a)=>globalThis.__installLifecycle.spawn(...a)",
 '../ipcGuard':"export const guardedHandle=(n,f)=>globalThis.__installLifecycle.handlers.set(n,f)",
 './ownedProcess.ts':"export const registerOwnedCliProcess=()=>({})",
 '../agentInstall':"export const installPlan=()=>({claude:{options:[{cmd:'TEST'}]},codex:{options:[{cmd:'TEST'}]}})",
 '../probeEnv':"export const PROBE_ENV={}",
 './log':"export const alog=()=>{}",
 './index':"export const checkAuth=()=>globalThis.__installLifecycle.check()"
 , '../agentChat/session':"export const refreshCliCache=()=>globalThis.__installLifecycle.cacheRefreshes.push('refresh')"
 }
 const out=await build({entryPoints:[path.resolve('src/main/cliAuth/install.ts')],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'isolated-controller',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}))}}]})
 const api=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))
 const originalKill=process.kill;process.kill=(pid,signal)=>{signals.push([pid,signal]);return true}
 const flush=()=>new Promise(r=>setImmediate(r))
 try{
  api.registerCliInstallHandlers()
  assert.equal(api.startInstall('codex','TEST',{windowId:10}).ok,true)
  const task=api.installSnapshot('codex')
  assert.equal(api.startInstall('codex','TEST',{windowId:10}).ok,false)
  const cancel=handlers.get('cliAuth:cancelInstall')
  assert.equal(cancel({sender:{id:11}},'codex',task.taskId).ok,false)
  assert.equal(cancel({sender:{id:10}},'codex',task.taskId-1).ok,false)
  assert.equal(signals.length,0)
  assert.equal(cancel({sender:{id:10}},'codex',task.taskId).ok,true)
  assert.equal(api.installSnapshot('codex').phase,'stopping')
  assert.equal(api.startInstall('claude','TEST',{windowId:10}).ok,false)
  processes[0].emit('close',null)
  assert.equal(api.installSnapshot('codex').phase,'canceled')
  assert.equal(api.startInstall('codex','TEST',{windowId:10}).ok,true)
  assert.equal(cancel({sender:{id:10}},'codex',task.taskId).ok,false)
  let resolve;verification=()=>new Promise(r=>resolve=r)
  processes[1].emit('close',0)
  assert.equal(api.installSnapshot('codex').phase,'verifying')
  api.cancelInstall()
  assert.equal(api.installSnapshot('codex').phase,'canceled')
  resolve({installed:true});await flush()
  assert.equal(api.installSnapshot('codex').phase,'canceled')
  verification=()=>Promise.reject(Error('probe failed'))
  api.startInstall('claude','TEST',{windowId:10});processes[2].emit('close',0);await flush()
  assert.equal(api.installSnapshot('claude').phase,'failed')
  assert.match(api.installSnapshot('claude').error,/验证异常/)
  verification=()=>Promise.resolve({installed:true,error:'spawn EACCES'})
  api.startInstall('claude','TEST',{windowId:10});processes[3].emit('close',0);await flush()
  assert.equal(api.installSnapshot('claude').phase,'failed')
  assert.match(api.installSnapshot('claude').error,/无法验证程序启动/)
  // Installer failure is authoritative. A later status probe may itself fail or
  // find an older binary; neither may replace the installer's real exit code.
  let probes=0;verification=()=>{probes++;return Promise.resolve({installed:true,error:'probe EACCES'})}
  api.startInstall('codex','TEST',{windowId:10})
  processes[4].stderr.emit('data',Buffer.from('curl: (6) Could not resolve host: chatgpt.com\n'))
  processes[4].emit('close',6);await flush()
  assert.equal(probes,0)
  assert.equal(api.installSnapshot('codex').phase,'failed')
  assert.match(api.installSnapshot('codex').error,/退出码 6/)
  assert.match(api.installSnapshot('codex').output.join('\n'),/Could not resolve host/)
  verification=()=>Promise.resolve({installed:true})
  api.startInstall('codex','TEST',{windowId:10});processes[5].emit('close',0);await flush()
  assert.equal(api.installSnapshot('codex').phase,'done')
  assert.equal(cacheRefreshes.length,1)
  assert.equal(messages.at(-1).phase,'done')
 } finally {
  api.cancelInstall();for(const p of processes)p.emit('close',null)
  process.kill=originalKill;delete globalThis.__installLifecycle
 }
})
