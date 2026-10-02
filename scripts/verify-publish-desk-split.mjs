// 隔离实例：发布台分屏（2026-10-02，spec docs/superpowers/specs/2026-10-02-发布台分屏-design.md 第三部分）。
// 全程真实鼠标：Input.dispatchMouseEvent 打在主页面上，坐标 = 面板 iframe 在主页面的 rect + 按钮在 iframe 里的 rect，
// 再断言命中的就是那个 iframe（没被别的东西挡住）。插件面板是 OOPIF（eas-plugin://），各自是 /json/list 里的独立 target。
// 剪贴板经主进程 inspector 读（--inspect=0，从 stderr 拿地址）；跑前存下用户剪贴板，跑完还回去。
// 数据经插件自己的 server.mjs 写（deskCall，同 verify-publish-desk-live.mjs），不连模型、不碰真实数据。
// 第 9 步另起一个隔离实例，带 EAS_SPLIT_DISABLED=1（preload 只在 EAS_VERIFY=1 时认它）模拟不声明分屏的旧宿主。
// 用法：先 npx electron-vite build；结果与截图到 docs/verification/publish-desk-split/（EAS_VERIFY_OUTPUT 可改）。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import assert from 'node:assert/strict'

const root = process.cwd()
const out = path.join(root, process.env.EAS_VERIFY_OUTPUT ?? 'docs/verification/publish-desk-split'); fs.mkdirSync(out, { recursive: true })
const temps = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, label, n = 300) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout: ' + label) }
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const P = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }
  const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) })
  const ev = async (x) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description ?? 'eval failed: ' + x.slice(0, 80)); return m.result?.result?.value }
  return { ws, send, ev, close: () => ws.close() }
}

const PLATFORMS = ['xiaohongshu', 'douyin', 'bilibili', 'zhihu', 'x', 'channels', 'reddit', 'linkedin']
const CARDS = [
  { platform: 'xiaohongshu', title: '终端里也能看清 AI 生成的图了', body: '点开居中、看原图、滚轮缩放。', tags: ['效率工具', 'AI'] },
  { platform: 'douyin', title: '30 秒看懂 Eas-Term', body: '画布、终端、对话放在一起。', tags: ['AI'] },
  { platform: 'bilibili', title: 'Eas-Term 0.4.124：发布台分屏', body: '演示：一键铺满六个发布页。' },
  { platform: 'zhihu', title: '为什么我把发布页放进了画布', body: '知乎正文：同屏六格，顶上一条就能复制文案。' },
  { platform: 'x', title: '', body: 'Eas-Term: open six publish pages side by side.' },
  { platform: 'channels', title: '发布台分屏', body: '视频号 30 秒演示。' },
  { platform: 'reddit', title: 'I put six publish pages on one canvas', body: 'Feedback welcome.' },
  { platform: 'linkedin', title: 'Split view for publishing', body: 'Shipping split view.' }
]
const cardOf = (p) => CARDS.find((c) => c.platform === p)

/** 起一个隔离实例。extraEnv 给第 9 步用（EAS_SPLIT_DISABLED=1） */
async function launch(profile, home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, EAS_VERIFY: '1', ...extraEnv }
  for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)) delete env[k]
  if (!extraEnv.EAS_SPLIT_DISABLED) delete env.EAS_SPLIT_DISABLED
  try { fs.rmSync(path.join(profile, 'DevToolsActivePort')) } catch {}
  const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--remote-debugging-port=0', '--inspect=0', '--use-mock-keychain', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''; app.stderr.on('data', (d) => { err += d })
  const inspectUrl = await until(() => /ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/.exec(err)?.[0], 'main inspector')
  const dp = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } }, 'devtools port')
  const list = async () => { try { return await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json() } catch { return [] } }
  const page = await connect((await until(async () => (await list()).find((x) => x.type === 'page' && x.title === 'Eas-Term'), 'main page')).webSocketDebuggerUrl)
  const main = await connect(inspectUrl)
  const E = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
  await until(() => page.ev('!!window.__store&&!!window.api?.plugins'), 'store')
  // 窗口默认只有 1147×656，六格铺满后每格太小；放大到 1600×1000（屏幕放不下时系统会夹）
  await main.ev(`(()=>{const w=${E}.BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Eas-Term');w.setSize(1600,1000);w.center();return true})()`)
  // 本机前台是跑脚本的终端：不开焦点模拟的话 activeElement 判定会失真（见 memory eas-term-cdp 第 13 条）
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await wait(1500)
  for (let i = 0; i < 30; i++) { if (await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()")) break; await wait(100) }
  const stop = async (signal = 'SIGTERM') => { page.close(); main.close(); const exited = new Promise((r) => app.once('exit', r)); app.kill(signal); await Promise.race([exited, wait(5000)]); try { app.kill('SIGKILL') } catch {} }
  return { app, page, main, E, list, stop }
}

function deskCall(profile, calls) {
  const dataDir = path.join(profile, 'plugin-data', 'publish-desk')
  const child = spawn(process.execPath, [path.join(root, 'resources/plugins/publish-desk/server.mjs')], { env: { ...process.env, EAS_PLUGIN_DATA: dataDir }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = '', id = 0; const pending = new Map()
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id !== undefined) pending.get(m.id)?.(m) } catch {} } })
  const req = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n') })
  return (async () => {
    await req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify', version: '1' } })
    const res = []
    for (const [name, args] of calls) { const m = await req('tools/call', { name, arguments: args }); if (m.result?.isError || m.error) throw Error(name + ' failed: ' + JSON.stringify(m)); res.push(m.result?.structuredContent) }
    child.kill()
    return res
  })()
}

function freshProfile(tag) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-split-' + tag + '-')); temps.push(temp)
  const profile = path.join(temp, 'p'), home = path.join(temp, 'h'), proj = path.join(temp, 'proj')
  for (const d of [profile, home, proj]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: 'zh' }))
  fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'p', name: 'demo', path: proj, addedAt: 1 }]))
  return { profile, home }
}

/** 一个 App 实例上的操作集合 */
function ops(inst) {
  const { page, main, E, list } = inst
  const panelTargets = async () => (await list()).filter((x) => x.url.startsWith('eas-plugin://'))
  /** 找主面板（有 #batch）与各格（有 #row，按平台名认）；返回 { url, conn } */
  const conns = new Map()
  const conn = async (t) => { if (!conns.has(t.id)) conns.set(t.id, await connect(t.webSocketDebuggerUrl)); return conns.get(t.id) }
  async function findPanel(pred, label) {
    return until(async () => {
      for (const t of await panelTargets()) {
        try { const c = await conn(t); if (await c.ev(pred)) return { url: t.url, c } } catch {}
      }
      return null
    }, label)
  }
  const mainPanel = () => findPanel("!!document.getElementById('batch')&&!!document.getElementById('status')", 'main panel target')
  const cellPanel = (name) => findPanel(`document.querySelector('#row .name')?.textContent===${JSON.stringify(name)}`, 'cell target ' + name)
  const cellNames = async () => {
    const names = []
    for (const t of await panelTargets()) { try { const n = await (await conn(t)).ev("document.querySelector('#row .name')?.textContent||''"); if (n) names.push(n) } catch {} }
    return names.sort()
  }
  /** 真实点击：iframe 内元素中心 → 主页面坐标（乘上画布缩放），先断言命中的是这个 iframe */
  async function realClick(panel, sel) {
    const r = await panel.c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height,text:e.textContent}})()`)
    assert.ok(r && r.w > 0 && r.h > 0, `面板里找到可见的 ${sel}`)
    const fr = await page.ev(`(()=>{const u=${JSON.stringify(panel.url)};const f=[...document.querySelectorAll('iframe')].find(f=>f.src===u||f.src.replace(/\\/$/,'')===u.replace(/\\/$/,''));if(!f)return null;const b=f.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height,cw:f.clientWidth,ch:f.clientHeight}})()`)
    assert.ok(fr, '主页面里找到面板 iframe ' + panel.url)
    const s = fr.w / fr.cw
    const x = Math.round(fr.l + r.x * s), y = Math.round(fr.t + r.y * s)
    const hit = await page.ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?.tagName==='IFRAME'?e.src:(e?.className||e?.tagName||null)})()`)
    assert.ok(typeof hit === 'string' && hit.replace(/\/$/, '') === panel.url.replace(/\/$/, ''), `点击点 (${x},${y}) 命中的是面板 iframe（实际：${hit}）`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    return { x, y, scale: +s.toFixed(3), text: r.text }
  }
  // 状态栏会被随后的重绘（文件监听 refresh）改回汇总行，所以记下出现过的每一条，断言「出现过」
  const status = (panel) => panel.c.ev("(()=>{const el=document.getElementById('status');if(el&&!window.__stSeen){window.__stSeen=[el.textContent];new MutationObserver(()=>window.__stSeen.push(el.textContent)).observe(el,{childList:true,characterData:true,subtree:true})}return (window.__stSeen||[]).join(' ¦ ')})()")
  const S = (expr) => page.ev(`(()=>{const s=window.__store.getState();${expr}})()`)
  const splitFrame = () => S("const f=s.canvas.frames.find(f=>f.owner?.purpose==='split');return f?{id:f.id,name:f.name,parentId:f.parentId,owner:f.owner,x:f.x,y:f.y,w:f.w,h:f.h,cells:f.nodes.filter(n=>n.pane?.kind==='web'&&n.pane.companion).map(n=>({id:n.id,key:n.pane.companion.key,url:n.pane.url,openedAt:n.pane.companion.openedAt,x:n.x,y:n.y,panelId:n.pane.companion.panelId,props:n.pane.companion.props}))}:null")
  const clip = () => main.ev(`${E}.clipboard.readText()`)
  const setClip = (t) => main.ev(`${E}.clipboard.writeText(${JSON.stringify(t)}),true`)
  const shot = async (name) => fs.writeFileSync(path.join(out, name + '.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
  const closeConns = () => { for (const c of conns.values()) c.close(); conns.clear() }
  return { mainPanel, cellPanel, cellNames, realClick, status, S, splitFrame, clip, setClip, shot, closeConns, panelTargets }
}

async function openDeskPanel(inst) {
  const pluginId = await until(() => inst.page.ev("window.api.plugins.list().then(l=>l.find(p=>p.name==='publish-desk'&&p.enabled!==false)?.id)"), 'publish-desk plugin')
  await inst.page.ev(`(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('p',40,40);const f=window.__store.getState().canvas.frames.at(-1);s.addComponentNode(f.id,'plugin-panel',16,50,560,780,{pluginId:${JSON.stringify(pluginId)},panelId:'main'});s.setViewport({x:0,y:0,scale:1});return true})()`)
  return pluginId
}

const result = { checks: {} }
let userClip = null, clipOwner = null
let inst = null
try {
  const A = freshProfile('a')
  inst = await launch(A.profile, A.home)
  let o = ops(inst)
  userClip = await o.clip(); clipOwner = o
  assert.ok(await inst.page.ev("!!document.querySelector('.canvas-viewport')||true"))
  const pluginId = await openDeskPanel(inst)
  let desk = await o.mainPanel()
  await until(async () => (await o.status(desk)).length > 0, 'panel first render')

  // ① 8 张有文案的卡片：1 张不发（reddit）、1 张已发布（linkedin）→ 可发 6 张
  const [batch] = await deskCall(A.profile, [['desk_add_batch', { title: '分屏验收批次', platforms: PLATFORMS, cards: CARDS }]])
  const batchId = batch.batchId
  await deskCall(A.profile, [['desk_mark', { batchId, platform: 'reddit', status: 'skipped' }], ['desk_mark', { batchId, platform: 'linkedin', status: 'published', url: 'https://www.linkedin.com/feed/update/1' }]])
  await until(() => desk.c.ev("document.querySelectorAll('section.card').length===6&&!!document.getElementById('split-open')&&!document.getElementById('split-open').disabled"), 'panel shows 6 todo cards and enabled split button')
  const todoOrder = await desk.c.ev("[...document.querySelectorAll('section.card [data-open]')].map(b=>b.dataset.open)")
  result.checks.c1 = { todoOrder, cards: CARDS.length, skipped: 'reddit', published: 'linkedin', todoCards: 6, splitButton: true }

  // ② 真实点击「分屏打开」
  const click2 = await o.realClick(desk, '#split-open')
  const sf = await until(async () => { const f = await o.splitFrame(); return f && f.cells.length === 6 ? f : null }, 'split frame with 6 cells')
  await wait(400)
  const vp = await o.S("const v=s.canvas.viewport;const e=document.querySelector('.canvas-viewport');return {x:v.x,y:v.y,scale:v.scale,vw:e?.clientWidth,vh:e?.clientHeight}")
  const want = Math.min(1, (vp.vw * 0.96) / sf.w, (vp.vh * 0.96) / sf.h)
  const parent = await o.S(`return s.canvas.frames.find(f=>f.id===${JSON.stringify(sf.parentId)})?.projectId`)
  const onScreen = { left: vp.x + sf.x * vp.scale, top: vp.y + sf.y * vp.scale, right: vp.x + (sf.x + sf.w) * vp.scale, bottom: vp.y + (sf.y + sf.h) * vp.scale }
  assert.equal(sf.owner.pluginId, pluginId); assert.equal(sf.owner.purpose, 'split'); assert.equal(parent, 'p', '分屏是项目 Frame 的子 Frame')
  assert.deepEqual(sf.cells.map((c) => c.key), todoOrder.slice(0, 6), '格子 = min(6, 可发数)，按面板卡片顺序')
  assert.ok(sf.cells.every((c) => c.panelId === 'cell' && c.props.batchId === batchId), '每格 companion = cell 面板 + 批次')
  assert.ok(Math.abs(vp.scale - want) < 1e-6, `视口缩放 ${vp.scale} = 铺满算出的 ${want}`)
  assert.ok(onScreen.left >= -1 && onScreen.top >= -1 && onScreen.right <= vp.vw + 1 && onScreen.bottom <= vp.vh + 1, '分屏 Frame 整个在视口内')
  const fillW = (onScreen.right - onScreen.left) / vp.vw, fillH = (onScreen.bottom - onScreen.top) / vp.vh
  assert.ok(want === 1 || fillW > 0.9 || fillH > 0.9, `铺满：一边占满约 96%（宽 ${fillW.toFixed(3)} / 高 ${fillH.toFixed(3)}）`)
  const st2 = await until(async () => { const s = (await o.status(desk)).split(' ¦ ').findLast((x) => x.includes('已在分屏打开')); return s || null }, 'status opened')
  await until(async () => (await o.cellNames()).length === 6, '6 cell strips render')
  result.checks.c2 = { click: click2, frame: { id: sf.id, name: sf.name, w: sf.w, h: sf.h }, cells: sf.cells.map((c) => c.key), viewport: vp, expectedScale: want, onScreen, status: st2, strips: await o.cellNames() }
  await wait(1500); await o.shot('split-opened-dark')

  // ③ 再点一张已在分屏里的卡片（小红书）：不新开，flash 那一格
  await o.S('s.setViewport({x:0,y:0,scale:1});return true'); await wait(400)
  const xhsNode = sf.cells.find((c) => c.key === 'xiaohongshu').id
  await o.S('window.__flashSeen=[];window.__flashUnsub?.();window.__flashUnsub=window.__store.subscribe(st=>{if(st.flashNodeId)window.__flashSeen.push(st.flashNodeId)});return true')
  const click3 = await o.realClick(desk, '[data-open="xiaohongshu"]')
  const flashed = await until(() => inst.page.ev('window.__flashSeen.at(-1)||null'), 'flashNodeId set', 50).catch(async (e) => { throw Error(e.message + ' | status=' + (await o.status(desk)) + ' | cells=' + JSON.stringify((await o.splitFrame())?.cells.map((c) => c.key))) })
  const nowFlash = await o.S('return s.flashNodeId')
  const sf3 = await o.splitFrame()
  assert.equal(flashed, xhsNode, 'flashNodeId = 小红书那格')
  assert.equal(sf3.cells.length, 6, '格子数不变'); assert.deepEqual(sf3.cells.map((c) => c.id), sf.cells.map((c) => c.id), '节点一个没换')
  const st3 = await until(async () => { const s = (await o.status(desk)).split(' ¦ ').findLast((x) => x.includes('已在分屏中')); return s || null }, 'status reused')
  const flashClass = await inst.page.ev(`!!document.querySelector('.cfile-node.flash[data-node-id=${JSON.stringify(xhsNode)}]')`)
  await wait(1300)
  const flashAfter = await o.S('return s.flashNodeId')
  assert.equal(flashAfter, null, '约 1 秒后 flash 撤掉')
  result.checks.c3 = { click: click3, flashNodeId: flashed, flashAtCheck: nowFlash, flashClassOnNode: flashClass, flashClearedAfter1s: flashAfter === null, cells: sf3.cells.length, status: st3 }

  // ④ 把哔哩哔哩那格标已发布（外部写入，面板经文件监听刷新），再点不在分屏里的 Reddit
  await deskCall(A.profile, [['desk_mark', { batchId, platform: 'bilibili', status: 'published' }]])
  await o.S('s.setViewport({x:0,y:0,scale:1});return true'); await wait(300)
  await o.realClick(desk, '[data-filter="all"]')
  await until(() => desk.c.ev("document.querySelectorAll('section.card').length===8&&document.querySelector('section.card [data-open=\"bilibili\"]')?.closest('section.card')?.dataset.status==='published'"), 'all filter + bilibili published')
  const click4 = await o.realClick(desk, '[data-open="reddit"]')
  const sf4 = await until(async () => { const f = await o.splitFrame(); return f && f.cells.some((c) => c.key === 'reddit') ? f : null }, 'reddit in split')
  const st4 = await until(async () => { const s = (await o.status(desk)).split(' ¦ ').findLast((x) => x.includes('已替换')); return s || null }, 'status replaced')
  assert.equal(sf4.cells.length, 6)
  assert.ok(!sf4.cells.some((c) => c.key === 'bilibili'), '换掉的是已发布的哔哩哔哩，不是最早开的小红书')
  assert.ok(sf4.cells.some((c) => c.key === 'xiaohongshu'))
  const redditCell = sf4.cells.find((c) => c.key === 'reddit')
  assert.ok(!sf.cells.some((c) => c.id === redditCell.id), '替换进来的格子是新节点 id')
  assert.equal(redditCell.url, 'https://www.reddit.com/submit')
  assert.match(st4, /哔哩哔哩/)
  result.checks.c4 = { click: click4, cells: sf4.cells.map((c) => c.key), replacedOut: 'bilibili', redditNodeId: redditCell.id, status: st4 }
  await until(async () => (await o.cellNames()).includes('Reddit'), 'reddit strip renders')

  // ⑤ 小红书那格的头条：真实点击「复制标题」
  await wait(800)
  const xhs = await o.cellPanel('小红书')
  await o.setClip('__before__')
  const click5 = await o.realClick(xhs, '[data-copy="title"]')
  const copied = await until(async () => { const t = await o.clip(); return t !== '__before__' ? t : null }, 'clipboard written', 50)
  assert.equal(copied, cardOf('xiaohongshu').title)
  await until(() => xhs.c.ev("document.querySelector('[data-copy=\"title\"]')?.textContent==='已复制'"), 'button flashes 已复制', 30)
  result.checks.c5 = { click: click5, clipboard: copied }

  // ⑥ 同一格：标记已发布 → 确认；主面板那张卡变已发布
  await o.realClick(xhs, '[data-marking]')
  await until(() => xhs.c.ev("!!document.querySelector('[data-confirm]')"), 'confirm row')
  const click6 = await o.realClick(xhs, '[data-confirm]')
  await until(() => xhs.c.ev("!!document.querySelector('.pill.published')"), 'cell shows published')
  await until(() => desk.c.ev("document.querySelector('[data-open=\"xiaohongshu\"]')?.closest('section.card')?.dataset.status==='published'"), 'main panel card published')
  const [listed] = await deskCall(A.profile, [['desk_list', { batchId }]])
  assert.equal(listed.batch.cards.find((c) => c.platform === 'xiaohongshu').status, 'published', '数据文件里也是已发布')
  result.checks.c6 = { click: click6, cellPill: true, mainPanelCard: 'published', dataFile: 'published' }
  await o.S(`const f=s.canvas.frames.find(f=>f.id===${JSON.stringify(sf.id)});s.setViewport({x:0,y:0,scale:1});return true`)
  await wait(300)
  // 再对准分屏截图（暗）
  await o.S(`const f=s.canvas.frames.find(f=>f.owner?.purpose==='split');const e=document.querySelector('.canvas-viewport');const k=Math.min(1,e.clientWidth*.96/f.w,e.clientHeight*.96/f.h);s.setViewport({x:e.clientWidth/2-(f.x+f.w/2)*k,y:e.clientHeight/2-(f.y+f.h/2)*k,scale:k});return true`)
  await wait(1500); await o.shot('split-cells-dark')
  await inst.page.ev("window.__store.getState().setTheme('light');true"); await wait(1200)
  assert.equal(await xhs.c.ev('document.documentElement.dataset.theme'), 'light', '头条跟着切亮色')
  await o.shot('split-cells-light')
  await inst.page.ev("window.__store.getState().setTheme('dark');true"); await wait(600)

  // ⑦ 删掉主面板节点：头条照样能复制（知乎正文）
  await o.S(`const f=s.canvas.frames.find(f=>f.id===${JSON.stringify(sf.parentId)});const n=f.nodes.find(n=>n.component?.type==='plugin-panel'||n.component);s.removeNode(f.id,n.id);return true`)
  await until(async () => !(await o.panelTargets()).some((t) => t.url === desk.url), 'main panel target gone')
  assert.equal(await o.S(`return s.canvas.frames.find(f=>f.id===${JSON.stringify(sf.parentId)}).nodes.filter(n=>n.component).length`), 0, '主面板节点已删')
  const zh = await o.cellPanel('知乎')
  await o.setClip('__before7__')
  const click7 = await o.realClick(zh, '[data-copy="body"]')
  const copied7 = await until(async () => { const t = await o.clip(); return t !== '__before7__' ? t : null }, 'clipboard written after main removed', 50)
  assert.equal(copied7, cardOf('zhihu').body)
  result.checks.c7 = { click: click7, clipboard: copied7, mainPanelRemoved: true }

  // ⑧ 等画布落盘后杀进程，同一 profile 重启
  const persisted = () => { try { const c = JSON.parse(fs.readFileSync(path.join(A.profile, 'canvas.json'), 'utf8')); const f = c.frames?.find((f) => f.owner?.purpose === 'split'); const keys = (f?.nodes ?? []).filter((n) => n.pane?.companion).map((n) => n.pane.companion.key); const panels = c.frames.flatMap((f) => f.nodes).filter((n) => n.component).length; return f && keys.length === 6 && keys.includes('reddit') && panels === 0 ? { frame: f.id, keys } : null } catch { return null } }
  const canvasFile = await until(persisted, 'canvas.json has split frame + 6 companions, main panel removed', 200).catch(async (e) => { let c = null; try { c = JSON.parse(fs.readFileSync(path.join(A.profile, 'canvas.json'), 'utf8')) } catch {} ; throw Error(e.message + ' | ' + JSON.stringify(c?.frames?.map((f) => ({ id: f.id, owner: f.owner, nodes: f.nodes.map((n) => ({ c: n.component?.type, k: n.pane?.kind, comp: n.pane?.companion?.key })) })))) })
  o.closeConns(); await inst.stop('SIGKILL'); inst = null; clipOwner = null
  inst = await launch(A.profile, A.home)
  o = ops(inst); clipOwner = o
  const sf8 = await until(async () => { const f = await o.splitFrame(); return f && f.cells.length === 6 ? f : null }, 'split frame restored')
  assert.deepEqual(sf8.cells.map((c) => c.key).sort(), sf4.cells.map((c) => c.key).sort())
  assert.deepEqual(sf8.cells.map((c) => c.id).sort(), sf4.cells.map((c) => c.id).sort(), '节点 id 原样恢复')
  assert.equal(sf8.owner.purpose, 'split')
  await o.S(`const f=s.canvas.frames.find(f=>f.owner?.purpose==='split');s.setViewMode('canvas');const e=document.querySelector('.canvas-viewport');const k=Math.min(1,e.clientWidth*.96/f.w,e.clientHeight*.96/f.h);s.setViewport({x:e.clientWidth/2-(f.x+f.w/2)*k,y:e.clientHeight/2-(f.y+f.h/2)*k,scale:k});return true`)
  const names8 = await until(async () => { const n = await o.cellNames(); return n.length === 6 ? n : null }, '6 strips after restart')
  const xhs8 = await o.cellPanel('小红书')
  assert.ok(await until(() => xhs8.c.ev("!!document.querySelector('.pill.published')"), 'xhs strip still published'))
  result.checks.c8 = { canvasFile, cells: sf8.cells.map((c) => c.key), strips: names8, owner: sf8.owner }
  await wait(1500); await o.shot('restart-restored-dark')
  await inst.page.ev("window.__store.getState().setTheme('light');true"); await wait(1200); await o.shot('restart-restored-light')
  await o.setClip(userClip ?? ''); userClip = null
  o.closeConns(); await inst.stop(); inst = null; clipOwner = null

  // ⑨ 模拟旧宿主：EAS_SPLIT_DISABLED=1（preload 只在 EAS_VERIFY=1 时认它）
  const B = freshProfile('b')
  inst = await launch(B.profile, B.home, { EAS_SPLIT_DISABLED: '1' })
  o = ops(inst)
  assert.equal(await inst.page.ev('window.__easVerifyNoSplit'), true)
  await openDeskPanel(inst)
  const [b9] = await deskCall(B.profile, [['desk_add_batch', { title: '旧宿主批次', platforms: PLATFORMS, cards: CARDS }]])
  desk = await o.mainPanel()
  await until(() => desk.c.ev("document.querySelectorAll('section.card').length>0"), 'cards render (old host)')
  const noSplitBtn = await desk.c.ev("!document.getElementById('split-open')&&document.getElementById('split-slot')?.innerHTML===''")
  assert.ok(noSplitBtn, '旧宿主：没有「分屏打开」')
  const webBefore = await o.S("return s.canvas.frames.flatMap(f=>f.nodes).filter(n=>n.pane?.kind==='web').length")
  await o.status(desk)
  const click9 = await o.realClick(desk, '[data-open="zhihu"]')
  const web9 = await until(async () => { const n = await o.S("return s.canvas.frames.flatMap(f=>f.nodes).filter(n=>n.pane?.kind==='web').map(n=>({url:n.pane.url,companion:!!n.pane.companion}))"); return n.length > webBefore ? n : null }, 'open-link web node')
  const st9 = await until(async () => { const s = (await o.status(desk)).split(' ¦ ').findLast((x) => x.includes('已在画布打开')); return s || null }, 'status open-link', 100).catch(async (e) => { throw Error(e.message + ' | status=' + (await o.status(desk))) })
  assert.equal(await o.splitFrame(), null, '旧宿主：没有分屏 Frame')
  assert.ok(web9.some((n) => n.url.startsWith('https://zhuanlan.zhihu.com/write') && !n.companion), '退回 ui/open-link：普通网页节点、无头条')
  result.checks.c9 = { batchId: b9.batchId, splitButton: false, click: click9, webNodes: web9, status: st9 }
  await wait(1200); await o.shot('old-host-fallback-dark')
  o.closeConns(); await inst.stop(); inst = null

  result.checks.c10 = { screenshots: fs.readdirSync(out).filter((f) => f.endsWith('.png')).sort() }
  result.passed = true
  console.log(JSON.stringify(result, null, 1)); console.log('PASS')
} catch (e) {
  result.passed = false; result.error = String(e?.stack ?? e)
  console.error(e); process.exitCode = 1
} finally {
  if (userClip !== null && clipOwner) { try { await clipOwner.setClip(userClip) } catch {} }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1))
  if (inst) { try { await inst.stop() } catch {} }
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true })
}
