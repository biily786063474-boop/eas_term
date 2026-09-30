// 英文适配第三档补充验收：蓝图详情与设计选型台的窄窗口、浮层分类标签、点词条插入的提示词语言、应用内更新提示的 notesEn。
// 更新检查指向本机假 latest.json（EAS_UPDATE_URL），不连线上。LANG_UI=zh 跑中文对照。
// LANG=zh node scripts/verify-i18n-t3.mjs 可跑中文对照（残留扫描此时无意义，只看截图）（隔离实例，界面语言 English）：主界面逐个截图，并列出每个界面上残留的中文片段。
// 不连模型、不登录任何账号。项目名用英文，免得把用户数据算成残留。
const LANGV=process.env.LANG_UI||'en'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn,execSync} from 'node:child_process'
globalThis.__req=(m)=>({'node:child_process':{execSync}})[m]
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-i18nt3b-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'demo')
const out=path.join(root,'docs/verification/i18n-t3/check-'+LANGV+'');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'d',name:'demo',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:true,lang:LANGV}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
// 素材：一个带两次提交的 git 仓库、一个代码文件、一张图、一个本地网页
import('node:child_process').then(()=>{})
const sh=(c)=>require_('node:child_process').execSync(c,{cwd,stdio:'ignore',env:{...process.env,GIT_AUTHOR_NAME:'demo',GIT_AUTHOR_EMAIL:'d@x',GIT_COMMITTER_NAME:'demo',GIT_COMMITTER_EMAIL:'d@x'}})
function require_(m){return globalThis.__req(m)}
fs.writeFileSync(path.join(cwd,'app.ts'),'export function hello(name: string): string {\n  return `hello ${name}`\n}\n')
fs.writeFileSync(path.join(cwd,'page.html'),'<!doctype html><html><body style="font:16px -apple-system;margin:20px">demo page</body></html>')
for(const d of ['src/core','src/ui','src/util'])fs.mkdirSync(path.join(cwd,d),{recursive:true})
fs.writeFileSync(path.join(cwd,'src/util/fmt.ts'),"export const fmt=(s: string)=>s.trim()\n")
fs.writeFileSync(path.join(cwd,'src/core/model.ts'),"import { fmt } from '../util/fmt'\nexport const model=(s: string)=>fmt(s)\n")
fs.writeFileSync(path.join(cwd,'src/ui/view.ts'),"import { model } from '../core/model'\nimport { fmt } from '../util/fmt'\nexport const view=()=>model(fmt(' x '))\n")
fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({name:'demo',version:'1.0.0'}))
const canvasFile=path.join(profile,'canvas.json')
sh('git init -q && git add -A && git commit -qm "init"')
fs.writeFileSync(path.join(canvasFile),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:0.62},frames:[{id:'f',projectId:'d',name:'demo',x:20,y:20,w:2900,h:1500,collapsed:false,nodes:[
 {id:'n1',x:20,y:50,w:900,h:620,component:{type:'codegraph'}},
 {id:'n2',x:940,y:50,w:900,h:620,component:{type:'team'}},
 {id:'n3',x:1860,y:50,w:900,h:620,component:{type:'plugin-panel',props:{pluginId:'missing.plugin',panelId:'main'}}},
 {id:'n6',x:1860,y:700,w:600,h:420,component:{type:'design'}}]}],shapes:[],freeNodes:[],todos:[]}))
import http from 'node:http'
const latestFile=path.join(temp,'latest.json')
const writeLatest=(notesEn)=>fs.writeFileSync(latestFile,JSON.stringify({version:'9.9.9',notes:['中文更新条目一','中文更新条目二'],notesEn,mac:{arm64:'http://127.0.0.1/x.dmg',x64:'http://127.0.0.1/x.dmg'},published:'2026-09-29T00:00:00Z'}))
writeLatest(['English note one','English note two'])
const srv=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(fs.readFileSync(latestFile))});await new Promise(r=>srv.listen(0,'127.0.0.1',r))
const env={...process.env,HOME:home,EAS_VERIFY:'1',EAS_UPDATE_URL:`http://127.0.0.1:${srv.address().port}/latest.json`};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const INSPECT=9501
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
 const facts={}
 await page.ev(`(()=>{const s=window.__store.getState();s.setViewMode('split');s.openChat(${JSON.stringify(cwd)});return true})()`);await wait(2000)
 await page.ev("(async()=>{const s=window.__store.getState();const tab=s.tabs.find(t=>t.id===s.activeTabId);await s.setPaneKind(tab.id,tab.activeLeafId,'dict');return true})()");await wait(3500)
 const tab=(re)=>page.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>${re}.test(b.textContent.trim()));if(b){b.click();return true}return false})()`)
 const narrow=(w,h)=>page.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:false})
 const overflow=()=>page.ev(`(()=>{const r=[];for(const el of document.querySelectorAll('.dict-view *, .bp-view *, .bp-pick *, .dsp-root *')){if(!el.children.length&&el.textContent.trim()&&el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).overflow!=='visible')r.push(el.className+': '+el.textContent.trim().slice(0,50))}return [...new Set(r)].slice(0,15)})()`)
 // ① 蓝图详情（宽 / 窄）
 await tab('/^(Blueprints|蓝图)$/');await wait(1500)
 await page.ev("document.querySelector('.bp-card')?.click();true");await wait(1800);await shot('01-bp-detail-wide')
 await narrow(900,820);await wait(1500);await shot('02-bp-detail-narrow');facts.bpNarrowClipped=await overflow()
 // ② 设计选型台窄窗口
 await tab('/^(Design picker|设计选型台)$/');await wait(3000);await shot('03-design-narrow');facts.designNarrowClipped=await overflow()
 await page.send('Emulation.clearDeviceMetricsOverride');await wait(1000)
 // ③ 悬停浮层的分类标签：是否被截成省略号
 await tab('/^(Terms|词条)$/');await wait(1500)
 await page.ev("(()=>{const t=[...document.querySelectorAll('.dict-pill')].find(x=>/Debounce|防抖/.test(x.textContent));t.scrollIntoView({block:'center'});t.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return true})()");await wait(1500)
 facts.popTag=await page.ev(`(()=>{const pop=document.querySelector('.dict-pop');if(!pop)return null;const out=[];for(const el of pop.querySelectorAll('*')){if(el.children.length||!el.textContent.trim())continue;if(el.scrollWidth>el.clientWidth+1)out.push({cls:el.className,text:el.textContent.trim(),title:el.getAttribute('title')||el.closest('[title]')?.getAttribute('title')||null})}return out})()`)
 await shot('04-hover')
 // ④ 点词条：插进对话框的 chip（截获最近输入框的 composerAddChip）
 await page.ev(`(()=>{window.__chip=null;window.__store.getState().setComposerAddChip((c)=>{window.__chip=c},${JSON.stringify(cwd)});return true})()`)
 await page.ev("(()=>{const t=[...document.querySelectorAll('.dict-pill')].find(x=>/Debounce|防抖/.test(x.textContent));t.click();return true})()");await wait(800)
 facts.chip=await page.ev("window.__chip&&{label:window.__chip.label,text:window.__chip.text.slice(0,160)}")
 // ⑤ 应用内更新提示：notesEn 有内容 / 为空
 const openNotes=async(name)=>{await page.ev("window.api.update.check().then(()=>true)");await wait(1200);await page.ev("document.querySelector('.upd-badge')?.click();true");await wait(1500);facts[name+'-box']=await page.ev("(()=>{const b=document.querySelector('.upd-box');if(!b)return null;const r=b.getBoundingClientRect();const o=document.querySelector('.cset-overlay');return {x:r.x,y:r.y,w:r.width,h:r.height,vis:getComputedStyle(b).visibility,op:getComputedStyle(o).opacity,z:getComputedStyle(o).zIndex}})()");await page.ev("document.getAnimations().forEach(a=>{try{a.finish()}catch{}});true");await wait(300);await shot(name);const n=await page.ev("[...document.querySelectorAll('.upd-notes li')].map(x=>x.textContent.trim())");await page.ev("document.querySelector('.cset-close')?.click();true");await wait(500);return n}
 facts.updateNotes=await openNotes('05-update-notes')
 writeLatest([]);facts.updateNotesFallback=await openNotes('06-update-notes-fallback')
 fs.writeFileSync(path.join(out,'facts.json'),JSON.stringify(facts,null,2));console.log(JSON.stringify(facts,null,1))
 fs.writeFileSync(path.join(out,'residue.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k,v])=>[k,Array.isArray(v)?`${v.length} 处`:v])),null,1))
}finally{for(const w of sockets)try{w.close()}catch{};app.kill('SIGTERM');await wait(1500);try{app.kill('SIGKILL')}catch{};srv.close();fs.rmSync(temp,{recursive:true,force:true})}
