// 发布台上架市场前的隔离验收（2026-10-01）。
//   EAS_APP_ROOT=<带 out/ 与 node_modules 的应用目录> EAS_LABEL=<截图前缀> node scripts/verify-publish-desk-market.mjs
// 候选目录（线上 8 项原样 + 发布台）由本地 HTTP 服务提供，eas.biily.top/plugins/* 重定向过去；不连生产市场。
// 只点屏幕上看得见的按钮（CDP Input）。正式凭证目录被 sandbox-exec 拒绝，插件装进临时 HOME。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

const appRoot = process.env.EAS_APP_ROOT || process.cwd(), label = process.env.EAS_LABEL || 'main'
const candidate = process.env.EAS_CANDIDATE || '/tmp/pd-candidate'
const out = path.join(process.cwd(), 'docs/verification/plugin-marketplace/publish-desk-20261001')
fs.mkdirSync(out, { recursive: true })
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-pdmk-')))
const profile = path.join(tmp, 'profile'), home = path.join(tmp, 'home'), project = path.join(tmp, 'project')
for (const p of [profile, home, project]) fs.mkdirSync(p)
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'pdmk', name: '我的项目', path: project }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
const requests = []
const server = http.createServer((req, res) => {
  requests.push(req.url)
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/plugins\//, '/')
  const file = path.join(candidate, rel)
  if (!file.startsWith(candidate) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return }
  res.end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const bootstrap = path.join(tmp, 'launch.cjs')
fs.writeFileSync(bootstrap, `require('os').homedir=()=>${JSON.stringify(home)};
const {app,dialog,session}=require('electron');app.setAppPath(${JSON.stringify(appRoot)});
// 脚本方式启动时 app.getVersion() 是 Electron 自己的版本（37.x），会让任何 minHostVersion 都放行；正式包里它是 package.json 的版本
app.getVersion=()=>${JSON.stringify(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version)};
dialog.showMessageBox=async()=>({response:1});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://eas.biily.top/plugins/*']},(d,cb)=>cb({redirectURL:${JSON.stringify('http://127.0.0.1:' + port)}+new URL(d.url).pathname})));
require(${JSON.stringify(path.join(appRoot, 'out/main/index.js'))});`)
const env = { ...process.env, EAS_VERIFY: '1', EAS_PLUGIN_REGISTRY_URL: `http://127.0.0.1:${port}/v2/registry.json` }
for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || k === 'EAS_PTY_ID' || k === 'EAS_PROJECT' || /TOKEN|API_KEY|SECRET|PASSWORD/.test(k)) delete env[k]
const policy = '(version 1) (allow default) ' + ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map((n) => '(deny file-read* file-write* (subpath ' + JSON.stringify(path.join(os.homedir(), n)) + '))').join(' ')
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, path.join(appRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), bootstrap, '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''; child.stdout.on('data', (b) => (logs += b)); child.stderr.on('data', (b) => (logs += b))
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), checks = [], notes = { label, appRoot }
let step = 0, main, failure
const check = (v, n) => { if (!v) throw Error(n); checks.push(n); console.log('✓', n) }
async function until(fn, n = 200, ms = 150) { for (let i = 0; i < n; i++) { const v = await fn(); if (v) return v; await wait(ms) } throw Error('Timed out') }
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0; const pending = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })) })
  return { send, eval: async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value } }
}
const shot = async (name) => { const s = await main.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${label}-${String(++step).padStart(2, '0')}-${name}.png`), Buffer.from(s.data, 'base64')) }
async function click(sel, what) {
  const at = await until(() => main.eval(`(()=>{const e=${sel};if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();if(r.width<2||r.height<2)return null;const x=r.x+r.width/2,y=r.y+r.height/2;if(x<0||y<0||x>innerWidth||y>innerHeight)return null;const top=document.elementFromPoint(x,y);if(!top||!(e===top||e.contains(top)))return null;return [x,y]})()`), 120)
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] })
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  notes.clicks = [...(notes.clicks ?? []), what]
  await wait(600)
}
try {
  const debug = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (child.exitCode !== null) throw Error(logs.slice(-1500)) } })
  main = await connect((await until(async () => (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))).webSocketDebuggerUrl)
  await main.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await until(() => main.eval('!!window.api?.plugins'))
  notes.hostVersion = await main.eval('window.api.app?.version?.() ?? null').catch(() => null)
  await main.eval("document.querySelectorAll('.skill-mask button').forEach(b=>{if(/以后再说/.test(b.textContent))b.click()})")
  await wait(800)
  await click("document.querySelector('.wk-edge-guide')", '侧边抽屉')
  await click("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件'))", '插件分页')
  await click("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场'))", '查看完整插件市场')
  const card = "[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('发布台'))"
  await until(() => main.eval(`!!${card}`), 200)
  const names = await main.eval("[...document.querySelectorAll('.pm-card')].map(e=>e.querySelector('.pm-name,.pm-card-name,h3,strong')?.textContent?.trim()||e.textContent.trim().slice(0,12))")
  notes.cards = names
  check(['番茄钟', '看板', 'Excel', 'Word', 'PowerPoint', '本地文件', '时间线', 'Jev', '发布台'].every((n) => names.some((x) => x.includes(n))), `市场列出线上原有 8 项和发布台（共 ${names.length} 张卡片）`)
  await main.eval(`${card}.scrollIntoView({block:'center'})`); await wait(300)
  notes.cardText = await main.eval(`${card}.textContent.replace(/\\s+/g,' ').trim()`)
  console.log('  卡片：', notes.cardText)
  await shot('market-card')
  await click(card, '发布台卡片')
  await wait(800)
  notes.detailText = await main.eval("(document.querySelector('.pm-detail,.pm-modal-detail,[role=dialog]')||document.body).innerText.replace(/\\s+/g,' ').slice(0,600)")
  console.log('  详情：', notes.detailText.slice(0, 300))
  await shot('detail')
  const installable = await main.eval("[...document.querySelectorAll('button')].some(b=>/^(\\+\\s*)?安装(插件)?$/.test(b.textContent.trim())&&!b.disabled&&b.offsetParent)")
  notes.installable = installable
  if (label === 'v0.4.119') {
    // 旧宿主列表里可能照样显示按钮；真点下去，必须在写文件前被最低版本挡住
    if (installable) {
      // 列表卡片里的「安装」被详情页盖着也算 offsetParent，只取最上层点得到的那个
      await click("[...document.querySelectorAll('button')].find(b=>{if(!/^(\\+\\s*)?安装(插件)?$/.test(b.textContent.trim())||b.disabled)return false;const r=b.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(t===b||b.contains(t))})", '安装插件')
      await wait(800)
      const confirm = await main.eval("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认安装'&&!b.disabled&&b.offsetParent)")
      if (confirm) await click("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认安装'&&!b.disabled&&b.offsetParent)", '确认安装')
      await wait(2500)
    }
    notes.afterText = await main.eval("document.body.innerText.replace(/\\s+/g,' ').match(/需要软件 0\\.4\\.120 或更高版本/)?.[0]??''")
    console.log('  点安装后：', notes.afterText)
    await shot('after-install-click')
    check(!fs.existsSync(path.join(home, '.eas/plugins/publish-desk')), '0.4.119：没有装上发布台（最低版本 0.4.120 挡住）')
    check(notes.afterText === '需要软件 0.4.120 或更高版本', '0.4.119：界面提示「需要软件 0.4.120 或更高版本」')
  } else {
    check(/内置副本/.test(notes.cardText) && /v0\.1\.0/.test(notes.cardText), '新版：卡片显示「已安装 v0.1.0 · 内置副本」')
    check(/14 个平台|违禁词/.test(notes.detailText) && !/开发者暂未提供使用场景/.test(notes.detailText), '新版：详情页有场景、步骤和工具说明')
    // 内置插件的「安装独立版」= 装一份能从市场单独更新的副本，真点一遍走完两段式安装
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='安装独立版'&&!b.disabled&&b.offsetParent)", '安装独立版')
    notes.confirmText = await main.eval("document.body.innerText.replace(/\\s+/g,' ').match(/.{0,80}(权限|确认安装).{0,160}/)?.[0]??''")
    await shot('confirm')
    check(!fs.existsSync(path.join(home, '.eas/plugins/publish-desk')), '新版：点确认之前没有写任何文件')
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认安装'&&!b.disabled&&b.offsetParent)", '确认安装')
    const manifest = path.join(home, '.eas/plugins/publish-desk/plugin.json')
    await until(() => fs.existsSync(manifest), 200)
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    check(m.version === '0.1.0' && m.requirements?.minHostVersion === '0.4.120', '新版：独立版装进临时 HOME，版本 0.1.0、带最低宿主版本')
    await wait(1200)
    notes.afterText = await main.eval(`(${card})?.textContent.replace(/\\s+/g,' ').trim() ?? ''`)
    await shot('installed')
    check(requests.some((u) => u.includes('publish-desk-0.1.0.zip')), '新版：安装包从（重定向后的）市场地址下载')
  }
} catch (e) { failure = e; console.error('未通过：', e.message); try { await shot('failure') } catch {} }
finally {
  notes.requests = requests
  fs.writeFileSync(path.join(out, `${label}-result.json`), JSON.stringify({ passed: !failure, checks, failure: failure?.message, notes }, null, 2))
  child.kill(); server.close()
}
process.exitCode = failure ? 1 : 0
console.log(failure ? '未通过' : '全部通过')
