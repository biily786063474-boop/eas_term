#!/usr/bin/env node
// Real Electron settings + IPC verification in an isolated profile. No model/paid generation calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'docs/verification/badge-edge')
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

  await evaluate("window.__store.getState().addProjectFrame(null, 100, 100)")
  await evaluate("(() => { const s=window.__store.getState(); s.addComponentNode(s.canvas.frames[0].id, 'git', 30, 60, 350, 250); })()")
  for (let i=0;i<100;i++) { if(await evaluate("!!document.querySelector('.cfile-badge')")) break; await wait(100) }
  const dom = await send('DOM.getDocument')
  const target = await send('DOM.querySelector', {nodeId:dom.root.nodeId,selector:'.cfile-node'})
  await send('DOM.enable')
  await send('CSS.enable')
  for (const theme of ['dark','light']) {
    await send('CSS.forcePseudoState', {nodeId:target.nodeId,forcedPseudoClasses:[]})
    await evaluate("document.documentElement.dataset.theme = " + JSON.stringify(theme))
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:10, y:10 })
    await wait(300)
    const rect = await evaluate("(() => { const r=document.querySelector('.cfile-badge').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1} })()")
    check(rect.width > 0 && rect.x > 0, 'Real canvas module badge is visible: '+theme)
    const before = await send('Page.captureScreenshot', { format:'png', clip:rect })
    fs.writeFileSync(path.join(output, theme+'-before.png'), Buffer.from(before.data,'base64'))
    const node = await evaluate("(() => { const r=document.querySelector('.cfile-node').getBoundingClientRect(); return {x:r.x+80,y:r.y+40} })()")
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', ...node})
    await send('CSS.forcePseudoState', {nodeId:target.nodeId,forcedPseudoClasses:['hover']})
    await wait(250)
    await evaluate("document.getAnimations().filter(a=>a.animationName==='cfile-badge-smoke').forEach(a=>{a.pause();a.currentTime=300})")
    const style = await evaluate("(() => { const s=getComputedStyle(document.querySelector('.cfile-badge'),'::after');return {mask:s.maskComposite,opacity:s.opacity,transform:s.transform,padding:s.padding} })()")
    console.log('STYLE', theme, style)
    check(style.mask.split(',').every(value => value.trim() === 'exclude') && Number(style.opacity)>0 && style.transform==='none', 'Hover is a visible fixed hollow ring: '+theme)
    const afterRect = await evaluate("(() => { const r=document.querySelector('.cfile-badge').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1} })()")
    const shot = await send('Page.captureScreenshot', { format:'png', clip:afterRect })
    fs.writeFileSync(path.join(output, theme+'-hover.png'), Buffer.from(shot.data,'base64'))
    const full = await send('Page.captureScreenshot', {format:'png'})
    fs.writeFileSync(path.join(output, theme+'-canvas.png'),Buffer.from(full.data,'base64'))
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,passed:true},null,2))
  console.log(JSON.stringify({checks,passed:true,output}))
} finally {
  ws?.close()
  app.kill('SIGTERM')
  await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(2000)])
  if(app.exitCode===null && app.signalCode===null) app.kill('SIGKILL')
  fs.writeFileSync(path.join(output,'app.log'),logs)
  fs.rmSync(profile,{recursive:true,force:true})
}
