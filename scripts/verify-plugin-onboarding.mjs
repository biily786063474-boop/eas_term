// 插件傻瓜式引导「新用户视角」验收（2026-09-30）。
//   eas-secret run --vars GITHUB_READONLY_TEST_TOKEN -- node scripts/verify-plugin-onboarding.mjs
// 纪律：只用真实鼠标点屏幕上看得见的按钮（CDP Input），不调内部接口；每一步截图。
// 起点：用户画布上有一个项目 Frame（首启引导后就是这样）。令牌由脚本代「粘贴」进密码框（用户会从 GitHub 复制过来）。
// 沙箱：放行 ~/.claude（Claude CLI 登录），拒 ~/.eas ~/.codex ~/.dsh；插件装进临时 HOME。会用掉少量 Claude 额度。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

const token = process.env.GITHUB_READONLY_TEST_TOKEN
if (!token) { console.error('缺 GITHUB_READONLY_TEST_TOKEN（用 eas-secret run 包裹）'); process.exit(2) }
const root = process.cwd(), candidate = process.env.EAS_GITHUB_CANDIDATE || '/tmp/gh-registry-candidate'
const out = path.join(root, 'docs/verification/plugin-onboarding')
fs.mkdirSync(out, { recursive: true })
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-onboard-')))
const profile = path.join(tmp, 'profile'), home = path.join(tmp, 'home'), project = path.join(tmp, 'project')
for (const p of [profile, home, project]) fs.mkdirSync(p)
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'onb', name: '我的项目', path: project }]))
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
let step = 0
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
const shot = async (name) => { const s = await main.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${String(++step).padStart(2, '0')}-${name}.png`), Buffer.from(s.data, 'base64')) }
// 真实点击：先确认元素在屏幕上看得见（在视口内、没被别的东西盖住），再在它中心按下鼠标
async function click(sel, label) {
  const at = await until(() => main.eval(`(()=>{const e=${sel};if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();if(r.width<2||r.height<2)return null;const x=r.x+r.width/2,y=r.y+r.height/2;if(x<0||y<0||x>innerWidth||y>innerHeight)return null;const top=document.elementFromPoint(x,y);if(!top||!(e===top||e.contains(top)))return null;return [x,y]})()`), 120)
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] })
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  notes.clicks = [...(notes.clicks ?? []), label]
  await wait(500)
}
const byText = (scope, tag, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' ' + tag)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`
let failure
try {
  const debug = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (child.exitCode !== null) throw Error(logs.slice(-1500)) } })
  main = await connect((await until(async () => (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))).webSocketDebuggerUrl)
  await main.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await until(() => main.eval('!!window.api?.plugins && !!window.__store'))
  // 前置（首启后的状态）：密钥柜已建、画布上有一个项目 Frame
  check((await main.eval('window.api.secrets.setup("837194")')).ok, '前置：密钥柜已建立')
  await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('onb',60,60);s.setViewport({x:0,y:0,scale:1})})()")
  await main.eval("document.querySelectorAll('.skill-mask button').forEach(b=>{if(/以后再说/.test(b.textContent))b.click()})")
  await wait(800)
  // ① 从侧边「插件」进市场，装 GitHub（只读）
  await click("document.querySelector('.wk-edge-guide')", '侧边抽屉')
  await click("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件'))", '插件分页')
  await click("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场'))", '查看完整插件市场')
  const card = "[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('GitHub（只读）'))"
  await until(() => main.eval('!!' + card))
  await shot('market')
  await click(card + ".querySelector('.pm-add')", '安装 +')
  await click("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装'))", '确认安装')
  // ② 装完自动弹配置：看得到「获取密钥」和步骤
  await until(() => main.eval("!!document.querySelector('.pm-settings input[type=password]')"))
  await wait(600)
  await shot('config-opened')
  check(await main.eval("!!document.querySelector('.pm-settings .pm-key-help')"), '配置窗口里有「获取密钥」按钮')
  check(await main.eval("(document.querySelector('.pm-settings .pm-help-steps')?.textContent||'').includes('Repository access')"), '配置窗口里写着怎么拿令牌（选仓库 → Generate token → 粘贴回来）')
  await click("document.querySelector('.pm-settings .pm-key-help')", '获取密钥')
  const webviewSrc = await until(() => main.eval("document.querySelector('.pm-key-browser webview')?.getAttribute('src')||''"))
  notes.helpUrl = webviewSrc
  check(/personal-access-tokens\/new\?name=Eas-Term.*contents=read.*issues=read.*pull_requests=read.*actions=read/.test(webviewSrc), '「获取密钥」在软件内打开 GitHub 令牌创建页，并预填名称与只读权限')
  await wait(2500)
  await shot('get-token-page')
  await click("document.querySelector('.pm-key-return')", '返回连接设置')
  // ③ 粘贴令牌 → 保存 → 测试连接 → 开始对话
  await click("document.querySelector('.pm-settings input[type=password]')", '密码框')
  await main.send('Input.insertText', { text: token })
  await click(byText('.pm-settings', 'button', '保存配置'), '保存配置')
  await until(() => main.eval("(document.querySelector('.pm-settings')?.innerText||'').includes('已保存到本机插件专属加密凭证库')"), 120)
  await shot('saved')
  check(await main.eval("!!document.querySelector('.pm-settings')"), '保存后配置窗口还开着（能继续点测试连接）')
  await click(byText('.pm-settings', 'button', '测试连接'), '测试连接')
  await until(() => main.eval("!!document.querySelector('.pm-settings .pm-start-chat button')"), 200)
  await shot('connected')
  check(await main.eval("(document.querySelector('.pm-settings')?.innerText||'').includes('连接测试通过')"), '测试连接通过，并出现「开始对话」')
  const nodesBefore = await main.eval("window.__store.getState().canvas.frames.flatMap(f=>f.nodes).length")
  await click("document.querySelector('.pm-settings .pm-start-chat button')", '开始对话')
  const leafId = await until(() => main.eval(`(()=>{const ns=window.__store.getState().canvas.frames.flatMap(f=>f.nodes);return ns.length>${nodesBefore}?ns.at(-1).leafId:null})()`))
  await wait(1200)
  check(await main.eval("!document.querySelector('.pm-back')&&!document.querySelector('.pm-settings')"), '点「开始对话」后市场与配置都收起')
  const pane = `document.querySelector('[data-leaf-id="${leafId}"]')`
  const draft = await until(() => main.eval(`${pane}?.querySelector('[contenteditable="true"]')?.innerText||''`))
  await shot('chat-opened')
  check(draft.includes('用 GitHub 插件看看'), '新对话里已预填示例问题（没有自动发送）')
  check(await main.eval(`(${pane}?.innerText||'').includes('GitHub（只读）')`), '新对话标明接好了「GitHub（只读）」')
  // ④ 用户只按发送
  await click(`${pane}.querySelector('[contenteditable="true"]')`, '输入框')
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 })
  let started = false
  for (let i = 0; i < 150; i++) {
    await wait(2000)
    const busy = await main.eval(`/正在处理|思考中/.test(${pane}?.innerText||'')`)
    if (busy) started = true
    if (started && !busy) break
  }
  await wait(1500)
  const text = await main.eval(`${pane}?.innerText||''`)
  notes.tools = [...new Set(text.match(/mcp__github__[a-z_]+/g) || [])]
  await shot('answered')
  check(notes.tools.length > 0, `AI 用 GitHub 插件回答了示例问题（调用 ${notes.tools.join('、')}）`)
  // ⑤ 另一条路：侧边「插件」里直接点 GitHub 卡片
  await click("document.querySelector('.wk-edge-guide')", '侧边抽屉')
  await click("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件'))", '插件分页')
  const drawerCard = "[...document.querySelectorAll('.mk-card')].find(e=>e.textContent.includes('GitHub（只读）'))"
  await until(() => main.eval('!!' + drawerCard))
  await shot('drawer-card')
  check(await main.eval(drawerCard + ".innerText.includes('点击开始对话')"), '侧边「插件」里的 GitHub 卡片写着「点击开始对话」')
  const beforeCard = await main.eval("window.__store.getState().canvas.frames.flatMap(f=>f.nodes).length")
  await click(drawerCard + ".querySelector('.mk-card-open')", 'GitHub 卡片')
  const cardLeaf = await until(() => main.eval(`(()=>{const ns=window.__store.getState().canvas.frames.flatMap(f=>f.nodes);return ns.length>${beforeCard}?ns.at(-1).leafId:null})()`))
  await wait(1200)
  await shot('drawer-chat')
  check(await main.eval(`(document.querySelector('[data-leaf-id="${cardLeaf}"]')?.innerText||'').includes('GitHub（只读）')`), '点卡片新开了一个接好 GitHub 的对话')
  // ⑥ @ 引用插件时的提示指向真正走得通的路
  const cardPane = `document.querySelector('[data-leaf-id="${cardLeaf}"]')`
  await click(`${cardPane}.querySelector('[contenteditable="true"]')`, '输入框')
  await main.send('Input.insertText', { text: '@' })
  await wait(1500)
  const hint = await main.eval(`[...document.querySelectorAll('.ac-mentions-row[aria-disabled="true"]')].map(e=>e.getAttribute('title')||e.innerText).join(' | ')`)
  notes.atHint = hint.slice(0, 300)
  await shot('at-hint')
  check(/Frame 上右键|侧边「插件」/.test(hint) || hint === '', `@ 里其他插件的提示指向真实入口${hint === '' ? '（这次候选里没有被禁用的插件，未看到提示）' : ''}`)
  check(!logs.includes(token), '应用日志里没有令牌')
} catch (e) {
  failure = String(e.message || e)
  try { await shot('failure') } catch {}
} finally {
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: !failure, failure, checks, notes, scope: 'New-user onboarding: only real mouse clicks on visible controls, from market install to the first answer.' }, null, 2).split(token).join('[REDACTED]'))
  console.log(failure ? '未通过：' + failure : '全部通过')
  child.kill(); server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(failure ? 1 : 0)
}
