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
  : path.join(root, 'docs/verification/browser-wave/dict-hover')
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


  await evaluate("window.__store.getState().addProjectFrame(null,100,100)");
  await evaluate("window.__store.getState().setDictOpen(true)");
  for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('.dict-seg')"))break;await wait(100)}
  await evaluate("document.querySelectorAll('.dict-seg button')[1].click()");await wait(200);
  await evaluate("document.querySelector('.bp-card').click()");await wait(100);
  await evaluate("document.querySelector('.bp-slot-hd').click()");await wait(100);
  const pos=await evaluate("(()=>{let r=document.querySelector('.dict-pill').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});await wait(200);
  check(await evaluate("!!document.querySelector('.dict-pop')"),'real app blueprint hover opens');
  let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'hover.png'),Buffer.from(shot.data,'base64'));
  const blank=await evaluate("(()=>{let r=document.querySelector('.bp-view').getBoundingClientRect();return{x:r.right-20,y:r.bottom-20}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...blank});await wait(100);
  check(await evaluate("!document.querySelector('.dict-pop')"),'leave term within same blueprint closes preview');
  shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'leave.png'),Buffer.from(shot.data,'base64'));
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
