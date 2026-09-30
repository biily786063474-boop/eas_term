// 真实 Claude 续轮验收（2026-09-30 修「执行清单缺少有效项目或轮次」）：
// 隔离配置目录 + 临时项目；让 AI 建清单、起后台 sleep、马上结束本轮；后台跑完后 CLI 自己续上，
// 在续轮里勾第二步。判据：项目 .eas/execution-plans.json 里第二步 reported_done（不看 AI 自己怎么说）。
// 用真实 Claude 账号（claude CLI 用本机登录，不改任何凭证）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.argv[2]
// macOS 的 /var/folders 是 /private/var/folders 的链接：登记链接路径而 CLI 跑在真实路径上，会判「执行清单项目不匹配」
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-wake-')))
const profile = path.join(temp, 'profile'), project = path.join(temp, 'project')
for (const d of [profile, project]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'wake-project', name: '续轮验收', path: project }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
fs.writeFileSync(path.join(profile, 'canvas.json'), JSON.stringify({ version: 1, viewMode: 'canvas', viewModePicked: true, viewport: { x: 0, y: 0, scale: 1 },
  frames: [{ id: 'wake-frame', projectId: 'wake-project', name: '续轮验收', x: 20, y: 20, w: 1100, h: 700, collapsed: false,
    nodes: [{ id: 'wake-chat', x: 20, y: 50, w: 900, h: 600, pane: { kind: 'agent', cwd: project, cli: 'claude' } }] }], shapes: [], freeNodes: [], todos: [] }))
const port = 9571
const env = { ...process.env, EAS_VERIFY: '1' }
for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || k === 'EAS_PTY_ID' || k === 'EAS_PROJECT') delete env[k]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { env, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
let ws, id = 0
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((p) => p.type === 'page' && p.title === 'Eas-Term')
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); return }
    } catch {}
    await sleep(1000)
  }
  throw Error('找不到主窗口')
}
const send = (method, params = {}) => new Promise((resolve) => {
  const my = ++id
  ws.addEventListener('message', function h(m) { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', h); resolve(d.result) } })
  ws.send(JSON.stringify({ id: my, method, params }))
})
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value
const planFile = path.join(project, '.eas', 'execution-plans.json')
const readPlans = () => { try { return JSON.parse(fs.readFileSync(planFile, 'utf8')).plans } catch { return [] } }
const result = { profile, project, steps: [] }
try {
  await connect()
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await sleep(6000)
  await evalJs(`document.querySelectorAll('.skill-mask button').forEach(b=>{if(/以后再说/.test(b.textContent))b.click()});1`)
  const msg = '这是一次自动化验收，请严格按顺序做，不要多做别的事：\n'
    + '1) 用 plan_create 建清单，标题「续轮验收」，两步：「起后台任务」「后台完成后勾选」。\n'
    + '2) 用 Bash 工具、参数 run_in_background 设为 true，执行 `sleep 20 && echo WAKE-DONE`。\n'
    + '3) 用 step_update 把第一步标为 reported_done。\n'
    + '4) 然后立刻结束这一轮回复，不要等待后台任务，也不要轮询它。\n'
    + '5) 之后你会收到后台任务完成的通知：届时用 step_update 把第二步标为 reported_done；如果工具报错，把错误原文完整回复出来。'
  // 输入框是 contenteditable：聚焦后用 CDP 真实打字、真实 ⌘↵
  const focused = await evalJs(`(()=>{const el=document.querySelector('.cfile-node [contenteditable="true"]');if(!el)return 'no editor';el.focus();return document.activeElement===el?'focused':'not focused'})()`)
  let ok = focused
  if (focused === 'focused') {
    await send('Input.insertText', { text: msg })
    await sleep(400)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
    await sleep(1500)
    const left = await evalJs(`(document.querySelector('.cfile-node [contenteditable="true"]')?.innerText||'').length`)
    ok = left < 20 ? 'sent' : 'still in editor (' + left + ' chars)'
  }
  log('发送:', ok)
  if (ok !== 'sent') {
    const dom = await evalJs(`(()=>({textareas:[...document.querySelectorAll('textarea')].map(t=>t.className+' @'+(t.closest('[class]')?.className||'')).slice(0,8),node:(document.querySelector('.cfile-node')?.innerText||'NO .cfile-node').slice(0,600),kinds:[...document.querySelectorAll('.cfile-node')].map(n=>n.dataset.kind)}))()`)
    log('DOM:', JSON.stringify(dom, null, 1))
    throw Error('没发出去：' + ok)
  }
  const deadline = Date.now() + 240_000
  let lastSig = ''
  while (Date.now() < deadline) {
    await sleep(3000)
    // 审批卡片：自动允许（只在这个隔离实例里）
    const clicked = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^(允许|批准|允许本次|同意)$/.test(b.textContent.trim()));if(b){b.click();return b.textContent.trim()}return ''})()`)
    if (clicked) log('点了审批:', clicked)
    const plans = readPlans()
    const p = plans.find((x) => x.title === '续轮验收')
    const sig = p ? p.steps.map((s) => `${s.title}:${s.status}`).join(' | ') : '(还没有清单)'
    if (sig !== lastSig) { log('清单:', sig); result.steps.push({ at: new Date().toISOString(), sig }); lastSig = sig }
    if (p && p.steps[1]?.status === 'reported_done') { result.pass = true; break }
  }
  result.chat = await evalJs(`(document.querySelector('.cfile-node')?.innerText||'').slice(-2500)`)
  result.pass = !!result.pass
} catch (e) { result.error = String(e) } finally {
  fs.writeFileSync('/tmp/verify-plan-wake-result.json', JSON.stringify(result, null, 2))
  log('结果:', result.pass ? '通过' : '未通过', result.error ?? '')
  try { ws?.close() } catch {}
  app.kill()
}
