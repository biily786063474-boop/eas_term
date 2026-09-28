// Isolated synthetic ledgers + real renderer/preload/main IPC. No real user profile or paid CLI.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-usage-activity-'))
const profile=process.env.USAGE_REUSE_PROFILE||path.join(temp,'profile'),project=path.join(temp,'project'),output=path.join(root,'docs/verification/usage-activity')
for(const d of [profile,project,output])fs.mkdirSync(d,{recursive:true})
const now=Date.now(),mode=process.env.USAGE_FIXTURE||'seeded'
const at=(offset)=>{const d=new Date(now);return new Date(d.getFullYear(),d.getMonth(),d.getDate()+offset,12).getTime()}
const key=t=>{const d=new Date(t);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
const days=Array.from({length:70},(_,i)=>({date:key(at(-i)),counts:{term:i%3+1,chat:70-i,voice:i%4,image:i%2},plugins:[{id:'timeline',opens:1,calls:i%5},{id:'execution-plan',opens:0,calls:i%8}]})).filter((_,i)=>i%6!==0||i===0)
const rows=Array.from({length:170},(_,i)=>({id:'fixture-'+i,session:'s'+Math.floor(i/10),project,projectName:'隔离测试项目',cli:'codex',model:'fixture',startedAt:now-i*9*3600000-1000,endedAt:now-i*9*3600000,status:'completed',...(i%9?{meter:{input:5000+i*100,output:500}}:{})}))
if(!process.env.USAGE_REUSE_PROFILE){
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({telemetry:false,autoUpdateCheck:false,island:false}))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'usage-fixture',name:'用量统计 · 隔离验收',path:project}]))
fs.writeFileSync(path.join(profile,'usage-ledger.json'),JSON.stringify({version:1,since:now-75*86400000,rows:mode==='seeded'?rows:[]}))
if(mode==='seeded')fs.writeFileSync(path.join(profile,'usage-activity.json'),JSON.stringify({version:1,since:now-72*86400000,days}))
if(mode==='corrupt'){fs.writeFileSync(path.join(profile,'usage-activity.json'),'BROKEN_FIXTURE');fs.writeFileSync(path.join(profile,'usage-ledger.json'),'BROKEN_USAGE')}
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'usage-frame',projectId:'usage-fixture',name:'用量统计 · 隔离验收',x:20,y:20,w:800,h:700,collapsed:false,nodes:[]}],shapes:[],freeNodes:[],todos:[]}))
}
const port=Number(process.env.USAGE_VERIFY_PORT||9587),env={...process.env,EAS_VERIFY:'1'}
for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_'))delete env[k]
const log=fs.openSync(path.join(output,mode+'-app.log'),'w')
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port='+port,'--user-data-dir='+profile],{env,stdio:['ignore',log,log]})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 120; i++) { try { const value = await fn(); if (value) return value } catch {} await sleep(100) } throw Error('Timed out waiting for isolated app') }
let ws
try {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page' && x.url.includes('out/renderer')))
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const pending = new Map()
  ws.onmessage = event => { const message = JSON.parse(event.data); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); callback(message) } }
  const send = (method, params = {}) => new Promise(resolve => { const key = ++id; pending.set(key, resolve); ws.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value }

  await send('Page.bringToFront')
  await until(()=>evaluate("!!document.querySelector('.wk-edge-guide')"))
  await evaluate("document.querySelector('.wk-edge-guide').click()")
  await until(()=>evaluate("document.querySelectorAll('.ua-cell').length===90"))
  assert.equal(await evaluate("document.querySelector('.ua-tabs button[aria-pressed=true]').textContent"),'Token')
  const before=await evaluate('window.api.usage.activity()')
  assert.equal(before.days.length,90)
  if(process.env.USAGE_REUSE_PROFILE)assert.ok(before.features.find(f=>f.key==='canvas').count>=1,'real app restart retains counters')
  const capture=async name=>{await sleep(350);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,mode+'-'+name+'.png'),Buffer.from(r.result.data,'base64'))}
  await evaluate("document.querySelector('.ua-card').scrollIntoView({block:'start'})")
  await capture('token-dark')
  await evaluate("document.querySelectorAll('.ua-tabs button')[1].click();document.querySelector('.ua-cell:last-child').focus()")
  assert.equal(await evaluate("document.querySelector('.ua-tabs button[aria-pressed=true]').textContent"),'软件活跃')
  assert.match(await evaluate("document.querySelector('.ua-detail').textContent"),/操作|未记录/)
  await capture('activity-dark')
  await evaluate("window.__store.getState().setTheme('light')")
  await capture('activity-light')
  const overflow=await evaluate("(()=>{const p=document.querySelector('.ud-panel');return {w:p.clientWidth,sw:p.scrollWidth}})()")
  assert.ok(overflow.sw<=overflow.w+1,JSON.stringify(overflow))
  await evaluate("document.querySelector('.ua-behavior').scrollIntoView({block:'start'})")
  await capture('behavior-light')
  await evaluate("window.__store.getState().setTheme('dark')")
  if(mode!=='corrupt'){
    const oldCanvas=before.features.find(f=>f.key==='canvas').count
    await evaluate("window.__store.getState().addFileNode('usage-frame',{kind:'image',path:'/not-opened-fixture.png'},10,10);window.api.usage.activityEvent('secret-path');window.api.usage.activityEvent('chat')")
    const after=await evaluate('window.api.usage.activity()')
    assert.equal(after.features.find(f=>f.key==='canvas').count,oldCanvas+1,'real canvas action counted with telemetry disabled')
    assert.equal(after.features.find(f=>f.key==='chat').count,before.features.find(f=>f.key==='chat').count,'renderer may not forge chat starts')
    await sleep(1300)
    const persisted=JSON.parse(fs.readFileSync(path.join(profile,'usage-activity.json'),'utf8'))
    assert.equal(persisted.days.reduce((n,d)=>n+(d.counts.canvas||0),0),oldCanvas+1,'persisted increment')
    assert.ok(!JSON.stringify(persisted).includes('secret-path'))
    // Fresh page mount reads the same main-process persisted-backed state, not component counters.
    await send('Page.reload');await until(()=>evaluate("!!document.querySelector('.wk-edge-guide')"));await evaluate("document.querySelector('.wk-edge-guide').click()")
    await until(()=>evaluate("document.querySelectorAll('.ua-cell').length===90"))
    assert.equal((await evaluate('window.api.usage.activity()')).features.find(f=>f.key==='canvas').count,oldCanvas+1)
  }else{
    assert.ok(before.error.includes('活动读取失败'))
    assert.equal(before.sessions,null);assert.equal(before.projects,null)
    assert.ok(before.days.every(d=>d.rounds===null&&d.tokens===null&&d.actions===null))
    assert.match(await evaluate("document.querySelector('.ua-behavior').textContent"),/不可读取/)
    assert.equal(fs.readFileSync(path.join(profile,'usage-ledger.json'),'utf8'),'BROKEN_USAGE')
    assert.equal(fs.readFileSync(path.join(profile,'usage-activity.json'),'utf8'),'BROKEN_FIXTURE')
  }
  // Closing the drawer removes the component's polling trigger (shared 15s timer).
  await evaluate("document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))")
  await sleep(400)
  assert.equal(await evaluate("document.querySelector('.wiki-drawer')?.classList.contains('open')"),false)
  const result={passed:true,mode,restarted:!!process.env.USAGE_REUSE_PROFILE,defaultToken:true,calendarDays:90,noHorizontalOverflow:true,realAction:mode!=='corrupt',preservedCorruption:mode==='corrupt',profile}
  fs.writeFileSync(path.join(output,mode+'-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{ws?.close();app.kill('SIGTERM');await sleep(1000);if(app.exitCode===null)app.kill('SIGKILL');fs.closeSync(log)}
