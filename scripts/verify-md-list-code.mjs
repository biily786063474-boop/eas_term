// 隔离实例：AI 对话里「列表项下面跟代码块」的回答要渲染成代码块（2026-10-01 用户截图：命令被拍扁成普通段落、``` 原样显示）。
// 从主进程回放 agentChat 事件，不连模型。截图到 docs/verification/md-list-code/。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import assert from 'node:assert/strict'
const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-mdlist-')), profile = path.join(temp, 'p'), home = path.join(temp, 'h'), cwd = path.join(temp, 'proj')
const out = path.join(root, 'docs/verification/md-list-code'); for (const d of [profile, home, cwd, out]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--remote-debugging-port=0', '--inspect=9540', '--use-mock-keychain', '--user-data-dir=' + profile], { env: { ...process.env, HOME: home, EAS_VERIFY: '1' }, stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, n = 300) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout') }
async function connect(url) { const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }; const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) }); return { ws, send, ev: async (x) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description); return m.result.result.value } } }
const MSG = '要开这台服务器需要你确认扣款，我不会自己下单：\n\n1. **你自己在终端运行下面这条命令**。只买 1 个月，不自动续费：\n   ```bash\n   eas-secret run --vars ALIBABA_CLOUD_ACCESS_KEY_ID,ALIBABA_CLOUD_ACCESS_KEY_SECRET -- aliyun swas-open CreateInstances --region cn-hongkong --Period 1 --AutoRenew false\n   ```\n2. **在 Claude Code 的权限设置里放行**：允许以 `aliyun swas-open CreateInstances` 开头的命令。\n\n服务器开好后，后面的事不涉及扣款，我来做：\n\n- 装 SSH 密钥，关掉密码登录。\n- 防火墙只开 22 和 443。'
try {
  const dp = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } })
  const page = await connect((await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term') } catch { return null } })).webSocketDebuggerUrl)
  const main = await connect((await until(async () => { try { return (await (await fetch('http://127.0.0.1:9540/json/list')).json())[0] } catch { return null } })).webSocketDebuggerUrl)
  await until(() => page.ev('!!window.__store')); await wait(1500)
  for (let i = 0; i < 30; i++) { if (await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()")) break; await wait(100) }
  const sid = 'ac-mdlist-' + Date.now()
  await page.ev(`(()=>{window.__store.setState({viewMode:'split',projects:[{id:'p',name:'demo',path:${JSON.stringify(cwd)},addedAt:1}],tabs:[{id:'t',title:'AI',projectId:'p',cwd:${JSON.stringify(cwd)},activeLeafId:'l',root:{type:'leaf',id:'l',pane:{kind:'agent',cli:'claude',resumeCli:'claude',sessionId:'${sid}',cwd:${JSON.stringify(cwd)}}}}],activeTabId:'t'});return true})()`)
  await wait(2500)
  const E = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
  const emit = (e) => main.ev(`${E}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('agentChat:event',${JSON.stringify({ sessionId: sid, event: e })})`)
  await emit({ k: 'user.message', text: '帮我开一台香港的服务器' }); await emit({ k: 'turn.start' }); await emit({ k: 'text.done', text: MSG }); await emit({ k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } })
  await wait(1500)
  const r = await page.ev(`(()=>{const ol=[...document.querySelectorAll('ol.md-ol')];const cw=document.querySelector('li .md-codewrap');return {ols:ol.length,lis:ol[0]?.querySelectorAll(':scope>li').length,code:cw?.querySelector('code')?.textContent,lang:cw?.dataset.lang,hasCopy:!!cw?.querySelector('.md-copy'),rawFence:[...document.querySelectorAll('.md-view, .ac-msg, body')].some(e=>/\`\`\`/.test(e.innerText))}})()`)
  console.log(JSON.stringify(r, null, 1))
  assert.equal(r.ols, 1); assert.equal(r.lis, 2); assert.equal(r.lang, 'bash'); assert.ok(r.hasCopy); assert.ok(r.code.startsWith('eas-secret run')); assert.equal(r.rawFence, false)
  await page.ev("document.querySelector('li .md-codewrap').scrollIntoView({block:'center'});true"); await wait(500)
  fs.writeFileSync(path.join(out, 'chat-list-code.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
  console.log('PASS')
} finally { app.kill('SIGTERM'); await wait(1500); try { app.kill('SIGKILL') } catch {}; fs.rmSync(temp, { recursive: true, force: true }) }
