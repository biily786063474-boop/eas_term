// 隔离实例：cd 开头的后台命令不算「对话仍在继续」。
// 从主进程向一个 AI 对话模块回放 Claude 的公共事件（不启动真实 CLI、不花模型），看界面状态。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'; import assert from 'node:assert/strict'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-bgcd-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'project')
const out=path.join(root,'docs/verification/bg-task-cd');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--inspect=9468','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))})
 return {ws,send,ev:async x=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}}}
const checks=[];const step=m=>console.error('[step]',m)
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 step('port '+port)
 const page=await connect((await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page'&&x.title==='Eas-Term')}catch{return null}})).webSocketDebuggerUrl)
 step('page connected')
 const main=await connect((await until(async()=>{try{return (await(await fetch('http://127.0.0.1:9468/json/list')).json())[0]}catch{return null}})).webSocketDebuggerUrl)
 step('main connected')
 await until(()=>page.ev('!!window.__store'))
 step('store ready')
 for(let i=0;i<30;i++){if(await page.ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'))||document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 const sid='ac-bgcd-'+Date.now()
 const tab={id:'tab-0',title:'对话',projectId:'p-test',cwd,activeLeafId:'leaf-0',root:{type:'leaf',id:'leaf-0',pane:{kind:'agent',cli:'claude',resumeCli:'claude',sessionId:sid,cwd}}}
 await page.ev(`(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',projects:[{id:'p-test',name:'cd 后台验收',path:${JSON.stringify(cwd)},addedAt:1}],tabs:[${JSON.stringify(tab)}],activeTabId:'tab-0',canvas:{...s.canvas,viewport:{x:0,y:0,scale:1},frames:[{id:'f',projectId:'p-test',name:'cd 后台验收',x:0,y:0,w:1000,h:720,nodes:[{id:'n0',leafId:'leaf-0',name:'AI 模块',x:20,y:50,w:900,h:620}]}]}});return true})()`)
 await wait(2000);step('seeded')
 const electron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
 const emit=e=>main.ev(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('agentChat:event',${JSON.stringify({sessionId:sid,event:e})})`)
 const ui=()=>page.ev(`(()=>{const s=window.__store.getState();return {bgHint:document.querySelector('.ac-bg-hint')?.textContent?.trim()||'',running:s.runningPtys.includes(${JSON.stringify(sid)}),attention:s.attentionPtys.includes(${JSON.stringify(sid)})}})()`)
 const devTask={id:'b1',label:'cd /Users/me/proj && npm run dev',kind:'local_bash'}
 const realTask={id:'b2',label:'sleep 25; echo BGDONE',kind:'local_bash'}
 // ① 只有 cd 类后台：本轮结束就该是完成
 await emit({k:'turn.start'});await emit({k:'background.tasks',tasks:[devTask]});await emit({k:'text.done',text:'开发服务器已在后台启动。'});await emit({k:'turn.done',usage:{inputTokens:1,outputTokens:1}})
 step('emitted 1');await wait(1200);const a=await ui();step(JSON.stringify(a))
 assert.equal(a.bgHint,'','cd 类后台不显示「后台任务运行中」');assert.equal(a.running,false,'不再算运行中');assert.equal(a.attention,true,'本轮结束应标完成')
 fs.writeFileSync(path.join(out,'1-cd-only-done.png'),Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'))
 checks.push('只有 cd 开头的后台命令时：本轮结束即标完成，不显示「后台任务运行中」，全局状态不是运行中')
 // ② cd 类 + 普通后台：仍按普通那条算运行中，提示里只列普通那条
 await page.ev(`window.__store.getState().clearAttention?.(${JSON.stringify(sid)});true`)
 await emit({k:'turn.start'});await emit({k:'background.tasks',tasks:[devTask,realTask]});await emit({k:'text.done',text:'测试也在后台跑了。'});await emit({k:'turn.done',usage:{inputTokens:1,outputTokens:1}})
 await wait(1200);const b=await ui()
 assert.ok(b.bgHint.includes('sleep 25'),'普通后台任务仍提示：'+b.bgHint);assert.ok(!b.bgHint.includes('npm run dev'),'提示里不列 cd 那条');assert.equal(b.running,true,'普通后台还在跑 → 运行中')
 fs.writeFileSync(path.join(out,'2-real-bg-running.png'),Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'))
 checks.push('cd 类与普通后台并存时：仍按普通那条显示「后台任务运行中」并保持运行中，提示里不列 cd 那条')
 const r={passed:true,checks,realApp:true,realCli:false,note:'事件按 Claude Code 2.1.283 background_tasks_changed 的翻译结果回放'}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2))
}finally{app.kill('SIGTERM');await wait(1500);fs.rmSync(temp,{recursive:true,force:true})}
