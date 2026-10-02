// 隔离实例：网页没给 html/body 设背景时，画布网页节点里那块的颜色要和浏览器一致 ——
// 普通页面白底、声明 color-scheme: dark 的页面深底（2026-10-02 用户截图：阿里云控制台没设背景的区域变成黑色）。
// 用法：先 electron-vite build；DARKPAGE=1 测声明深色的页面。截图与结果到 docs/verification/webview-canvas/。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import {spawn} from 'node:child_process'
const root=process.cwd(), profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-webbg-'))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false,lang:'zh'}))
const page=`<!doctype html><html><head><meta charset="utf-8">${process.env.DARKPAGE?'<meta name="color-scheme" content="dark">':''}</head><body style="margin:0"><div id="probe" style="height:200px"></div><div style="background:#fff;height:200px">white card</div></body></html>`
const server=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(page)});await new Promise(r=>server.listen(0,'127.0.0.1',r))
const url='http://127.0.0.1:'+server.address().port
const env={...process.env,HOME:path.join(profile,'h'),EAS_VERIFY:'1'};fs.mkdirSync(env.HOME)
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']});let logs='';app.stdout.on('data',x=>logs+=x);app.stderr.on('data',x=>logs+=x)
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
async function connect(u){const ws=new WebSocket(u);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)};const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))});return{send,ev:async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value}}
try{
 const dp=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const list=async()=>(await(await fetch(`http://127.0.0.1:${dp}/json/list`)).json())
 const main=await connect((await until(async()=>(await list()).find(t=>t.type==='page'&&t.title==='Eas-Term'))).webSocketDebuggerUrl)
 await until(()=>main.ev('!!window.__store'));await wait(1500);await main.ev("document.querySelector('.onb-ghost')?.click();true")
 const theme=process.env.THEME||'dark'
 await main.ev(`(()=>{const s=window.__store.getState();s.setViewMode('canvas');s.addProjectFrame(null,60,60);const f=window.__store.getState().canvas.frames.at(-1);s.addWebNode(f.id,${JSON.stringify(url)});s.setViewport({x:0,y:0,scale:1});return true})()`)
 const guest=await until(async()=>(await list()).find(t=>t.type==='webview'&&t.url.startsWith(url)))
 await wait(2500)
 const g=await connect(guest.webSocketDebuggerUrl)
 const info=await g.ev(`({meta:!!document.querySelector('meta[name=color-scheme]'),textColor:getComputedStyle(document.body).color,inner:[innerWidth,innerHeight],scrollH:document.documentElement.scrollHeight,bodyBg:getComputedStyle(document.body).backgroundColor,htmlBg:getComputedStyle(document.documentElement).backgroundColor,dark:matchMedia('(prefers-color-scheme: dark)').matches,cs:getComputedStyle(document.documentElement).colorScheme})`)
 const r=await main.ev(`(()=>{const w=document.querySelector('webview.web-frame');const b=w.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,elBg:getComputedStyle(w).backgroundColor}})()`)
 const shot=(await main.send('Page.captureScreenshot',{format:'png'})).result.data
 const out=path.join(root,'docs/verification/webview-canvas');fs.mkdirSync(out,{recursive:true});const tag=process.env.DARKPAGE?'dark-page':'plain-page'
 fs.writeFileSync(path.join(out,tag+'.png'),Buffer.from(shot,'base64'))
 const px=await main.ev(`getComputedStyle(document.querySelector('webview.web-frame')).backgroundColor`)
 const want=process.env.DARKPAGE?'rgb(18, 18, 18)':'rgb(255, 255, 255)'
 fs.writeFileSync(path.join(out,tag+'.json'),JSON.stringify({guestPage:info,elementBackground:px,want},null,1))
 if(px!==want)throw Error('网页节点底色 '+px+'，应为 '+want)
 console.log('PASS',tag,px)
 console.log(JSON.stringify({guestPage:info,webviewElement:r}))
}finally{app.kill('SIGTERM');await wait(1200);try{app.kill('SIGKILL')}catch{};server.close();fs.rmSync(profile,{recursive:true,force:true})}
