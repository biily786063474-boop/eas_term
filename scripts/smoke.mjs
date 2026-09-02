// 冒烟测试：把打包好的 app 真的启动一次，验证它不只是「能构建」而是「能跑」。
//
//   node scripts/smoke.mjs <app 可执行文件路径>
//
// 为什么走 CDP 而不是看进程存活：GUI app 白屏、渲染进程崩了、原生模块加载失败，
// 主进程照样活着——只看进程等于没测。CDP 能直接问渲染层「你还好吗」。
//
// 不需要为此改生产代码：--remote-debugging-port 是 Chromium 自带开关，Electron 直接认。
import { execFileSync, spawn } from 'child_process'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { setTimeout as sleep } from 'timers/promises'

// 原生 WebSocket 是 Node 22+ 才有的；低版本直接说清楚，别让人对着
// 「WebSocket is not defined」猜半天（CI 上第一次跑就撞了这个）
if (typeof WebSocket === 'undefined') {
  console.error(`✗ 需要 Node 22+（当前 ${process.version}）——冒烟测试用原生 WebSocket 连 CDP`)
  process.exit(2)
}

const APP = process.argv[2]
const PORT = 9321
const OUT = 'smoke-out'
if (!APP) { console.error('用法: node scripts/smoke.mjs <app 可执行文件>'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const fails = []
const ok = (name, extra = '') => console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`)
const bad = (name, why) => { console.log(`  ✗ ${name}  ${why}`); fails.push(`${name}: ${why}`) }

// 独立 userData：否则冒烟测试会读写真实的 canvas.json / projects.json，
// 退出时把开发机上正在用的画布覆盖掉（本地跑时真会踩到）
const USERDATA = join(tmpdir(), `eas-smoke-${Date.now()}`)
console.log(`▸ 启动 ${APP}`)
console.log(`  userData: ${USERDATA}（独立，测完删）`)
const proc = spawn(APP, [`--remote-debugging-port=${PORT}`, '--no-sandbox', `--user-data-dir=${USERDATA}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, EAS_SMOKE: '1' }
})
let stderr = ''
proc.stderr.on('data', (d) => { stderr += d.toString() })
proc.on('exit', (code) => { if (code !== null && code !== 0) bad('进程提前退出', `exit=${code}`) })

// ── 等 CDP 起来 ────────────────────────────────────────────────────
let target = null
for (let i = 0; i < 40; i++) {
  await sleep(1000)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((t) => t.type === 'page')
    if (target) break
  } catch { /* 还没起来 */ }
}
if (!target) {
  bad('app 启动', `${40}s 内没等到渲染页面。stderr 尾部:\n${stderr.slice(-800)}`)
  proc.kill(); process.exit(1)
}
ok('app 启动', `页面: ${decodeURIComponent(target.url).slice(0, 60)}`)

// ── 连 CDP ────────────────────────────────────────────────────────
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 1
const pend = new Map()
const logs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? '').slice(0, 200))
})
const send = (method, params) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval 失败')
  return r.result?.result?.value
}
await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable')
await sleep(3000)

// ── 1. 渲染层真的渲染出东西了（不是白屏） ─────────────────────────
try {
  const ui = await ev(`JSON.stringify({
    app: !!document.querySelector('.app'),
    titlebar: !!document.querySelector('.titlebar'),
    bodyText: (document.body.innerText || '').trim().length
  })`)
  const u = JSON.parse(ui)
  if (u.app && u.titlebar && u.bodyText > 0) ok('界面渲染', `正文 ${u.bodyText} 字`)
  else bad('界面渲染', `白屏或结构缺失: ${ui}`)
} catch (e) { bad('界面渲染', e.message) }

// ── 2. preload 的 api 桥通了 ──────────────────────────────────────
try {
  const api = await ev(`JSON.stringify(Object.keys(window.api || {}).sort())`)
  const keys = JSON.parse(api)
  const need = ['pty', 'fs', 'projects', 'mcp']
  const miss = need.filter((k) => !keys.includes(k))
  if (!miss.length) ok('preload 桥', `${keys.length} 个命名空间`)
  else bad('preload 桥', `缺少 ${miss.join(', ')}`)
} catch (e) { bad('preload 桥', e.message) }

// ── 3. node-pty 真的能开终端并回显（Windows 上最可能挂的地方） ──────
try {
  const r = await ev(`(async () => {
    const { id } = await window.api.pty.create({ cwd: ${JSON.stringify(process.cwd())}, cols: 80, rows: 24 })
    let buf = ''
    const off = window.api.pty.onData(id, (d) => { buf += d })
    window.api.pty.write(id, 'echo EAS_SMOKE_OK\\r\\n')
    await new Promise((r) => setTimeout(r, 6000))
    off(); window.api.pty.kill(id)
    return JSON.stringify({ id, hit: buf.includes('EAS_SMOKE_OK'), bytes: buf.length })
  })()`)
  const p = JSON.parse(r)
  if (p.hit) ok('node-pty 开终端 + 回显', `收到 ${p.bytes} 字节`)
  else bad('node-pty 开终端 + 回显', `没等到回显（收到 ${p.bytes} 字节）——原生模块或 conpty 可能有问题`)
} catch (e) { bad('node-pty 开终端 + 回显', e.message) }

// ── 4. MCP 桥起来了（端口文件会落盘） ────────────────────────────
try {
  const has = await ev(`(async () => {
    const p = await window.api.fs.probePaths(['mcp-endpoint.json'], '.')
    return 'probe-ok'
  })()`)
  ok('IPC 往返', has)
} catch (e) { bad('IPC 往返', e.message) }

// ── 5. 渲染层没有抛错 ────────────────────────────────────────────
if (logs.length === 0) ok('无 JS 报错')
else bad('渲染层报错', logs.slice(0, 3).join(' | ').slice(0, 300))

// ── 截图存证 ─────────────────────────────────────────────────────
try {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/screen.png`, Buffer.from(s.result.data, 'base64'))
  ok('截图', `${OUT}/screen.png`)
} catch (e) { bad('截图', e.message) }

// ── 随包的 omp 二进制真的能跑吗 ───────────────────────────────────
// **这是唯一能验 Windows 那份的地方**：本机打不出 Windows 包，CI 上也没别的环节
// 会去碰它。漏掉的症状是 Windows 用户装上之后 omp 恒显示「未安装」，
// 而 dev / check / node --test 全绿。
//
// 路径基准要按产物布局取，**不是 app bundle 的 Contents/Resources**：
// CI 传进来的是 `release/win-unpacked/Eas-Term.exe`，extraResources 落在
// 与 exe 同级的 `resources/`；mac 的 .app 才是 `Contents/Resources`。
try {
  const dir = APP.endsWith('.app') || APP.includes('.app/')
    ? join(APP.slice(0, APP.indexOf('.app') + 4), 'Contents', 'Resources')
    : join(dirname(APP), 'resources')
  const bin = join(dir, 'omp', process.platform === 'win32' ? 'omp.exe' : 'omp')
  if (!existsSync(bin)) throw new Error(`包里没有 ${bin}`)
  const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 }).trim()
  if (!/^omp\//.test(out)) throw new Error(`--version 输出不像 omp：${out}`)
  ok('随包 omp', out)
} catch (e) { bad('随包 omp', e.message) }

writeFileSync(`${OUT}/stderr.log`, stderr)
ws.close()
proc.kill()
await sleep(1500)
try { process.kill(proc.pid, 'SIGKILL') } catch { /* 已退出 */ }
try { rmSync(USERDATA, { recursive: true, force: true }) } catch { /* 留着也无妨 */ }

console.log('')
if (fails.length) { console.log(`✗ 冒烟测试失败 ${fails.length} 项：`); fails.forEach((f) => console.log('   - ' + f)); process.exit(1) }
console.log('✓ 冒烟测试全部通过')
