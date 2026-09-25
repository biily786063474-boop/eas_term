// Real Electron, disposable profile and fake key. No production credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-vault-trust-'))
const profile=path.join(dir,'profile'),home=path.join(dir,'home');fs.mkdirSync(profile);fs.mkdirSync(home)
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const bootstrap=path.join(dir,'launch.cjs')
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};const {app}=require('electron');app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
const env={...process.env,EAS_VERIFY:'1'};for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_')||/TOKEN|API_KEY|SECRET|PASSWORD/.test(n))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[]
const check=(value,label)=>{if(!value)throw Error(label);checks.push(label)}
async function until(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await wait(100)}throw Error('Timed out')}
async function launch(){
 const portFile=path.join(profile,'DevToolsActivePort');if(fs.existsSync(portFile))fs.unlinkSync(portFile)
 const child=spawn('/usr/bin/sandbox-exec',['-p',policy,path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),bootstrap,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
 let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x)
 try{
  const port=await until(async()=>{try{return Number(fs.readFileSync(portFile,'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1200))}})
  const target=await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page'&&x.title==='Eas-Term'))
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map();ws.addEventListener('message',e=>{const msg=JSON.parse(e.data),p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result)}})
  const evalExpr=async expression=>{const call=++id,result=await new Promise((resolve,reject)=>{pending.set(call,{resolve,reject});ws.send(JSON.stringify({id:call,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value}
  await until(()=>evalExpr('!!window.api?.secrets'))
  return {evalExpr,close:async()=>{ws.close();child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(3000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')}}
 }catch(error){child.kill('SIGTERM');throw error}
}
let app
try{
 app=await launch();check((await app.evalExpr('window.api.secrets.setup("837194",true)')).ok,'主动信任设备')
 check((await app.evalExpr('window.api.secrets.save({name:"fixture",vars:[{varName:"FIXTURE_KEY",value:"fake-vault-key"}]})')).ok,'假密钥加密保存')
 check(!fs.readFileSync(path.join(profile,'secrets.json'),'utf8').includes('fake-vault-key'),'磁盘无明文')
 await app.close();app=null
 app=await launch();check(await app.evalExpr('window.api.secrets.status().then(s=>s.trustedDevice&&!s.locked)'),'重启后免输六位码')
 check(await app.evalExpr('window.api.secrets.list().then(items=>items.some(i=>i.name==="fixture"&&i.vars[0].readable))'),'重启后直接读取加密密钥元数据')
 check(await app.evalExpr('window.api.secrets.lock().then(s=>s.locked&&!s.trustedDevice)'),'手动锁定撤销设备信任')
 check((await app.evalExpr('window.api.secrets.unlock("837194")')).ok,'手动输入六位码重新解锁')
 check((await app.evalExpr('window.api.secrets.setTrustedDevice(true)')).status.trustedDevice,'手动解锁后可重新选择信任设备')
 check(await app.evalExpr('window.api.secrets.lock().then(s=>s.locked&&!s.trustedDevice)'),'再次手动锁定仍撤销信任')
 await app.close();app=null
 app=await launch();check(await app.evalExpr('window.api.secrets.status().then(s=>s.locked&&!s.trustedDevice)'),'撤销后重启仍要求六位码')
 console.log(JSON.stringify({passed:true,checks},null,2))
}catch(error){console.error(error);process.exitCode=1}finally{if(app)await app.close();await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
