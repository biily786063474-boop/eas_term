// AI 对话输入框按键回归：Enter 发送，Ctrl / Shift / Alt + Enter 换行，输入法处理中的回车（keyCode 229）不发送。
// 2026-10-02 用户改交互时写的。用 CDP 派发**真实键盘事件**走完整链路（CodeMirror keydown → 调用方判发送），
// 不直接调函数 —— 后者测不出 preventDefault、编辑器默认键位这类问题。
//
//   npm run build && node scripts/verify-chat-enter.mjs
//
// · 隔离实例（独立 userData）+ 临时项目，两个 AI 对话节点：一个验启动前的输入框（ac-input）与会话中的输入框（ac-composer），
//   另一个留着切英文后看提示语。会真的拉起 Claude，两句很短的话。
// 结果写 docs/verification/chat-enter/result.json，截图同目录。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const output = path.join(root, 'docs/verification/chat-enter')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-enter-')))
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

  // ── 1 提示语（中文）───────────────────────────────────────────────
  const ph = await until(() => ev(`(${box(0, 'ac-input')})?.closest('.cm-editor')?.querySelector('.cm-placeholder')?.textContent || null`))
  ph.includes('Enter 发送') && ph.includes('Shift/Ctrl+Enter 换行') ? ok('1 启动前输入框提示「Enter 发送，Shift/Ctrl+Enter 换行」', ph) : bad('1 中文提示语', ph)
  await shot('placeholder-zh.png')

  // ── 2 启动前输入框：三种组合键换行、不发送 ───────────────────────────
  await focus(0, 'ac-input')
  await type('一'); await enter(8); await type('二'); await enter(2); await type('三'); await enter(1); await type('四')
  const v2 = await value(0, 'ac-input')
  v2 === '一\n二\n三\n四' && !(await started()) ? ok('2 Shift / Ctrl / Alt + Enter 各换一行，没有发送', JSON.stringify(v2)) : bad('2 组合键换行', { v2, started: await started() })
  await shot('newlines-zh.png')

  // ── 3 输入法处理中的回车（keyCode 229）：不发送、不插换行 ──────────────
  await enter(0, 229)
  const v3 = await value(0, 'ac-input')
  v3 === v2 && !(await started()) ? ok('3 输入法处理中的回车不发送') : bad('3 输入法回车', { v3, started: await started() })

  // ── 4 裸 Enter 发送：清空输入框、拉起会话 ────────────────────────────
  await selectAll(); await type('把 a-gnop 倒过来写，只回复结果')
  await enter()
  const sid = await until(started, 100, 300).catch(() => null)
  const v4 = await until(async () => { const v = await value(0, 'ac-input'); return v === null || v === '' ? 'cleared' : null }, 30, 200).catch(() => 'not-cleared')
  sid && v4 === 'cleared' ? ok('4 裸 Enter 发送：会话拉起、输入框清空、没有残留空行') : bad('4 Enter 发送', { sid, v4 })
  // 回复里的词不在发出去的那句里（倒过来写），否则消息一显示就误判成「收到回复」
  const reply = await until(() => ev(`/pong-a/i.test(document.body.innerText)?'yes':null`), 200, 500).catch(() => null)
  reply ? ok('4b 收到回复') : bad('4b 收到回复', null)

  // ── 5 会话中的输入框：Shift+Enter 换行，Enter 发出第二条 ───────────────
  await focus(0, 'ac-composer')
  await type('甲'); await enter(8); await type('乙')
  const v5 = await value(0, 'ac-composer')
  v5 === '甲\n乙' ? ok('5 会话中 Shift+Enter 换行', JSON.stringify(v5)) : bad('5 会话中换行', v5)
  await shot('composer-newline-zh.png')
  await selectAll(); await type('把 b-gnop 倒过来写，只回复结果')
  await enter()
  const v5b = await until(async () => ((await value(0, 'ac-composer')) === '' ? 'cleared' : null), 30, 200).catch(() => 'not-cleared')
  // 不看 AI 回得对不对（它曾把 b-gnop 倒成 gnop-b），看工具栏轮数到 2 —— 第二条真的送到并回完了
  const reply2 = await until(() => ev(`/(^|\\D)2 轮/.test(document.querySelector('.ac-toolbar')?.innerText||document.body.innerText)?'yes':null`), 200, 500).catch(() => null)
  // 同一句话在界面上出现几次、各在哪 —— 区分「对话标题」和「消息被发了两遍」
  result.firstMsgNodes = await ev(`[...document.querySelectorAll('body *')].filter(e=>!e.children.length&&e.textContent.trim()==='把 a-gnop 倒过来写，只回复结果').map(e=>e.className+' < '+e.parentElement.className+' < '+e.parentElement.parentElement.className)`)
  result.firstMsgSends = await ev(`[...document.querySelectorAll('body *')].filter(e=>!e.children.length&&e.textContent.trim()==='把 b-gnop 倒过来写，只回复结果').length`)
  const tail = reply2 ? null : await ev(`document.body.innerText.slice(-1200)`)
  v5b === 'cleared' && reply2 ? ok('5b 会话中 Enter 发送，收到第二条回复') : bad('5b 会话中 Enter 发送', { v5b, reply2, tail })
  // 忙着时按钮提示是「加入队列」，等这一轮收完尾再读
  const idleTip = (re) => until(() => ev(`(()=>{const t=document.querySelector('.ac-bar-send')?.dataset.tip||'';return ${re}.test(t)?t:null})()`), 120, 500).catch(() => ev(`document.querySelector('.ac-bar-send')?.dataset.tip || ''`))
  const tipZh = await idleTip('/Enter/')
  tipZh.includes('Enter 发送') ? ok('5c 发送按钮提示「Enter 发送」', tipZh) : bad('5c 发送按钮提示', tipZh)

  // ── 6 英文界面：提示语 ────────────────────────────────────────────
  await ev("window.api.prefs.set('lang', 'en')")
  const phEn = await until(() => ev(`(()=>{const t=(${box(0, 'ac-input')})?.closest('.cm-editor')?.querySelector('.cm-placeholder')?.textContent||'';return /Enter to send/.test(t)?t:null})()`), 50, 200).catch(() => null)
  const tipEn = await idleTip('/Enter/')
  phEn && /Shift\/Ctrl\+Enter for a new line/.test(phEn) && /Enter to send/.test(tipEn) && !/[一-鿿]/.test(phEn + tipEn)
    ? ok('6 英文：提示语与发送按钮都是英文', { phEn, tipEn }) : bad('6 英文提示语', { phEn, tipEn })
  await shot('placeholder-en.png')
  await focus(0, 'ac-input')
  await type('one'); await enter(2); await type('two')
  const v6 = await value(0, 'ac-input')
  v6 === 'one\ntwo' ? ok('6b 英文界面下 Ctrl+Enter 同样换行') : bad('6b 英文换行', v6)
  await shot('newlines-en.png')
  result.passed = result.checks.every((c) => c.passed)
} catch (e) {
  result.passed = false; result.error = String(e?.stack || e); console.error('失败：', result.error)
} finally {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  ws?.close(); app.kill('SIGKILL')
  process.exitCode = result.passed ? 0 : 1
}
