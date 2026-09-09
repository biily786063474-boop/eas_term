#!/usr/bin/env node
// Real Electron settings + IPC verification in an isolated profile. No model/paid generation calls.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'docs/verification/browser-wave/acceptance')
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


  await wait(1600)
  await evaluate(`(async()=>{const s=window.__store.getState();await s.addProjectFrame(null,100,100);const f=window.__store.getState().canvas.frames.at(-1);s.renameFrame(f.id,'开发验收 · 收藏与模块动效');s.addWebNode(f.id,${JSON.stringify(site)});const node=window.__store.getState().canvas.frames.find(x=>x.id===f.id).nodes.at(-1);window.fixture={frameId:f.id,nodeId:node.id};s.renameNode(f.id,node.id,'浏览器收藏 · 开发实例');s.addComponentNode(f.id,'git',30,60,350,250);await s.addAgentNode(f.id);s.setMaximizedNode(window.fixture)})()`)
  await wait(1200)
  await evaluate(`window.fixtureWebview=()=>document.querySelector('[data-node-id="'+window.fixture.nodeId+'"] webview')`)
  for(let i=0;i<80;i++){if(await evaluate(`(()=>{try{return !!window.fixtureWebview()?.getURL()?.startsWith('http://127.0.0.1')}catch{return false}})()`))break;await wait(100)}
  await evaluate(`(async()=>{const r=await window.api.browser.change({type:'folder',name:'验收示例',sticker:'★'});await window.api.browser.change({type:'save',folderId:r.data.folders.at(-1).id,name:'本机预览示例',url:${JSON.stringify(site)},capture:true,guestId:window.fixtureWebview().getWebContentsId()})})()`)
  await evaluate(`document.querySelector('[data-node-id="'+window.fixture.nodeId+'"] [aria-label="收藏夹首页"]').click()`);await wait(200)
  await evaluate("document.title='Eas-Term · 浏览器验收开发实例'")
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'acceptance.png'),Buffer.from(shot.data,'base64'))
  fs.writeFileSync(path.join(output,'instance.json'),JSON.stringify({pid:app.pid,profile,debugPort:port,site,branch:'feat/browser-favorites',built:true},null,2))
  console.log('ACCEPTANCE_READY '+JSON.stringify({pid:app.pid,profile,debugPort:port,output}))
  // The user owns the acceptance window now. Do not close it at the end of the turn.
  await new Promise(resolve=>app.once('exit',resolve))

} finally {
  ws?.close()
  app.kill('SIGTERM')
  await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(2000)])
  if(app.exitCode===null && app.signalCode===null) app.kill('SIGKILL')
  fs.writeFileSync(path.join(output,'app.log'),logs)
  // Preserve the acceptance profile, including any user-created test bookmarks.
  server.close()
}
