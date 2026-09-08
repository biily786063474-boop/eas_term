// Real Electron runtime. Inspector substitutes native responses, not diagnostic logic.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
const executable = process.argv[2]
if (!executable) throw new Error('executable required; --dev for an Electron runtime')
const out = resolve('docs/verification/windows-diagnostic/runtime')
fs.mkdirSync(out, { recursive: true })
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'eas-diagnostic-')))
const data = join(root, 'data'); fs.mkdirSync(data)
const ports = { main: 19431, renderer: 19432 }
let proc, main, renderer, stderr = ''
const evidence = { checks: [], platform: process.platform }
async function connect(port, filter) {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
      const target = list.find(filter)
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
        let id = 0; const pending = new Map(); const pauses = []
        ws.addEventListener('message', msg => { const d = JSON.parse(msg.data); if (d.method === 'Debugger.paused') pauses.push(d.params); pending.get(d.id)?.(d) })
        const call = (method, params) => new Promise((res, rej) => {
          if (method === 'Runtime.evaluate') console.log('EVAL', port, params.expression.slice(0, 160))
          const n = ++id; const timer = setTimeout(() => { pending.delete(n); rej(new Error('CDP timeout port=' + port + ' ' + method + ' ' + (params?.expression ?? '').slice(0,160))) }, 15000)
          pending.set(n, d => { clearTimeout(timer); pending.delete(n); res(d) }); ws.send(JSON.stringify({ id: n, method, params }))
        })
        return { ws, call, pauses, ev: async expression => { const d = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description ?? 'evaluate failed'); return d.result?.result?.value } }
      }
    } catch { /* starting */ }
    await sleep(250)
  }
  throw new Error('Inspector unavailable: ' + port + '\n' + stderr.slice(-2000))
}
async function launch(unclean = false) {
  const args = [...(process.argv.includes('--dev') ? ['.'] : []), '--inspect-brk=' + ports.main, '--remote-debugging-port=' + ports.renderer, '--user-data-dir=' + data, '--no-sandbox']
  proc = spawn(executable, args, { env: { ...process.env, EAS_VERIFY: '1', EAS_SMOKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-50000) })
  main = await connect(ports.main, () => true)
  await main.call('Runtime.enable')
  await main.call('Debugger.enable')
  // Do not evaluate in Electron's bootstrap realm: Windows can block before Node globals exist.
  // Pause in our actual CommonJS entry, whose local require is initialized.
  const breakpoint = await main.call('Debugger.setBreakpointByUrl', { urlRegex: 'out/main/index\\.js$', lineNumber: 0 })
  const breakpointId = breakpoint.result.breakpointId
  await main.call('Runtime.runIfWaitingForDebugger')
  let injected = false
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const pause = main.pauses.shift()
    if (!pause) { await sleep(50); continue }
    if (pause.hitBreakpoints?.includes(breakpointId)) {
      const patch = await main.call('Debugger.evaluateOnCallFrame', {
        callFrameId: pause.callFrames[0].callFrameId,
        expression: "globalThis.__diagPrompts = []; globalThis.__diagAnswer = 0; globalThis.__electron = require('electron'); __electron.dialog.showMessageBox = async (...args) => { __diagPrompts.push(args.at(-1)); return { response: __diagAnswer, checkboxChecked: false } }; __electron.shell.showItemInFolder = () => {}; true",
        returnByValue: true
      })
      if (patch.result?.exceptionDetails) throw new Error('Native response injection failed: ' + JSON.stringify(patch.result.exceptionDetails))
      await main.call('Debugger.removeBreakpoint', { breakpointId })
      await main.call('Debugger.resume')
      injected = true; break
    }
    await main.call('Debugger.resume')
  }
  assert.ok(injected, 'must reach packaged application entry before test instrumentation')
  renderer = await connect(ports.renderer, t => t.type === 'page' && !t.url.includes('island.html'))
  for (let i = 0; i < 100; i++) { if (await renderer.ev("!!window.api?.diagnostics && !!document.querySelector('.app')")) break; await sleep(100) }
  assert.equal(await renderer.ev('window.api.diagnostics.enabled()'), true)
  assert.equal(await main.ev("__electron.app.getPath('userData')"), data)
  assert.equal(await main.ev('__electron.app.getName()'), 'Eas-Term Diagnostic')
  if (unclean) {
    for (let i = 0; i < 50; i++) { if ((await main.ev('__diagPrompts.length')) > 0) break; await sleep(100) }
    assert.ok((await main.ev('__diagPrompts.map(p => p.message)')).some(m => m.includes('上次未正常退出')))
  }
}
async function nativePtyPhase() {
  const args = [...(process.argv.includes('--dev') ? ['.'] : []), '--remote-debugging-port=' + ports.renderer, '--user-data-dir=' + data, '--no-sandbox']
  proc = spawn(executable, args, { env: { ...process.env, EAS_VERIFY: '1', EAS_SMOKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-50000) })
  renderer = await connect(ports.renderer, t => t.type === 'page' && !t.url.includes('island.html'))
  for (let i = 0; i < 100; i++) { if (await renderer.ev('!!window.api?.pty')) break; await sleep(100) }
  const pty = await renderer.ev('window.api.pty.create({ cwd: ' + JSON.stringify(root) + ', cols: 80, rows: 24 })')
  const result = await renderer.ev(`new Promise(resolve => {
    let output = ''; let timer;
    const off = window.api.pty.onData(${JSON.stringify(pty.id)}, chunk => {
      output += chunk;
      if (output.includes('EAS_DIAG_READY')) { clearTimeout(timer); off(); resolve(true) }
    });
    timer = setTimeout(() => { off(); resolve(false) }, 8000);
    window.api.pty.write(${JSON.stringify(pty.id)}, 'echo EAS_DIAG_READY\\r\\n');
  })`)
  assert.equal(result, true, 'real shell must echo before closing')
  await renderer.ev('window.api.pty.kill(' + JSON.stringify(pty.id) + ')')
  await renderer.ev('window.api.diagnostics.enabled()') // prove kill did not block the main process
  const events = fs.readFileSync(join(data, 'diagnostics/events.jsonl'), 'utf8')
  assert.ok(events.includes('pty-started'))
  evidence.checks.push('no-main-debugger actual PTY start, echo, kill and on-disk diagnostic event')
  await stop(true)
}
async function stop(abnormal = false) {
  const p = proc
  const exited = new Promise(r => p.once('exit', (code, signal) => r({ code, signal })))
  if (abnormal) p.kill('SIGKILL')
  else {
    // Acknowledge the inspector command before disconnecting. Do not tear down
    // its socket while Electron is executing quit inside Runtime.evaluate.
    assert.equal(await main.ev("setTimeout(() => __electron.app.quit(), 100); true"), true)
  }
  renderer.ws.close(); main?.ws.close()
  let timeout
  const result = await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => { p.kill(); reject(new Error('exit timeout')) }, 10000) })]).finally(() => clearTimeout(timeout))
  evidence.exits ??= []
  evidence.exits.push({ abnormal, ...result })
  if (!abnormal) assert.equal(result.code, 0, 'normal exit must not be an OS crash or forced termination')
  await sleep(400)
}
try {
  await nativePtyPhase()
  await launch(true)
  evidence.checks.push('independent identity/userData, bridge and real renderer')
  assert.equal(await renderer.ev('window.api.update.check()').then(r => r.info), null)
  await renderer.ev('window.api.diagnostics.chatOpen()')
  await renderer.ev('window.api.diagnostics.open()')
  assert.equal(await main.ev('__diagPrompts.at(-1).defaultId'), 0)
  evidence.checks.push('cancel default, production update disabled, PTY actual launch')
  await main.ev('__diagAnswer = 1')
  await renderer.ev('window.api.diagnostics.open()')
  const raw = gunzipSync(fs.readFileSync(join(data, 'diagnostic-report.json.gz'))).toString()
  const report = JSON.parse(raw)
  assert.ok(report.events.some(e => e.kind === 'chat-open'))
  assert.ok(report.events.some(e => e.kind === 'pty-started'))
  assert.equal(raw.includes(root), false)
  evidence.checks.push('actual export, chat and PTY events, no private path')
  if (process.argv.includes('--upload')) {
    await main.ev('__diagAnswer = 2')
    await renderer.ev('window.api.diagnostics.open()')
    assert.equal(await main.ev('__diagPrompts.at(-1).message'), '诊断报告已收到')
    evidence.receipt = report.id
    evidence.checks.push('explicit consent path uploads to HTTPS receiver and verifies receipt')
  }
  await stop(true)
  assert.ok(fs.existsSync(join(data, 'diagnostics/running')))
  await launch(true)
  evidence.checks.push('abrupt main exit persists and prompts next startup')
  await renderer.ev("window.dispatchEvent(new CustomEvent('eas:open-settings', { detail: { tab: 'privacy' } }))")
  await sleep(400)
  assert.ok((await renderer.ev('document.body.innerText')).includes('发送或导出诊断报告'))
  evidence.checks.push('privacy settings diagnostic entry rendered')
  await renderer.ev("[...document.querySelectorAll('button')].find(b => b.textContent.includes('发送或导出诊断报告')).scrollIntoView({block:'center'})")
  await sleep(200)
  const shot = await renderer.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(join(out, 'runtime.png'), Buffer.from(shot.result.data, 'base64'))
  await stop()
  assert.equal(fs.existsSync(join(data, 'diagnostics/running')), false)
  evidence.checks.push('normal quit clears marker')
  console.log(JSON.stringify(evidence, null, 2))
} catch (e) {
  evidence.error = String(e); process.exitCode = 1; console.error(e)
  try { evidence.lastEvents = fs.readFileSync(join(data, 'diagnostics/events.jsonl'), 'utf8').trim().split('\n').slice(-30).map(JSON.parse) } catch {}
} finally {
  renderer?.ws.close(); main?.ws.close()
  if (proc && proc.exitCode === null) proc.kill()
  fs.writeFileSync(join(out, 'result.json'), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(join(out, 'stderr.txt'), stderr)
  fs.rmSync(root, { recursive: true, force: true })
}
