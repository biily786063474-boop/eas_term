#!/usr/bin/env node
// Real Electron settings + IPC verification in an isolated profile. No model/paid generation calls.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'docs/verification/browser-wave/workflow')
fs.mkdirSync(output, { recursive: true })
const suppliedProfile=process.argv.indexOf('--profile')
const profile = suppliedProfile>=0?process.argv[suppliedProfile+1]:fs.mkdtempSync(path.join(os.tmpdir(), 'eas-builtin-ui-'))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
const supplied = process.argv.indexOf('--executable')
const executable = supplied >= 0 ? process.argv[supplied + 1] : path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const server=http.createServer((req,res)=>{if(req.url==='/login')res.setHeader('Set-Cookie','eas_fixture=accepted; Max-Age=3600; SameSite=Lax');res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><title>验收网站</title></head><body style="background:#aac1cd;padding:40px;font:24px sans-serif"><h1>本机收藏验收页面</h1><p id="login">'+(req.url==='/login'||req.headers.cookie?.includes('eas_fixture=accepted')?'已登录':'未登录')+'</p><a href="eas-favorites://save?folder=media&name=来自HTML&url=https%3A%2F%2Fexample.org">打开收藏表单</a></body></html>')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const site='http://127.0.0.1:'+server.address().port+(process.argv.includes('--reopen')?'/check':'/login')
fs.rmSync(path.join(profile,'DevToolsActivePort'),{force:true})
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


  await wait(1600) // allow persisted canvas hydration before creating this run's fixture
  await evaluate(`(()=>{const s=window.__store.getState();s.addProjectFrame(null,100,100);const f=window.__store.getState().canvas.frames.at(-1);s.addWebNode(f.id,${JSON.stringify(site)});window.fixture={frameId:f.id,nodeId:window.__store.getState().canvas.frames.at(-1).nodes.at(-1).id};s.setMaximizedNode(window.fixture)})()`)
  await wait(1200)
  await evaluate(`window.fixtureWebview=()=>document.querySelector('[data-node-id="'+window.fixture.nodeId+'"] webview')`)
  for(let i=0;i<80;i++){if(await evaluate(`(()=>{try{return !!window.fixtureWebview()?.getURL()?.startsWith('http://127.0.0.1')}catch{return false}})()`))break;await wait(100)}
  const guestEval=expr=>evaluate('window.fixtureWebview().executeJavaScript('+JSON.stringify(expr)+')')
  check(await guestEval("document.querySelector('#login')?.textContent==='已登录'"),'persistent browser login fixture '+(process.argv.includes('--reopen')?'survives full app restart':'created'))
  check(await guestEval("typeof window.api==='undefined' && typeof require==='undefined'"),'website guest has no privileged preload or Node access')
  if(!process.argv.includes('--reopen')){
    await evaluate("document.querySelector('[aria-label=收藏当前网站]').click()");await wait(150)
    const click=async(label)=>{await evaluate(`(()=>{const ds=document.querySelectorAll('[role=dialog]');const d=ds[ds.length-1];Array.from(d.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()})()`);await wait(120)}
    const fill=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(50)}
    check(await evaluate("document.querySelector('[aria-label=收藏网站] input').value==='验收网站'"),'bookmark form prefills page title')
    await click('＋ 新建文件夹');await fill('[aria-label=自定义文件夹] input','自定义验收');await click('★');await click('保存文件夹')
    check(await evaluate("document.querySelector('[aria-label=收藏网站] select').selectedOptions[0].textContent==='自定义验收'"),'create folder within bookmark auto-selects destination')
    await evaluate("document.querySelector('.favorite-check input').click()")
    await click('收藏');await wait(500)
    check(await evaluate("!document.querySelector('[aria-label=收藏网站]')"),'confirmed bookmark closes form')
    const favorite=await evaluate("window.api.browser.favorites().then(d=>d.sites.find(s=>s.name==='验收网站'))")
    check(!!favorite?.preview,'explicit opt-in captures current guest preview')
    const previewPath=path.join(profile,'browser-favorites',new URL(favorite.preview).pathname.slice(1))
    check(fs.existsSync(previewPath),'preview exists only in local app cache')
    await evaluate("document.querySelector('.favorite-notice button').click()");await wait(150)
    check(await evaluate("document.querySelector('.favorite-site h3').textContent.includes('验收网站')"),'success toast enters selected custom folder')
    for(let i=0;i<30;i++){if(await evaluate("document.querySelector('.favorite-preview img')?.naturalWidth>0"))break;await wait(100)}
    check(await evaluate("document.querySelector('.favorite-preview img').naturalWidth===640"),'saved local preview renders')
    let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'saved-preview.png'),Buffer.from(shot.data,'base64'))
    // Home/back must retain the same guest and login, not remount/reload it.
    const guestId=await evaluate('window.fixtureWebview().getWebContentsId()')
    await evaluate("document.querySelector('[data-tip=后退]').click()");await wait(100)
    await evaluate("document.querySelector('[data-tip=后退]').click()");await wait(100)
    check(await evaluate('window.fixtureWebview().getWebContentsId()')===guestId,'home/back preserves guest identity')
    await guestEval("document.querySelector('a').click()");await wait(250)
    for(let i=0;i<100;i++){if(await evaluate("document.querySelector('[aria-label=收藏网站] input')?.value==='来自HTML'"))break;await wait(100)}
    check(await evaluate("document.querySelector('[aria-label=收藏网站] input').value==='来自HTML'"),'local HTML deep link opens prefilled form without saving')
    await click('取消')
    const before=await evaluate('window.api.browser.favorites()')
    check(before.sites.filter(s=>s.name==='来自HTML').length===0,'cancelled deep link never silently saves')
    const storeFile=path.join(profile,'browser-favorites/favorites.json'),original=fs.readFileSync(storeFile)
    fs.writeFileSync(storeFile,'{broken')
    check(await evaluate('window.api.browser.favorites().then(()=>false,()=>true)'),'corrupt store errors instead of overwrite')
    check(fs.readFileSync(storeFile,'utf8')==='{broken','corrupt original preserved');fs.writeFileSync(storeFile,original)
    const outside=path.join(profile,'outside.json');fs.writeFileSync(outside,'untouched');fs.renameSync(storeFile,storeFile+'.bak');fs.symlinkSync(outside,storeFile)
    check(await evaluate('window.api.browser.favorites().then(()=>false,()=>true)'),'symlink cache file rejected');fs.unlinkSync(storeFile);fs.renameSync(storeFile+'.bak',storeFile)
    fs.renameSync(storeFile,storeFile+'.bak');fs.symlinkSync(path.join(profile,'nonexistent-external'),storeFile);check(await evaluate('window.api.browser.favorites().then(()=>false,()=>true)'),'dangling symlink rejected');fs.unlinkSync(storeFile);fs.renameSync(storeFile+'.bak',storeFile)
    await evaluate(`window.api.browser.change({type:'removePreview',id:${JSON.stringify(favorite.id)}})`)
    check(!fs.existsSync(previewPath),'remove preview cleans cached file')
    const fallback=await evaluate(`window.api.browser.change({type:'save',folderId:${JSON.stringify(favorite.folderId)},name:'捕获失败仍保存',url:'https://example.net/',capture:true,guestId:-1})`)
    check(!!fallback.warning&&fallback.data.sites.some(s=>s.name==='捕获失败仍保存'),'failed capture does not discard bookmark')
    const route=await evaluate('window.api.browser.routes()')
    await evaluate('window.fixtureWebview().loadURL('+JSON.stringify(pathToFileURL(route.htmlPath).href)+')');await wait(300)
    for(let i=0;i<100;i++){if(await guestEval("!!document.querySelector('#bookmark-form')"))break;await wait(100)}
    await guestEval(`(()=>{const f=document.querySelector('#bookmark-form');f.elements.name.value='离线HTML表单';f.elements.url.value='https://example.edu/';f.requestSubmit()})()`);await wait(250)
    for(let i=0;i<100;i++){if(await evaluate("document.querySelector('[aria-label=收藏网站] input')?.value==='离线HTML表单'"))break;await wait(100)}
    check(await evaluate("document.querySelector('[aria-label=收藏网站] input').value==='离线HTML表单'"),'generated standalone HTML form routes to real bookmark UI')
    await click('取消')
  }else{
    check(await evaluate("window.api.browser.favorites().then(d=>d.folders.some(f=>f.name==='自定义验收'))"),'custom folders survive full app restart')
  }
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
  if(suppliedProfile<0)await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:200})
  server.close()
}
