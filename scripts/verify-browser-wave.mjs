#!/usr/bin/env node
// Real Electron settings + IPC verification in an isolated profile. No model/paid generation calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'docs/verification/browser-wave/browser')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-builtin-ui-'))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
const supplied = process.argv.indexOf('--executable')
const executable = supplied >= 0 ? process.argv[supplied + 1] : path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const launchArgs = [...(supplied < 0 ? [root] : []), '--remote-debugging-port=0', ...(process.platform === 'darwin' ? ['--no-sandbox'] : []), '--user-data-dir=' + profile]
const env = { ...process.env, EAS_VERIFY: '1' }
for (const name of Object.keys(env)) if (name.startsWith('EAS_TERM_') || name.startsWith('EAS_CAPABILITY_')) delete env[name]
// Guard against legacy startup hooks writing real user instructions/config during validation.
const protectedRoots = ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map(name => path.join(os.homedir(), name))
const policy = '(version 1) (allow default) ' + protectedRoots.map(target => '(deny file-read* file-write* (subpath ' + JSON.stringify(target) + '))').join(' ')
const app = process.platform === 'darwin'
  ? spawn('/usr/bin/sandbox-exec', ['-p', policy, executable, ...launchArgs], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(executable, launchArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
app.stdout.on('data', chunk => { logs += chunk })
app.stderr.on('data', chunk => { logs += chunk })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let ws
const checks = []
const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message) }
try {
  let port
  for (let attempt = 0; attempt < 150; attempt++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port) break } catch {}
    if (app.exitCode !== null) throw new Error('App exited before debugger: ' + logs.slice(-1200))
    await wait(100)
  }
  if (!port) throw new Error('No debugger endpoint')
  let page
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    page = targets.find(item => item.type === 'page' && !item.url.includes('island'))
    if (page) break
    await wait(100)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', event => { const data = JSON.parse(event.data); const call = pending.get(data.id); if (call) { pending.delete(data.id); clearTimeout(call.timer); data.error ? call.reject(new Error(JSON.stringify(data.error))) : call.resolve(data.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value }
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate('!!window.__store && !!window.api?.capabilities')) break; await wait(100) }


  await evaluate(`(()=>{const s=window.__store.getState();s.addProjectFrame(null,100,100);const f=window.__store.getState().canvas.frames.at(-1);s.addWebNode(f.id,'eas-favorites://home');window.fixture={frameId:f.id,nodeId:window.__store.getState().canvas.frames.at(-1).nodes.at(-1).id};s.setMaximizedNode(window.fixture)})()`)
  await wait(900)
  check(await evaluate("document.querySelectorAll('.favorite-folder').length===5"),'five default folders rendered')
  let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'folders.png'),Buffer.from(shot.data,'base64'))
  await evaluate("Array.from(document.querySelectorAll('.favorites-nav button')).find(b=>b.textContent.includes('自媒体')).click()")
  await wait(300)
  check(await evaluate("document.querySelector('.favorite-site').getBoundingClientRect().width>=330"),'large horizontal cards')
  check(await evaluate("!!document.querySelector('.favorite-more')"),'overflow hint exists only with more content')
  shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'cards.png'),Buffer.from(shot.data,'base64'))
  await evaluate("document.querySelector('.favorite-row').scrollLeft=99999");await wait(150)
  check(await evaluate("!document.querySelector('.favorite-more')"),'hint disappears at end')
  await evaluate("document.querySelector('.favorite-row').scrollLeft=0")
  const saved=await evaluate(`(async()=>{const r=await window.api.browser.change({type:'folder',name:'验收收藏',sticker:'★'});const f=r.data.folders.at(-1);await window.api.browser.change({type:'save',folderId:f.id,name:'验收页面',url:'https://example.com/'});return f.id})()`)
  check(await evaluate(`(async()=>{const d=await window.api.browser.favorites();return d.sites.some(s=>s.folderId===${JSON.stringify(saved)}&&s.name==='验收页面')})()`),'favorite persists through IPC read')
  const route=await evaluate('window.api.browser.routes()');check(fs.existsSync(route.htmlPath),'packaged route HTML exists')
  check(route.catalog.sites.some(s=>s.id==='xiaohongshu'&&s.url==='https://creator.xiaohongshu.com/'),'agent route maps Xiaohongshu creator')
  const pointer=await evaluate("(()=>{const r=document.querySelector('.favorite-site-open').getBoundingClientRect();return{x:r.x+250,y:r.y+50}})()")
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pointer})
  for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:pointer.x-i*22,y:pointer.y})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:pointer.x-176,y:pointer.y});await wait(100)
  check(await evaluate("document.querySelector('.favorite-row').scrollLeft>100 && !!document.querySelector('.favorites-content')"),'dragging a card scrolls without opening website')
  const leftBefore=await evaluate("document.querySelector('.favorite-row').scrollLeft")
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:pointer.x,y:pointer.y,deltaX:0,deltaY:80});await wait(120)
  check(await evaluate("document.querySelector('.favorite-row').scrollLeft")>leftBefore,'mouse wheel scrolls the horizontal row')
  if(process.argv.includes('--stress')){
    await evaluate(`(()=>{const s=window.__store.getState();for(let i=0;i<5;i++){s.addProjectFrame('verify-stress-'+i,1500+i*1000,100);const f=window.__store.getState().canvas.frames.at(-1);for(let j=0;j<4;j++)s.addWebNode(f.id,'eas-favorites://home')}s.focusCanvasNode(window.fixture.frameId,window.fixture.nodeId);s.setMaximizedNode(window.fixture)})()`);await wait(800)
  }
  await evaluate(`(()=>{const s=window.__store.getState();s.addWebNode(window.fixture.frameId,'eas-favorites://home');s.focusCanvasNode(window.fixture.frameId,window.fixture.nodeId);s.setMaximizedNode(window.fixture)})()`);await wait(700)
  const hiddenGeometry=await evaluate(`Array.from(document.querySelectorAll('.cfile-node')).map(el=>({id:el.dataset.nodeId,width:el.getBoundingClientRect().width,display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility}))`)
  fs.writeFileSync(path.join(output,'hidden-geometry.json'),JSON.stringify(hiddenGeometry,null,2))
  check(hiddenGeometry.some(n=>n.visibility==='hidden'&&n.width>0),'maximized siblings retain nonzero geometry')
  if(process.argv.includes('--no-blur'))await evaluate(`(()=>{let st=document.createElement('style');st.textContent='.cframe{backdrop-filter:none!important}';document.head.append(st)})()`)
  // Timing evidence: same fixtures, real rAF and CDP Performance metrics before/after restore.
  await send('Performance.enable')
  const trace=[]
  let traceResolve;const traceDone=new Promise(resolve=>traceResolve=resolve)
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.method==='Tracing.dataCollected')trace.push(...d.params.value);if(d.method==='Tracing.tracingComplete')traceResolve()})
  await send('Tracing.start',{categories:'devtools.timeline,blink,cc,gpu',transferMode:'ReportEvents'})
  const perf=[]
  for(let run=0;run<5;run++){
    await evaluate('window.__store.getState().setMaximizedNode(window.fixture)');await wait(600)
    const before=await send('Performance.getMetrics')
    const frames=await evaluate(`new Promise(resolve=>{let last=performance.now(),start=last,gaps=[];function tick(t){gaps.push(t-last);last=t;if(t-start<800)requestAnimationFrame(tick);else resolve(gaps)}requestAnimationFrame(tick);window.__store.getState().setMaximizedNode(null)})`)
    const after=await send('Performance.getMetrics')
    perf.push({gaps:frames,max:Math.max(...frames),metrics:after.metrics.filter(m=>['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','TaskDuration'].includes(m.name)).map(m=>({name:m.name,value:m.value-(before.metrics.find(b=>b.name===m.name)?.value||0)}))})
  }
  await send('Tracing.end');await traceDone;fs.writeFileSync(path.join(output,'trace.json'),JSON.stringify({traceEvents:trace}))
  fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(perf,null,2))
  await evaluate('window.__store.getState().setMaximizedNode(window.fixture)');await wait(600)
  const mixed=await evaluate(`(async()=>{const s=window.__store.getState(),fid=window.fixture.frameId;s.addComponentNode(fid,'git',30,60,350,250);const component=window.__store.getState().canvas.frames.find(f=>f.id===fid).nodes.at(-1);const free=s.addFreeFileNode({kind:'web',url:'eas-favorites://home'},300,400);const agent=await s.addAgentNode(fid);const a=window.__store.getState().canvas.frames.find(f=>f.id===fid).nodes.find(n=>n.leafId===agent);return [{...window.fixture,selector:'[data-node-id="'+window.fixture.nodeId+'"]'},{frameId:fid,nodeId:component.id,selector:'[data-node-id="'+component.id+'"]'},{nodeId:free,selector:'[data-node-id="'+free+'"]'},{frameId:fid,nodeId:a.id,selector:'[data-leaf-id="'+a.leafId+'"]'}]})()`)
  await wait(600)
  await evaluate(`window.ownedElements=${JSON.stringify(mixed)}.map(m=>document.querySelector(m.selector));true`)
  const memory=[]
  for(let round=0;round<5;round++){
    for(const m of mixed){
      await evaluate(`window.__store.getState().setMaximizedNode(${JSON.stringify(m)})`);await wait(400)
      check(await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(m.selector)});return !!el&&getComputedStyle(el).visibility==='visible'&&el.getBoundingClientRect().width>800})()`),'maximized module visible '+m.nodeId+' round '+round)
      await evaluate('window.__store.getState().setMaximizedNode(null)');await wait(420)
    }
    await send('HeapProfiler.collectGarbage');memory.push((await send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value)
  }
  check(await evaluate(`window.ownedElements.every((el,i)=>el===document.querySelector(${JSON.stringify(mixed)}[i].selector))`),'20 mixed-module transitions preserve DOM identities')
  fs.writeFileSync(path.join(output,'mixed-memory.json'),JSON.stringify(memory))
  const zoomChecks=[]
  const pane=mixed.at(-1)
  for(const scale of [.5,1.5]){
    await evaluate(`(()=>{const s=window.__store.getState();s.setMaximizedNode(null);s.setViewport({scale:${scale}});s.focusCanvasNode(${JSON.stringify(pane.frameId)},${JSON.stringify(pane.nodeId)})})()`);await wait(350)
    await evaluate(`window.__store.getState().setMaximizedNode(${JSON.stringify(pane)})`);await wait(400)
    await evaluate('window.__store.getState().setMaximizedNode(null)');await wait(45)
    const pair=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(pane.selector)}),a=el.getAnimations()[0];if(!a)return {missing:true};a.pause();a.currentTime=Number(a.effect.getTiming().duration)-.01;const before=el.getBoundingClientRect();const value={before:{x:before.x,y:before.y,w:before.width,h:before.height}};a.finish();const after=el.getBoundingClientRect();value.after={x:after.x,y:after.y,w:after.width,h:after.height};return value})()`)
    check(!pair.missing&&['x','y','w','h'].every(k=>Math.abs(pair.before[k]-pair.after[k])<2),'PaneView restore endpoint matches canvas scale '+scale)
    zoomChecks.push({scale,...pair});await wait(350)
  }
  fs.writeFileSync(path.join(output,'zoom-endpoints.json'),JSON.stringify(zoomChecks,null,2))
  await evaluate('window.__store.getState().setViewport({scale:1});window.__store.getState().setMaximizedNode(window.fixture)');await wait(400)
  await evaluate("window.__store.getState().setTheme('light')");await wait(150)
  shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'light.png'),Buffer.from(shot.data,'base64'))
  await evaluate("window.__store.getState().setTheme('dark')")
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  check(await evaluate("Array.from(document.querySelectorAll('.favorite-particles b')).every(e=>getComputedStyle(e).animationName==='none')"),'reduced motion disables particles')
  await evaluate('window.__store.getState().setMaximizedNode(null)');await wait(40)
  check(await evaluate(`document.querySelector('[data-node-id="'+window.fixture.nodeId+'"]').getAnimations().length===0`),'reduced motion skips module transition')
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,passed:true},null,2))
  console.log(JSON.stringify({checks,passed:true,output}))
} finally {
  ws?.close()
  if(process.platform==='win32' && app.exitCode===null && app.signalCode===null) {
    try { execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore',timeout:10000,windowsHide:true}) } catch {}
  } else app.kill('SIGTERM')
  await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(2000)])
  if(app.exitCode===null && app.signalCode===null) app.kill('SIGKILL')
  fs.writeFileSync(path.join(output,'app.log'),logs)
  await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:200})
}
