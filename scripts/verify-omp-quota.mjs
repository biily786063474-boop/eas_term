// Real Electron rendering with synthetic quota snapshots. No credential copying or inference.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = path.resolve('docs/verification/omp-quota')
fs.mkdirSync(out, { recursive: true })
for (const scenario of ['models', 'unavailable']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-quota-'))
  const now = Date.now()
  const quota = scenario === 'models' ? { omp: { label: 'omp · google-gemini-cli', updatedAt: now, models: ['gemini-flash', 'gemini-pro'].map((modelId,i) => ({ modelId, percent: 10+i*20, at: now, src: 'omp', resetsAt: now/1000+3600 })) } } : { ompStatus: { provider: 'google-gemini-cli', state: 'unavailable', at: now } }
  fs.writeFileSync(path.join(dir, 'quota.json'), JSON.stringify(quota))
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify([{id:'p-quota',name:'Quota verification',path:process.cwd(),addedAt:1}]))
  const env = { ...process.env, EAS_VERIFY:'1' }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn('node_modules/.bin/electron', ['.', '--remote-debugging-port=9457', '--user-data-dir='+dir], {env,stdio:['ignore','ignore','pipe']})
  let stderr=''; child.stderr.on('data',b=>stderr+=b)
  let ws
  try {
    let target
    for(let i=0;i<80;i++) { try {target=(await (await fetch('http://127.0.0.1:9457/json/list')).json()).find(t=>t.type==='page' && t.url.includes('out/renderer') && !t.url.includes('island'));}catch{} if(target)break;await sleep(500) }
    assert.ok(target,stderr.slice(-1500))
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await once(ws,'open')
    let id=0;const pending=new Map()
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}})
    const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
    const ev=async expression=>{const m=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!m.result?.exceptionDetails,JSON.stringify(m.result));return m.result?.result?.value}
    await sleep(2500)
    await ev("window.__store.getState().setViewMode('canvas'); localStorage.setItem('eas.quotaBar.on','1'); window.dispatchEvent(new CustomEvent('eas:quotaBar'))")
    await sleep(600)
    const text=await ev("document.querySelector('.qb')?.textContent")
    assert.ok(text, 'quota bar rendered')
    if(scenario==='models') {assert.match(text,/gemini-pro 30%/);assert.match(text,/gemini-flash 10%/); const tip=await ev("document.querySelector('.qb-models .qb-pct')?.getAttribute('data-tip')");assert.match(tip,/剩余 90%/);assert.match(tip,/后刷新/)}
    else {assert.match(text,/暂未获取额度/);assert.ok(!text.includes('0%'))}
    const bounds = await ev("JSON.stringify((document.querySelector('.qb-models .qb-pct') ?? document.querySelector('.qb-cli:last-child .qb-pct')).getBoundingClientRect().toJSON())")
    const rect = JSON.parse(bounds)
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:rect.x+rect.width/2, y:rect.y+rect.height/2 })
    await sleep(600)
    const shot=await send('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(out,scenario+'.png'),Buffer.from(shot.result.data,'base64'))
    fs.writeFileSync(path.join(out,scenario+'.json'),JSON.stringify({scenario,text,passed:true},null,2))
    console.log('PASS',scenario,text)
  } finally {
    ws?.close();const exited=once(child,'exit');child.kill();await Promise.race([exited,sleep(5000)]);if(child.exitCode===null && child.signalCode===null) {child.kill('SIGKILL');await exited}fs.rmSync(dir,{recursive:true,force:true})
  }
}
