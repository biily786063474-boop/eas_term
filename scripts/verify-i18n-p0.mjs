// 英文适配 P0 验收（隔离实例）：切语言后应用菜单、设置语言项、<html lang> 即时切换；切回中文复原。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'; import assert from 'node:assert/strict'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-i18n-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'project')
const out=path.join(root,'docs/verification/i18n-p0');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false,lang:'zh'}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const INSPECT=9478
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0',`--inspect=${INSPECT}`,'--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))})
 return {ws,send,ev:async x=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}}}
const checks=[];const sockets=[]
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const page=await connect((await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page'&&x.title==='Eas-Term')}catch{return null}})).webSocketDebuggerUrl);sockets.push(page.ws)
 const main=await connect((await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json())[0]}catch{return null}})).webSocketDebuggerUrl);sockets.push(main.ws)
 await until(()=>page.ev('!!window.__store'))
 for(let i=0;i<30;i++){if(await page.ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'))||document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 const electron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
 const menu=()=>main.ev(`${electron}.Menu.getApplicationMenu().items.map(i=>[i.label,i.submenu?i.submenu.items.filter(x=>x.type!=='separator').map(x=>x.label):[]])`)
 const state=async()=>({menu:await menu(),htmlLang:await page.ev('document.documentElement.lang'),apiLang:await page.ev('window.api.i18n.lang')})
 // ① 起点：中文
 const zh1=await state()
 assert.equal(zh1.htmlLang,'zh-CN');assert.deepEqual(zh1.menu.slice(1).map(m=>m[0]),['编辑','视图','窗口'])
 assert.ok(zh1.menu[0][1].includes('关于 Eas-Term'))
 checks.push('中文起点：菜单为 编辑/视图/窗口，<html lang>=zh-CN')
 // ② 切英文（走设置同一条 IPC）
 await page.ev("window.api.prefs.set('lang','en')");await wait(800)
 const en1=await state()
 assert.equal(en1.htmlLang,'en-US','渲染层收到切换');assert.deepEqual(en1.menu.slice(1).map(m=>m[0]),['Edit','View','Window'])
 assert.ok(en1.menu[0][1].includes('About Eas-Term')&&en1.menu[0][1].includes('Quit Eas-Term'))
 assert.ok(en1.menu.flatMap(m=>[m[0],...m[1]]).every(l=>!/[一-鿿]/.test(l||'')),'英文菜单无中文')
 checks.push('切到 English：应用菜单即时重建为英文且无残留中文，<html lang>=en-US')
 // ③ 设置面板的语言下拉跟着变
 await page.ev("window.__store.getState().setSettingsOpen?.(true);true").catch(()=>{})
 const opened=await page.ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>/设置|Settings/.test(b.textContent||''));if(b){b.click();return true}return false})()")
 await wait(800)
 const sel=await page.ev("(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='system'));return s?{value:s.value,opts:[...s.options].map(o=>o.textContent)}:null})()")
 if(sel){assert.equal(sel.value,'en');assert.deepEqual(sel.opts,['Follow System','中文','English']);checks.push('设置里的语言下拉显示 English 选中，选项为 Follow System / 中文 / English')
  const r=await page.ev("(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='system'));const b=s.closest('.cset-card')?.getBoundingClientRect();return b?{x:b.x,y:b.y,width:b.width,height:b.height}:null})()")
  if(r){const shot=await page.send('Page.captureScreenshot',{format:'png',clip:{x:Math.max(0,r.x-20),y:Math.max(0,r.y-60),width:r.width+40,height:r.height+80,scale:1}});fs.writeFileSync(path.join(out,'settings-language-en.png'),Buffer.from(shot.result.data,'base64'))}}
 else checks.push(`设置面板未能用脚本打开（opened=${opened}），语言下拉未验`)
 // ④ 切回中文复原
 await page.ev("window.api.prefs.set('lang','zh')");await wait(800)
 const zh2=await state()
 assert.deepEqual(zh2.menu,zh1.menu,'切回中文后菜单与起点完全一致');assert.equal(zh2.htmlLang,'zh-CN')
 checks.push('切回中文：菜单与起点逐项一致')
 const r={passed:true,checks};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2))
}finally{for(const w of sockets)try{w.close()}catch{};app.kill('SIGTERM');await wait(1500);try{app.kill('SIGKILL')}catch{};fs.rmSync(temp,{recursive:true,force:true})}
