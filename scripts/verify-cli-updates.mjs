// 隔离 Electron + 实际 preload IPC + 鼠标开关；更新生命周期使用可执行 CLI fixture。
// 不更新全局 CLI，不复制认证/密钥，不发送真实模型请求。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const cwd = process.cwd(), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-updates-e2e-'))
const port = 9450
let child, ws, id = 0
const pending = new Map()
const delay = ms => new Promise(r => setTimeout(r, ms))
async function start() {
  child = spawn(path.join(cwd, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), ['.', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: ['ignore', 'ignore', 'ignore'] })
  let page
  for (let n = 0; n < 100; n++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.title === 'Eas-Term') } catch {}
    if (page) break
    await delay(150)
  }
  if (!page) throw Error('No isolated Eas-Term window')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id) } }
  for (let n = 0; n < 50; n++) { if (await evaluate('!!window.api?.cliUpdates && !!document.querySelector("[data-tip=设置]")')) return; await delay(100) }
  throw Error('Renderer not ready')
}
const rpc = (method, params = {}) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); ws.send(JSON.stringify({id:next, method, params})) })
async function evaluate(expression) {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || 'JS failed')
  return r.result.result.value
}
async function click(selector) {
  const b = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await rpc('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...b })
  await rpc('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...b })
  await delay(250)
}
async function stop() {
  ws?.close()
  if (child && child.exitCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await Promise.race([exited, delay(5000)]); if(child.exitCode===null) child.kill('SIGKILL') }
}
const out = path.join(cwd, 'docs/verification/agent-chat')
try {
  await start()
  const defaults = await evaluate('window.api.cliUpdates.get()')
  assert(defaults.every(r => !r.enabled && !r.pending))
  await click('[data-tip="设置"]')
  await evaluate(`document.querySelectorAll('.cset-tab').forEach(b=>{if(b.textContent==='更新')b.setAttribute('data-update-tab','true')})`)
  await click('[data-update-tab]')
  await delay(500)
  assert.equal(await evaluate('document.querySelectorAll(".cset-cli-toggle input").length'), 2)
  await click('input[aria-label="Codex 自动更新"]')
  assert.equal((await evaluate('window.api.cliUpdates.get()'))[0].enabled, true)
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'cli-versions/state.json'),'utf8')).codex.enabled,true)
  await click('input[aria-label="Codex 自动更新"]')
  assert.equal((await evaluate('window.api.cliUpdates.get()'))[0].enabled, false)
  const size = await evaluate(`(()=>{const r=document.querySelector('.cset-cli-toggle input').getBoundingClientRect();return {w:r.width,h:r.height,overflow:document.querySelector('.cset-pane').scrollWidth>document.querySelector('.cset-pane').clientWidth}})()`)
  assert.equal(size.w, 30); assert.equal(size.h, 18); assert.equal(size.overflow, false)
  const shot = await rpc('Page.captureScreenshot', {format:'png'})
  await fs.writeFile(path.join(out,'cli-update-settings.png'),Buffer.from(shot.result.data,'base64'))
  await stop()
  // 模拟下载完成：已校验的测试 CLI，仅写本测试 userData 的版本目录。
  const version = '99.0.1', root = path.join(dir,'cli-versions'), versionDir = path.join(root,'codex',version)
  await fs.mkdir(path.join(versionDir,'package/bin'),{recursive:true})
  await fs.writeFile(path.join(versionDir,'package/bin/codex'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$(dirname "$0")/calls.log"\ncase "$*" in\n*--version*) echo "codex-cli 99.0.1";;\n*--help*) echo "exec --json --sandbox --skip-git-repo-check";;\nesac\n', {mode:0o755})
  await fs.writeFile(path.join(versionDir,'entry.json'),JSON.stringify({bin:'package/bin/codex'}))
  await fs.writeFile(path.join(root,'state.json'),JSON.stringify({codex:{enabled:false,pending:version},claude:{enabled:false}}))
  await start()
  const reboot = await evaluate('window.api.cliUpdates.get()')
  assert.equal(reboot[0].current,version); assert.equal(reboot[0].pending,undefined); assert.equal(reboot[0].enabled,false)
  const saved = JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8'))
  assert.equal(saved.codex.active,version)
  await fs.writeFile(path.join(versionDir,'package/bin/calls.log'),'')
  await evaluate('window.api.agent.probe()')
  assert.match(await fs.readFile(path.join(versionDir,'package/bin/calls.log'),'utf8'), /--version/)
  await fs.writeFile(path.join(out,'cli-update-e2e.json'),JSON.stringify({defaults,togglePersistence:true,geometry:size,reboot,probeUsesManagedBinary:true,fixture:true},null,2)+'\n')
  console.log('PASS: default off, actual mouse switches + persisted IPC, 30×18 layout, restart promotes staged CLI fixture')
} finally { await stop(); await fs.rm(dir,{recursive:true,force:true}) }
