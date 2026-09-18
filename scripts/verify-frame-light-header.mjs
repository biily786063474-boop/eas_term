// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=path.join(root,'docs/verification/frame-light-header');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'插入菜单验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const executable=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,root,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}


try {
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.__store && !!window.api'))
 await wait(1500)
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',80,80);s.setViewport({x:0,y:0,scale:1});s.setTheme('dark')})()")
 await until(()=>main.eval("!!document.querySelector('.cframe-head')"))
 const style=()=>main.eval("(()=>{const h=getComputedStyle(document.querySelector('.cframe-head'));return {image:h.backgroundImage,bg:h.backgroundColor,shadow:h.boxShadow,fg:getComputedStyle(document.querySelector('.cframe-name')).color}})()")
 const shot=async name=>{await wait(400);const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
 const dark=await style();await shot('dark')
 await main.eval("window.__store.getState().setTheme('light')")
 await wait(300)
 const light=await style();await shot('light')
 check(light.image.includes('linear-gradient'),'亮色标题栏具有渐变而非纯黑底')
 check(light.shadow!=='none','亮色标题栏具有高光层次')
 check(Number(light.fg.match(/\d+/)[0])<100,'亮色标题文字为深色')
 await main.eval("window.__store.getState().setTheme('dark')")
 await wait(300)
 check(JSON.stringify(await style())===JSON.stringify(dark),'切回暗色恢复原样式')
 await main.eval("window.__store.getState().setTheme('light');const s=window.__store.getState();s.toggleCollapse(s.canvas.frames[0].id)")
 await shot('light-collapsed')
 check(await main.eval("getComputedStyle(document.querySelector('.cframe-head')).borderBottomWidth==='0px'"),'折叠状态无底部分隔线')
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,dark,light},null,2))
 console.log(JSON.stringify({passed:true,checks,dark,light},null,2))
} catch(e) {
 console.error(e);process.exitCode=1
 fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))
} finally {
 for(const ws of sockets)ws.close()
 child.kill('SIGTERM')
 await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)])
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 fs.writeFileSync(path.join(output,'app.log'),logs)
 await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})
 await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
