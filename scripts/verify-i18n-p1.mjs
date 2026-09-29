// 英文适配 P1 验收（隔离实例，界面语言 English）：主界面逐个截图，并列出每个界面上残留的中文片段。
// 不连模型、不登录任何账号。项目名用英文，免得把用户数据算成残留。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-i18n1-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'demo')
const out=path.join(root,'docs/verification/i18n-p1');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'d',name:'demo',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:true,lang:'en'}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
// Frame + AI 对话模块要在启动前写进 canvas.json（运行时 setState 不会把节点实例化成对话）
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'f',projectId:'d',name:'demo',x:20,y:20,w:820,h:720,collapsed:false,nodes:[{id:'c',x:20,y:50,w:760,h:620,pane:{kind:'agent',cwd,cli:'claude'}}]}],shapes:[],freeNodes:[],todos:[]}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const INSPECT=9488
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
 // ① 首次引导（英文）
 await shot('01-onboarding')
 for(let i=0;i<30;i++){if(await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 await wait(800)
 // ② 画布（Frame + AI 对话首页）
 await shot('02-canvas-frame-chat')
 // ③ 右键菜单：点在 Frame 右边的空白处
 await page.ev("(()=>{const el=document.querySelector('.canvas-viewport')||document.body;const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+1300,clientY:r.top+400}));return true})()");await wait(600)
 await shot('03-canvas-context-menu');await esc();await wait(300)
 // ④ 任务监视器：把这个对话标成运行中
 const sid=await until(()=>page.ev("(()=>{const s=window.__store.getState();const walk=r=>r.pane?.kind==='agent'?(r.pane.sessionId||r.id):(r.children||[]).map(walk).find(Boolean);for(const t of s.tabs){const p=walk(t.root);if(p)return p}return null})()"),60).catch(()=>'demo-session')
 await page.ev(`window.__store.getState().setPtyRunning(${JSON.stringify(sid)},true);true`);await wait(800)
 await shot('04-frame-chat-runmonitor')
 // ⑤ 设置：每一页
 await click('/^Settings$/');await wait(900)
 const tabs=await page.ev("[...document.querySelectorAll('.cset-sidebar button, .cset-nav button')].map(b=>(b.textContent||'').trim()).filter(Boolean)")
 report._settingsTabs=tabs
 for(const [i,label] of tabs.entries()){await page.ev(`(()=>{const b=[...document.querySelectorAll('.cset-sidebar button, .cset-nav button')].find(b=>(b.textContent||'').trim()===${JSON.stringify(label)});b&&b.click();return true})()`);await wait(500);await shot(`05-settings-${String(i+1).padStart(2,'0')}-${label.replace(/[^A-Za-z0-9]+/g,'-').slice(0,30)}`)}
 await esc();await page.ev("(()=>{const b=document.querySelector('.cset-close');b&&b.click();return true})()");await wait(500)
 // ⑥ 顶栏入口：Quota / Keys / References
 for(const [name,re] of [['06-quota','/^Quota$/'],['07-keys','/^(Keys|Key Vault)$/'],['08-references','/^References$/']]){const ok=await click(re);await wait(1000);if(ok){await shot(name)}else report[name]='(入口没找到)';await esc();await wait(400)}
 // ⑦ 灵动岛：主窗口最小化后出现
 const electron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
 await main.ev(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).minimize();true`)
 const isl=await until(async()=>(await list()).find(x=>x.type==='page'&&/island/i.test(x.url)),80).catch(()=>null)
 if(isl){const I=await connect(isl.webSocketDebuggerUrl);sockets.push(I.ws);await wait(1500);const s=await I.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'09-island.png'),Buffer.from(s.result.data,'base64'));report['09-island']=await I.ev(RESIDUE)}else report['09-island']='(灵动岛未出现)'
 fs.writeFileSync(path.join(out,'residue.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k,v])=>[k,Array.isArray(v)?`${v.length} 处`:v])),null,1))
}finally{for(const w of sockets)try{w.close()}catch{};app.kill('SIGTERM');await wait(1500);try{app.kill('SIGKILL')}catch{};fs.rmSync(temp,{recursive:true,force:true})}
