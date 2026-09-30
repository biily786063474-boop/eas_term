// 英文适配第一档验收（浏览器 / 终端 / 代码与图片 / Git）。基于 verify-i18n-p1.mjs（隔离实例，界面语言 English）：主界面逐个截图，并列出每个界面上残留的中文片段。
// 不连模型、不登录任何账号。项目名用英文，免得把用户数据算成残留。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn,execSync} from 'node:child_process'
globalThis.__req=(m)=>({'node:child_process':{execSync}})[m]
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-i18nt1-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'demo')
const out=path.join(root,'docs/verification/i18n-t1');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'d',name:'demo',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:true,lang:'en'}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
// 素材：一个带两次提交的 git 仓库、一个代码文件、一张图、一个本地网页
import('node:child_process').then(()=>{})
const sh=(c)=>require_('node:child_process').execSync(c,{cwd,stdio:'ignore',env:{...process.env,GIT_AUTHOR_NAME:'demo',GIT_AUTHOR_EMAIL:'d@x',GIT_COMMITTER_NAME:'demo',GIT_COMMITTER_EMAIL:'d@x'}})
function require_(m){return globalThis.__req(m)}
fs.writeFileSync(path.join(cwd,'app.ts'),'export function hello(name: string): string {\n  return `hello ${name}`\n}\n')
fs.writeFileSync(path.join(cwd,'page.html'),'<!doctype html><html><body style="font:16px -apple-system;margin:20px">demo page</body></html>')
fs.copyFileSync(path.join(root,'build/icon.png'),path.join(cwd,'logo.png'))
const canvasFile=path.join(profile,'canvas.json')
sh('git init -q && git add app.ts && git commit -qm "init" && git add page.html && git commit -qm "add page"')
fs.writeFileSync(path.join(canvasFile),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:0.62},frames:[{id:'f',projectId:'d',name:'demo',x:20,y:20,w:2900,h:1500,collapsed:false,nodes:[
 {id:'n1',x:20,y:50,w:900,h:620,pane:{kind:'code',filePath:path.join(cwd,'app.ts')}},
 {id:'n2',x:940,y:50,w:900,h:620,pane:{kind:'web',url:'file://'+path.join(cwd,'page.html')}},
 {id:'n3',x:940,y:700,w:900,h:620,component:{type:'git'}},
 {id:'n4',x:20,y:700,w:900,h:620,pane:{kind:'image',filePath:path.join(cwd,'logo.png')}}]}],shapes:[],freeNodes:[],todos:[]}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const INSPECT=9498
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0',`--inspect=${INSPECT}`,'--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))})
 return {ws,send,ev:async x=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}}}
const report={};const sockets=[]
// 可见文本里的中文片段（去重），用来找漏迁
const RESIDUE=`(()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const el=n.parentElement;if(!el)continue;const st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden')continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;for(const m of n.textContent.matchAll(/[^\\s]*[\\u4e00-\\u9fff][^\\s]*/g))out.add(m[0].slice(0,40))}
 for(const el of document.querySelectorAll('[placeholder],[data-tip],[title],[aria-label]'))for(const a of ['placeholder','data-tip','title','aria-label']){const v=el.getAttribute(a);if(v&&/[\\u4e00-\\u9fff]/.test(v))out.add('@'+a+': '+v.slice(0,40))}
 return [...out]})()`
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const list=async()=>{try{return await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()}catch{return []}}
 const page=await connect((await until(async()=>(await list()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl);sockets.push(page.ws)
 const main=await connect((await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json())[0]}catch{return null}})).webSocketDebuggerUrl);sockets.push(main.ws)
 await until(()=>page.ev('!!window.__store'))
 await wait(1500)
 const shot=async(name)=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(s.result.data,'base64'));report[name]=await page.ev(RESIDUE)}
 const click=(re)=>page.ev(`(()=>{const b=[...document.querySelectorAll('button,[role=button],a,.cset-nav button')].find(b=>${re}.test((b.textContent||'').trim()));if(b){b.click();return true}return false})()`)
 const esc=()=>page.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true")
 for(let i=0;i<30;i++){if(await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 await wait(3500)
 await shot('01-code-web-git-image')
 // 终端：在 Frame 里加一个终端模块
 await page.ev("window.__store.getState().addTerminalNode('f')").catch(()=>{});await wait(2500)
 await shot('02-with-terminal')
 // 每个模块单独最大化各截一张（看工具栏、收藏栏、右键菜单这些细节）
 for(const [id,name] of [['n1','03-code-max'],['n2','04-web-max'],['n3','05-git-max'],['n4','06-image-max']]){
  await page.ev(`window.__store.getState().setMaximizedNode({frameId:'f',nodeId:'${id}'});true`);await wait(1800);await shot(name)
  await page.ev("window.__store.getState().setMaximizedNode(null);true");await wait(600)
 }
 // 终端右键菜单
 await page.ev("(()=>{const el=document.querySelector('.xterm-screen');if(!el)return false;const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+60,clientY:r.top+60}));return true})()");await wait(700)
 await shot('07-terminal-menu')
 fs.writeFileSync(path.join(out,'residue.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k,v])=>[k,Array.isArray(v)?`${v.length} 处`:v])),null,1))
}finally{for(const w of sockets)try{w.close()}catch{};app.kill('SIGTERM');await wait(1500);try{app.kill('SIGKILL')}catch{};fs.rmSync(temp,{recursive:true,force:true})}
