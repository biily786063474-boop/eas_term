// AI 对话底栏宽度回归：AI 忙碌时（多出「停止」「调整方向」）底栏永远一行，宽度 ≥ 分屏下限时右侧按钮全在框内。
// 2026-10-02 用户截图：窄的对话框里模型名和右侧图标上下错位。量法：让 AI 卡在等审批上保持忙碌，
// 把节点宽度直接设成各档（绕开画布 640 的下限，模拟分屏里更窄的面板），逐档量中线与右边界，中英文各一遍。
//
//   npm run build && node scripts/verify-chat-bar-width.mjs
//
// 结果 docs/verification/chat-bar-width/measure.json，截图同目录。会真的拉起 Claude（一句话，停在审批上不执行）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const output = path.join(root, 'docs/verification/chat-bar-width')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-barw-')))
const profile = path.join(temp, 'profile')
const project = path.join(temp, 'project')
for (const d of [output, profile, project]) fs.mkdirSync(d, { recursive: true })

const P = 'pr-enter', F = 'f-enter'
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: P, name: '回车回归', path: project, addedAt: Date.now() }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
fs.writeFileSync(path.join(profile, 'canvas.json'), JSON.stringify({
  version: 1, viewMode: 'canvas', viewModePicked: true, viewport: { x: 0, y: 0, scale: 1 },
  frames: [{ id: F, projectId: P, name: '回车回归', x: 10, y: 10, w: 1120, h: 620, collapsed: false, nodes: [
    { id: 'n-a', x: 10, y: 50, w: 540, h: 540, name: '对话A', pane: { kind: 'agent', cwd: project, cli: 'claude' } },
    { id: 'n-b', x: 570, y: 50, w: 540, h: 540, name: '对话B', pane: { kind: 'agent', cwd: project, cli: 'claude' } }
  ] }], shapes: [], freeNodes: [], todos: []
}))

const env = { ...process.env, EAS_VERIFY: '1' }
for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || k === 'EAS_PTY_ID' || k === 'EAS_PROJECT') delete env[k]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  [root, '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
app.stdout.on('data', (x) => (logs += x)); app.stderr.on('data', (x) => (logs += x))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, tries = 150, gap = 200) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v } catch {} await sleep(gap) }
  throw Error('等待超时')
}
const result = { checks: [] }
const ok = (name, detail) => { result.checks.push({ name, passed: true, detail }); console.log('通过 ·', name, detail ? JSON.stringify(detail).slice(0, 220) : '') }
const bad = (name, detail) => { result.checks.push({ name, passed: false, detail }); console.log('不通过 ·', name, JSON.stringify(detail).slice(0, 300)) }

let ws
try {
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (app.exitCode !== null) throw Error(logs.slice(-1500)) } })
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0; const pending = new Map()
  ws.onmessage = (m) => { const j = JSON.parse(m.data); const cb = pending.get(j.id); if (cb) { pending.delete(j.id); cb(j) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const k = ++id; const t = setTimeout(() => { pending.delete(k); reject(Error('CDP 超时 ' + method)) }, 30000); pending.set(k, (v) => { clearTimeout(t); v.error ? reject(Error(JSON.stringify(v.error))) : resolve(v) }); ws.send(JSON.stringify({ id: k, method, params })) })
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value }
  const shot = async (name) => fs.writeFileSync(path.join(output, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
  await until(() => ev('!!window.api && !!window.__store'))
  await ev("document.querySelector('.onb-actions .onb-ghost')?.click()")
  await until(() => ev("!!document.querySelector('.canvas-viewport')"))

  // 第 n 个节点里的输入框（cls = ac-input 启动前 / ac-composer 会话中）
  const box = (node, cls) => `[...document.querySelectorAll('.cm-content.${cls}')].filter(e=>e.getBoundingClientRect().width>0)[${node}]`
  const focus = async (node, cls) => {
    const r = await until(() => ev(`(()=>{const e=${box(node, cls)};if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+Math.min(b.height/2,12)}})()`), 100, 200)
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(150)
  }
  const value = (node, cls) => ev(`(${box(node, cls)})?.value ?? null`)
  const type = (text) => send('Input.insertText', { text })
  // modifiers 位：Alt=1 Ctrl=2 Meta=4 Shift=8
  const enter = async (modifiers = 0, vk = 13) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    if (!modifiers && vk === 13) await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
    await sleep(250)
  }
  const selectAll = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 })
  }
  // 会话起来了 = 这个节点换成了会话中的输入框（ac-composer）。sessionId 可能挂在节点或它引用的 leaf 上，不去猜
  const started = () => ev(`[...document.querySelectorAll('.cm-content.ac-composer')].some(e=>e.getBoundingClientRect().width>0)`)


  // 让 AI 卡在等审批上：一直是忙碌态（停止 + 调整方向都在），量起来稳定
  // 准备中提示可能一闪而过：按键前挂个监听，出现过就记下
  await ev(`(window.__sawPending=false, new MutationObserver(()=>{if(document.querySelector('.ac-pending-send'))window.__sawPending=true}).observe(document.body,{childList:true,subtree:true}), true)`)
  await focus(0, 'ac-input')
  await type('用 Bash 工具在前台执行：sleep 120。不要放到后台')
  await enter()
  // 一启动就按 Enter：那时多半还在拉 CLI 清单 / 查登录。只按这一次 —— 要么当场发出，要么出「好了会自动发送」并自己补发
  await sleep(3000)
  result.pendingHint = await ev(`window.__sawPending ? 'seen' : ''`)
  const busyOk = await until(() => ev(`!!document.querySelector('.ac-redirect-button')`), 200, 500).catch(() => null)
  result.sentWithoutRetry = !!busyOk
  if (!busyOk) { await shot('no-busy.png'); throw Error('没进忙碌态：' + await ev(`document.querySelector('.ac-messages')?.innerText.slice(-400)||document.querySelector('.cm-content.ac-input')?.value`)) }
  await sleep(1500)
  const measure = (w) => ev(`(async()=>{
    const st=window.__store.getState()
    st.resizeNode && null
    window.__store.setState(s=>({canvas:{...s.canvas,frames:s.canvas.frames.map(f=>({...f,nodes:f.nodes.map(n=>n.id==='n-a'?{...n,w:${w}}:n)}))}}))
    await new Promise(r=>setTimeout(r,350))
    const bar=document.querySelector('.ac-composer-bar'); if(!bar) return null
    const kids=[...bar.children].filter(e=>e.getBoundingClientRect().width>0)
    const mid=r=>r.top+r.height/2; const tops=kids.map(e=>mid(e.getBoundingClientRect()))
    const box=bar.getBoundingClientRect()
    const acts=bar.querySelector('.ac-message-actions').getBoundingClientRect()
    const inner=[...bar.querySelectorAll('.ac-message-actions > *')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0)
    const trig=bar.querySelector('.ac-settings-trigger').getBoundingClientRect()
    const pane=bar.closest('[class*="agent-chat"], .ac-root')||document.querySelector('.ac-toolbar')
    return {w:${w}, oneLine:Math.max(...tops)-Math.min(...tops)<6, actsInside: acts.right<=box.right+0.5 && inner.every(r=>r.right<=box.right+0.5), innerOneLine:(a=>Math.max(...a)-Math.min(...a)<6)(inner.map(mid)), right:Math.round(Math.max(...inner.map(r=>r.right))-box.right), trigger:Math.round(trig.width), bar:Math.round(box.width), acts:Math.round(acts.width)}
  })()`)
  for (const lang of ['zh', 'en']) {
    await ev(`window.api.prefs.set('lang', '${lang}')`); await sleep(800)
    const rows = []
    for (const w of [640, 560, 520, 480, 460, 440, 420, 400, 380, 360, 340, 320, 300]) rows.push(await measure(w))
    result[lang] = rows
    console.log(lang); for (const r of rows) console.log(JSON.stringify(r))
    await ev(`window.__store.setState(s=>({canvas:{...s.canvas,frames:s.canvas.frames.map(f=>({...f,nodes:f.nodes.map(n=>n.id==='n-a'?{...n,w:460}:n)}))}}))`); await sleep(400)
    await shot('busy-460-' + lang + '.png')
  }
  const { SPLIT_MIN } = { SPLIT_MIN: 460 }
  for (const lang of ['zh', 'en']) {
    const bad = result[lang].filter((r) => !r.oneLine || !r.innerOneLine || (r.w >= SPLIT_MIN && !r.actsInside))
    result[lang + 'Bad'] = bad
  }
  // 下限那一档必须放得下；更窄的各档只要求不折行（那些宽度分屏里拉不到）
  result.passed = !result.zhBad.length && !result.enBad.length && result.sentWithoutRetry
  console.log('启动即按 Enter：只按一次就发出 =', result.sentWithoutRetry, '准备中提示 =', JSON.stringify(result.pendingHint)); console.log(result.passed ? '通过 · 各档一行；≥460 右侧按钮全在框内（中英）' : '不通过 · ' + JSON.stringify({ zh: result.zhBad, en: result.enBad }))
} catch (e) {
  result.passed = false; result.error = String(e?.stack || e); console.error('失败：', result.error)
} finally {
  fs.writeFileSync(path.join(output, 'measure.json'), JSON.stringify(result, null, 2))
  ws?.close(); app.kill('SIGKILL')
  process.exitCode = result.passed ? 0 : 1
}
