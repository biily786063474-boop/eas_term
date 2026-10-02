// 隔离实例：原生灵动岛宿主「起得来但永远不 ready」时，多久能退回 Electron 灵动岛（0.4.122 审查遗留：原先最坏约 55s）。
// 临时放一个假宿主（只 sleep、不发 ready）到开发路径，测完原样恢复；不碰正式包、不连 CLI。
// 用法：先 electron-vite build，再 node scripts/verify-island-native-fallback.mjs；结果到 docs/verification/island-native-fallback/。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import assert from 'node:assert/strict'
const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-island-fallback-')), profile = path.join(temp, 'p'), home = path.join(temp, 'h')
const out = path.join(root, process.env.EAS_VERIFY_OUTPUT ?? 'docs/verification/island-native-fallback'); for (const d of [profile, home, out]) fs.mkdirSync(d, { recursive: true })
const LIMIT_MS = Number(process.env.FALLBACK_LIMIT_MS ?? 25000)
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ island: true, autoUpdateCheck: false, telemetry: false, lang: 'zh' }))
// 假宿主：开发路径 resources/island-native/bin/IslandHost.app/Contents/MacOS/IslandHost + out/island-native-assets/island-assets.json（都是 gitignore 的构建产物）
const binDir = path.join(root, 'resources/island-native/bin'), assetsDir = path.join(root, 'out/island-native-assets')
const moved = []
for (const d of [binDir, assetsDir]) if (fs.existsSync(d)) { fs.renameSync(d, d + '.verify-bak'); moved.push(d) }
const exe = path.join(binDir, 'IslandHost.app/Contents/MacOS/IslandHost')
fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '#!/bin/sh\nexec /bin/sleep 600\n', { mode: 0o755 })
fs.mkdirSync(assetsDir, { recursive: true }); fs.writeFileSync(path.join(assetsDir, 'island-assets.json'), '{}')
const env = { ...process.env, HOME: home, EAS_VERIFY: '1', EAS_ISLAND_NATIVE: '1' }; for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)) delete env[k]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--inspect=0', '--remote-debugging-port=0', '--use-mock-keychain', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''; app.stdout.on('data', (x) => (logs += x)); app.stderr.on('data', (x) => (logs += x))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, label, n = 600) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout: ' + label) }
async function connect(url) { const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }; const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) }); return { send, ev: async (x) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description ?? 'eval failed'); return m.result?.result?.value } } }
const result = {}
try {
  const main = await connect(await until(() => logs.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1], 'main inspector'))
  const port = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } }, 'renderer port')
  const page = await connect((await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.url.endsWith('/index.html')), 'main page')).webSocketDebuggerUrl)
  await until(() => page.ev('!!window.__store&&!!window.api'), 'store'); await wait(1500); await page.ev("document.querySelector('.onb-ghost')?.click();true")
  const E = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
  const sid = 'ac-fallback-fixture', tab = { id: 'fb-tab', title: '回退验收', projectId: 'fb', cwd: temp, activeLeafId: 'fb-leaf', root: { type: 'leaf', id: 'fb-leaf', pane: { kind: 'agent', cwd: temp, cli: 'codex', sessionId: sid } } }
  await page.ev(`(()=>{window.__store.setState({viewMode:'split',projects:[{id:'fb',name:'回退验收',path:${JSON.stringify(temp)}}],tabs:[${JSON.stringify(tab)}],activeTabId:'fb-tab'});return true})()`)
  await wait(1500)
  await main.ev(E + ".BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).minimize();true")
  const emit = (e) => main.ev(E + ".BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('agentChat:event'," + JSON.stringify({ sessionId: sid, event: e }) + ')')
  const t0 = Date.now()
  await emit({ k: 'turn.start' }); await emit({ k: 'text.done', text: '隔离通知：宿主起不来' }); await emit({ k: 'turn.done', usage: { input: 1, output: 1 } })
  await until(() => main.ev(E + ".BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('/island.html')&&w.isVisible())"), 'electron island visible', 1200)
  result.msToElectronIsland = Date.now() - t0
  result.fallbackLog = (logs.match(/原生宿主[^\n]*退回 Electron 灵动岛/) ?? [null])[0]
  result.readyTimeouts = (logs.match(/native island ready timeout/g) ?? []).length
  console.log(JSON.stringify(result, null, 1))
  assert.ok(result.msToElectronIsland < LIMIT_MS, `宿主起不来时 ${result.msToElectronIsland}ms 才出灵动岛（上限 ${LIMIT_MS}ms）`)
  result.passed = true
  console.log('PASS')
} finally {
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1))
  app.kill('SIGTERM'); await wait(1500); try { app.kill('SIGKILL') } catch {}
  fs.rmSync(binDir, { recursive: true, force: true }); fs.rmSync(assetsDir, { recursive: true, force: true })
  for (const d of moved) fs.renameSync(d + '.verify-bak', d)
  fs.rmSync(temp, { recursive: true, force: true })
}
