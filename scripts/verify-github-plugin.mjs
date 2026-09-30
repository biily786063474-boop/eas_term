// GitHub（只读）插件真实账号验收（2026-09-30）。用法：
//   eas-secret run --vars GITHUB_READONLY_TEST_TOKEN -- node scripts/verify-github-plugin.mjs
// 先 `EAS_PLUGIN_OUT_ROOT=/tmp/gh-registry-candidate node scripts/build-plugin-registry.mjs` 生成本地候选目录，再 npm run build。
// 真实：隔离 Electron（sandbox-exec 拒读 ~/.claude ~/.codex ~/.eas 等）、真实市场 UI 两段式安装、真实配置表单 + safeStorage、
//       真实 shim 子进程 → 宿主 → GitHub 官方远程 MCP（真实 TLS、真实账号）。
// 替身：只把包下载地址 eas.biily.top/plugins/github/* 重定向到本地候选目录；原生确认框一律确认并记录标题。
// 令牌只从环境变量读、只经 CDP 填进密码框，任何输出与日志检查里都不出现（最后断言应用日志不含令牌）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { McpClient } from '../src/main/mcpClient.ts'

const token = process.env.GITHUB_READONLY_TEST_TOKEN
if (!token) { console.error('缺 GITHUB_READONLY_TEST_TOKEN（用 eas-secret run 包裹）'); process.exit(2) }
const root = process.cwd(), candidate = process.env.EAS_GITHUB_CANDIDATE || '/tmp/gh-registry-candidate'
const out = path.join(root, 'docs/verification/plugin-marketplace/github')
fs.mkdirSync(out, { recursive: true })
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-github-')))
const profile = path.join(tmp, 'profile'), home = path.join(tmp, 'home')
for (const p of [profile, home]) fs.mkdirSync(p)
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'gh-fixture', name: 'GitHub验收', path: tmp }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))

// 本地候选市场：v2 目录 + 包
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/plugins\//, '/')
  const file = path.join(candidate, rel)
  if (!file.startsWith(candidate) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return }
  res.end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const dialogs = []
const bootstrap = path.join(tmp, 'launch.cjs'), dialogLog = path.join(tmp, 'dialogs.jsonl')
fs.writeFileSync(bootstrap, `require('os').homedir=()=>${JSON.stringify(home)};
const {app,dialog,session}=require('electron');app.setAppPath(${JSON.stringify(root)});
dialog.showMessageBox=async(_w,o)=>{const opts=o||_w;require('fs').appendFileSync(${JSON.stringify(dialogLog)},JSON.stringify({title:opts.title||'',message:opts.message||''})+'\\n');return {response:1}};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://eas.biily.top/plugins/github/*']},(d,cb)=>cb({redirectURL:${JSON.stringify('http://127.0.0.1:' + port)}+new URL(d.url).pathname})));
require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`)
const env = { ...process.env, EAS_VERIFY: '1', EAS_PLUGIN_REGISTRY_URL: `http://127.0.0.1:${port}/v2/registry.json` }
for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|API_KEY|SECRET|PASSWORD/.test(k)) delete env[k]
const policy = '(version 1) (allow default) ' + ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map((n) => '(deny file-read* file-write* (subpath ' + JSON.stringify(path.join(os.homedir(), n)) + '))').join(' ')
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), bootstrap, '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''; child.stdout.on('data', (b) => (logs += b)); child.stderr.on('data', (b) => (logs += b))
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), checks = [], clients = []
const check = (v, n) => { if (!v) throw Error(n); checks.push(n); console.log('✓', n) }
async function until(fn, n = 200) { for (let i = 0; i < n; i++) { const v = await fn(); if (v) return v; await wait(150) } throw Error('Timed out') }
let main
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0; const pending = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })) })
  return { ws, send, eval: async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value } }
}
const shot = async (name) => { const s = await main.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name), Buffer.from(s.data, 'base64')) }
const credFiles = () => { try { return fs.readdirSync(path.join(profile, 'plugin-credentials')).filter((f) => f.startsWith('github-')) } catch { return [] } }
const shimCall = async (c, name, args = {}) => { try { return await c.request('tools/call', { name, arguments: args }) } catch (e) { return { isError: true, content: [{ type: 'text', text: String(e.message) }] } } }
let failure
try {
  const debug = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (child.exitCode !== null) throw Error(logs.slice(-1500)) } })
  main = await connect((await until(async () => (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))).webSocketDebuggerUrl)
  await until(() => main.eval('!!window.api?.plugins && !!window.__store'))
  check((await main.eval('window.api.secrets.setup("837194")')).ok, '隔离密钥柜建立并解锁')
  await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('gh-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
  await until(() => main.eval("!!document.querySelector('.wk-edge-guide')")); await main.eval("document.querySelector('.wk-edge-guide').click()")
  await until(() => main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))")); await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
  await until(() => main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))")); await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
  const card = "[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('GitHub（只读）'))"
  await until(() => main.eval('!!' + card))
  check(true, '候选市场列出「GitHub（只读）」（宿主已声明 mcp.remote / auth.bearer）')
  const installed = path.join(home, '.eas/plugins/github/plugin.json')
  await main.eval(card + ".querySelector('.pm-add').click()")
  await until(() => main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
  check(await main.eval("document.body.innerText.includes('api.githubcopilot.com')"), '安装确认列出网络权限 api.githubcopilot.com')
  check(!fs.existsSync(installed), '确认前没有落入插件目录')
  await shot('install-confirm.png')
  await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
  await until(() => fs.existsSync(installed))
  check(JSON.parse(fs.readFileSync(installed)).mcp.url.endsWith('/mcp/readonly'), '两段式安装完成，装的是只读地址')
  // 装完自动弹出配置：填令牌（只经 CDP，不打印）
  await until(() => main.eval("!!document.querySelector('.pm-settings input[type=password], [data-plugin-config=\"eas:github\"] input[type=password]')"))
  const input = "document.querySelector('.pm-settings input[type=password], [data-plugin-config=\"eas:github\"] input[type=password]')"
  await main.eval(`(()=>{const e=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(token)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const scope = "(document.querySelector('.pm-settings')||document.querySelector('[data-plugin-config=\"eas:github\"]'))"
  const click = (text) => main.eval(`[...${scope}.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`)
  await until(() => main.eval(`[...${scope}.querySelectorAll('button')].some(e=>e.textContent==='保存配置'&&!e.disabled)`))
  await click('保存配置'); await until(() => main.eval(`${scope}.innerText.includes('已保存到本机插件专属加密凭证库')`))   // panels.pluginCfg.savedMsg
  const files = credFiles()
  check(files.length > 0 && files.every((f) => !fs.readFileSync(path.join(profile, 'plugin-credentials', f), 'utf8').includes(token)), '令牌经系统加密落盘，文件里没有明文')
  check(await main.eval(`${input}.value===''`), '保存后密码框不回显')
  // 保存后设置弹窗会自行关闭；测试连接直接走按钮背后的同一个 IPC（plugins:configuration test）
  const tested = await main.eval("window.api.plugins.configuration('test','eas:github')")
  check(tested.ok && tested.tools > 0, `测试连接通过（真实 GitHub 只读服务，发现 ${tested.tools} 个工具）；返回 ${JSON.stringify(tested)}`)
  await shot('configured.png')
  // AI 走的路：真实 shim 子进程 → 宿主 → GitHub
  const endpoint = JSON.parse(fs.readFileSync(path.join(profile, 'mcp-endpoint.json')))
  const shimEnv = { PATH: process.env.PATH || '', EAS_PLUGIN: 'github', EAS_TERM_PORT: String(endpoint.port), EAS_TERM_TOKEN: endpoint.token }
  const c = new McpClient({ name: 'verify-github', command: process.execPath, args: [path.join(root, 'mcp/eas-plugin-shim.mjs')], cwd: tmp, env: shimEnv }); clients.push(c)
  await c.initialize('0.4.120')
  const tools = await c.request('tools/list', {})
  const list = tools.tools || []
  check(list.length > 0 && list.every((t) => t.annotations?.readOnlyHint !== false), `经宿主列出 ${list.length} 个工具，没有一个被服务端标为写操作`)
  check(!list.some((t) => /^(create|update|delete|merge|push)_/.test(t.name)), '工具里没有 create/update/delete/merge/push 类')
  const me = await shimCall(c, 'get_me')
  check(!me.isError, 'AI 调用路径 get_me 成功（真实账号）')
  // 关掉插件 = 断开，已绑定的 shim 不能再调
  await main.eval("window.api.plugins.setEnabled('eas:github',false)")
  const off = await shimCall(c, 'get_me')
  check(off.isError, '关掉插件后已绑定会话调用被拒')
  await main.eval("window.api.plugins.setEnabled('eas:github',true)")
  await c.initialize('0.4.120')
  check(!(await shimCall(c, 'get_me')).isError, '重新打开后重新连上可以调用')
  // 卸载 = 清掉本机令牌
  await c.close(); clients.length = 0
  const un = await main.eval("window.api.plugins.uninstall('github')")
  check(un.ok, '卸载成功')
  check(!fs.existsSync(path.join(home, '.eas/plugins/github')), '插件目录已删除')
  check(credFiles().length === 0, '本机保存的 GitHub 令牌文件已清除')
  check(!logs.includes(token), '应用日志里没有令牌')
} catch (e) {
  failure = String(e.message || e)
  try {
    await shot('failure.png')
    const dom = await main.eval("JSON.stringify({settings:!!document.querySelector('.pm-settings'),dialogs:[...document.querySelectorAll('dialog')].map(d=>d.className+'|'+d.open),pw:document.querySelectorAll('input[type=password]').length,cfg:[...document.querySelectorAll('[data-plugin-config]')].map(e=>e.dataset.pluginConfig),text:(document.querySelector('.pm-settings')||document.querySelector('dialog[open]')||document.body).innerText.slice(0,800)})")
    fs.writeFileSync(path.join(out, 'failure-dom.json'), dom.split(token).join('[REDACTED]'))
  } catch {}
} finally {
  const titles = fs.existsSync(dialogLog) ? fs.readFileSync(dialogLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).title) : []
  const result = { passed: !failure, failure, checks, nativeDialogs: titles, scope: 'Real isolated Electron (sandbox-exec), real market UI install from local candidate, real config form + safeStorage, real shim → host → GitHub remote MCP readonly with a real read-only token. Package download redirected to local candidate; native dialogs auto-confirmed.' }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
  if (failure) fs.writeFileSync(path.join(out, 'failure-log.txt'), logs.split(token).join('[REDACTED]').slice(-4000))
  console.log(failure ? '未通过：' + failure : '全部通过')
  for (const c of clients) try { await c.close() } catch {}
  child.kill(); server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(failure ? 1 : 0)
}
