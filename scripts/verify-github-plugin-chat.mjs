// GitHub（只读）插件「替用户验收」：按用户真实用法走一遍（2026-09-30）。
//   eas-secret run --vars GITHUB_READONLY_TEST_TOKEN -- node scripts/verify-github-plugin-chat.mjs
// 前提同 verify-github-plugin.mjs（本地候选目录 + npm run build）。
// 与 verify-github-plugin.mjs 的区别：这里用**真实 Claude 对话**——Frame 右键「插件」→ 点「GitHub（只读）」新开绑定对话 →
// 让 AI 查仓库最近提交 → 再让它建 Issue，确认它做不到。会用掉少量 Claude 额度。
// 沙箱：Claude CLI 要读本机登录，所以放行 ~/.claude；仍拒读写 ~/.eas ~/.codex ~/.dsh（插件装进临时 HOME）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

const token = process.env.GITHUB_READONLY_TEST_TOKEN
if (!token) { console.error('缺 GITHUB_READONLY_TEST_TOKEN（用 eas-secret run 包裹）'); process.exit(2) }
const root = process.cwd(), candidate = process.env.EAS_GITHUB_CANDIDATE || '/tmp/gh-registry-candidate'
const out = path.join(root, 'docs/verification/plugin-marketplace/github')
fs.mkdirSync(out, { recursive: true })
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-github-chat-')))
const profile = path.join(tmp, 'profile'), home = path.join(tmp, 'home'), project = path.join(tmp, 'project')
for (const p of [profile, home, project]) fs.mkdirSync(p)
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'gh-chat', name: 'GitHub验收', path: project }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/plugins\//, '/')
  const file = path.join(candidate, rel)
  if (!file.startsWith(candidate) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return }
  res.end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const bootstrap = path.join(tmp, 'launch.cjs')
// 只改主进程的 os.homedir（插件目录落进临时 HOME）；子进程（Claude CLI）用真实 HOME 读登录
fs.writeFileSync(bootstrap, `require('os').homedir=()=>${JSON.stringify(home)};
const {app,dialog,session}=require('electron');app.setAppPath(${JSON.stringify(root)});
dialog.showMessageBox=async()=>({response:1});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://eas.biily.top/plugins/github/*']},(d,cb)=>cb({redirectURL:${JSON.stringify('http://127.0.0.1:' + port)}+new URL(d.url).pathname})));
require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`)
const env = { ...process.env, EAS_VERIFY: '1', EAS_PLUGIN_REGISTRY_URL: `http://127.0.0.1:${port}/v2/registry.json` }
for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || k === 'EAS_PTY_ID' || k === 'EAS_PROJECT' || /TOKEN|API_KEY|SECRET|PASSWORD/.test(k)) delete env[k]
const policy = '(version 1) (allow default) ' + ['.codex', '.eas', '.dsh'].map((n) => '(deny file-read* file-write* (subpath ' + JSON.stringify(path.join(os.homedir(), n)) + '))').join(' ')
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), bootstrap, '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''; child.stdout.on('data', (b) => (logs += b)); child.stderr.on('data', (b) => (logs += b))
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), checks = [], notes = {}
const check = (v, n) => { if (!v) throw Error(n); checks.push(n); console.log('✓', n) }
async function until(fn, n = 200, ms = 150) { for (let i = 0; i < n; i++) { const v = await fn(); if (v) return v; await wait(ms) } throw Error('Timed out') }
let main
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0; const pending = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })) })
  return { send, eval: async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value } }
}
const shot = async (name) => { const s = await main.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name), Buffer.from(s.data, 'base64')) }
const mouse = async (x, y, button = 'left') => {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 })
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 })
}
const center = (sel) => main.eval(`(()=>{const e=${sel};if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
// 对话发一条消息并等这一轮结束；返回这一轮新增的文字与调用过的工具
async function ask(leafId, text, timeoutMs = 300_000) {
  const pane = `document.querySelector('[data-leaf-id="${leafId}"]')`
  const before = await main.eval(`(${pane}?.innerText||'').length`)
  await main.eval(`(()=>{const e=${pane}.querySelector('[contenteditable="true"]');e.focus();return document.activeElement===e})()`)
  await main.send('Input.insertText', { text })
  await wait(400)
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
  const t0 = Date.now()
  let started = false
  while (Date.now() - t0 < timeoutMs) {
    await wait(2000)
    // 审批卡片：隔离实例里自动允许，并记下来
    const approved = await main.eval(`(()=>{const b=[...${pane}.querySelectorAll('button')].find(b=>/^(允许|批准|允许本次|同意)$/.test(b.textContent.trim()));if(b){b.click();return b.textContent.trim()}return ''})()`)
    if (approved) (notes.approvals ??= []).push(approved)
    const busy = await main.eval(`/正在处理|思考中/.test(${pane}?.innerText||'')`)
    if (busy) started = true
    if (started && !busy) break
  }
  await wait(1500)
  const all = await main.eval(`${pane}?.innerText||''`)
  const fresh = all.slice(before)
  const tools = [...new Set(fresh.match(/mcp__[a-z0-9_-]+__[a-z0-9_]+/gi) || [])]
  return { fresh, tools }
}
let failure
try {
  const debug = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (child.exitCode !== null) throw Error(logs.slice(-1500)) } })
  main = await connect((await until(async () => (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))).webSocketDebuggerUrl)
  await main.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await until(() => main.eval('!!window.api?.plugins && !!window.__store'))
  check((await main.eval('window.api.secrets.setup("837194")')).ok, '隔离密钥柜建立并解锁')
  await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('gh-chat',30,30);s.setViewport({x:0,y:0,scale:1})})()")
  await main.eval("document.querySelectorAll('.skill-mask button').forEach(b=>{if(/以后再说/.test(b.textContent))b.click()})")
  // ① 市场安装 + 填令牌
  await until(() => main.eval("!!document.querySelector('.wk-edge-guide')")); await main.eval("document.querySelector('.wk-edge-guide').click()")
  await until(() => main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))")); await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
  await until(() => main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))")); await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
  const card = "[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('GitHub（只读）'))"
  await until(() => main.eval('!!' + card))
  await main.eval(card + ".querySelector('.pm-add').click()")
  await until(() => main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
  await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
  await until(() => fs.existsSync(path.join(home, '.eas/plugins/github/plugin.json')))
  const input = "document.querySelector('.pm-settings input[type=password]')"
  await until(() => main.eval('!!' + input))
  await main.eval(`(()=>{const e=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(token)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await until(() => main.eval("[...document.querySelectorAll('.pm-settings button')].some(e=>e.textContent==='保存配置'&&!e.disabled)"))
  await main.eval("[...document.querySelectorAll('.pm-settings button')].find(e=>e.textContent==='保存配置').click()")
  await until(async () => (await main.eval("window.api.plugins.configuration('status','eas:github')"))?.configured?.includes('token'))
  const tested = await main.eval("window.api.plugins.configuration('test','eas:github')")
  check(tested.ok && tested.tools > 0, `市场装上「GitHub（只读）」并保存令牌，测试连接通过（${tested.tools} 个工具）`)
  // 关掉市场与设置
  for (let i = 0; i < 3; i++) { await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(300) }
  await main.eval("document.querySelector('.pm-settings-close')?.click();document.querySelector('.pm-close,.pm-x')?.click()")
  await wait(800)
  // ② Frame 右键 → 插件 → GitHub（只读）：新开绑定 GitHub 的对话
  const frameId = await main.eval("window.__store.getState().canvas.frames.at(-1).id")
  const before = await main.eval(`window.__store.getState().canvas.frames.find(f=>f.id===${JSON.stringify(frameId)}).nodes.map(n=>n.id)`)
  const [fx, fy] = await center(`document.querySelector('[data-fid="${frameId}"]')`)
  await mouse(Math.round(fx), Math.round(fy), 'right')
  await until(() => main.eval("[...document.querySelectorAll('.cctx-item')].some(e=>e.querySelector('.cctx-label')?.textContent==='插件')"))
  const [mx, my] = await center("[...document.querySelectorAll('.cctx-item')].find(e=>e.querySelector('.cctx-label')?.textContent==='插件')")
  await mouse(Math.round(mx), Math.round(my))
  await until(() => main.eval("[...document.querySelectorAll('.cpk-row')].some(e=>e.textContent.includes('GitHub（只读）'))"))
  await shot('chat-0-plugin-picker.png')
  const [px, py] = await center("[...document.querySelectorAll('.cpk-row')].find(e=>e.textContent.includes('GitHub（只读）'))")
  await mouse(Math.round(px), Math.round(py))
  const node = await until(() => main.eval(`(()=>{const f=window.__store.getState().canvas.frames.find(f=>f.id===${JSON.stringify(frameId)});const n=f.nodes.find(n=>!${JSON.stringify(before)}.includes(n.id));return n?{id:n.id,leafId:n.leafId}:null})()`))
  const pane = await main.eval(`(()=>{const s=window.__store.getState();const walk=(t)=>t?.kind==='leaf'?[t]:(t?.children||[]).flatMap(walk);for(const tab of Object.values(s.tabs||{})){}const leaf=s.leaves?.[${JSON.stringify(node.leafId)}]||null;return leaf?leaf.pane:null})()`)
  notes.boundPane = pane
  check(!!node.leafId, '右键「插件」→ 点「GitHub（只读）」新开了一个对话节点')
  await wait(1500)
  // ③ 真实 Claude 对话：查仓库
  const q1 = '用 GitHub 插件查一下：这个令牌对应的账号是谁，能访问哪些仓库；挑其中最近更新的一个，列出它最近 3 次提交的提交信息和时间。只用 GitHub 插件的工具，不要用 git、gh 或网页。'
  const r1 = await ask(node.leafId, q1)
  notes.round1 = { tools: r1.tools, reply: r1.fresh.slice(-1200) }
  await shot('chat-1-read.png')
  check(r1.tools.some((t) => t.startsWith('mcp__github__')), `AI 在对话里调用了 GitHub 插件工具：${r1.tools.filter((t) => t.startsWith('mcp__github__')).join('、') || '无'}`)
  // ④ 让它写：建 Issue——只读模式下服务端没有写工具，应当做不到
  const q2 = '现在在刚才那个仓库新建一个 Issue，标题「Eas-Term 验收测试」。只用 GitHub 插件，做不到就直接说明原因，不要用其他办法。'
  const r2 = await ask(node.leafId, q2)
  notes.round2 = { tools: r2.tools, reply: r2.fresh.slice(-1200) }
  await shot('chat-2-write-refused.png')
  check(!r2.tools.some((t) => /create|write|update|delete|push|merge/.test(t)), '建 Issue 时没有任何写类工具可调')
  check(/只读|没有.{0,12}(工具|权限)|无法|不能|做不到/.test(r2.fresh), 'AI 明确说明做不到（只读）')
  check(!logs.includes(token), '应用日志里没有令牌')
} catch (e) {
  failure = String(e.message || e)
  try { await shot('chat-failure.png') } catch {}
} finally {
  const result = { passed: !failure, failure, checks, notes, scope: 'Acceptance on behalf of the user: real market install from local candidate, real config + safeStorage, Frame context menu → 插件 → GitHub（只读） opens a bound chat, real Claude Code conversation using the plugin against real GitHub (readonly), then a write request.' }
  fs.writeFileSync(path.join(out, 'chat-result.json'), JSON.stringify(result, null, 2).split(token).join('[REDACTED]'))
  console.log(failure ? '未通过：' + failure : '全部通过')
  child.kill(); server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(failure ? 1 : 0)
}
