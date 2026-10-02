// 用户手册配图（site/manual.html · site/en/manual.html）。
// 隔离实例 + 演示项目（假数据，不碰真实账号、不连模型），按清单逐张截图，输出 site/assets/manual-<lang>-<编号>.webp。
//   LANG_UI=zh node scripts/manual-shots.mjs     （默认 zh；en 出英文界面那套）
//   ONLY=07,08 node scripts/manual-shots.mjs     （只重拍某几张）
// 对话内容是从主进程回放的 agentChat:event（同 verify-bg-task-cd.mjs），不是真实 CLI 输出。
// 界面改版后跑一遍这个脚本即可重出配图；标注点坐标写在手册 HTML 里（百分比），改版后要对一遍。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn, execSync } from 'node:child_process'
const LANGV = process.env.LANG_UI === 'en' ? 'en' : 'zh'
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const root = process.cwd(), temp = `/tmp/eas-manual-${process.env.LANG_UI === 'en' ? 'en' : 'zh'}`
fs.rmSync(temp, { recursive: true, force: true })
const profile = path.join(temp, 'profile'), home = path.join(temp, 'home'), cwd = path.join(temp, 'notes-app'), wiki = path.join(temp, 'my-wiki')
const out = path.join(root, 'site/assets'), raw = path.join(temp, 'raw')
for (const d of [profile, home, cwd, wiki, raw]) fs.mkdirSync(d, { recursive: true })
// 终端提示符用中性的，别把本机用户名和主机名拍进手册
fs.writeFileSync(path.join(home, '.zshrc'), "PROMPT='notes-app %% '\nexport PS1='notes-app % '\n")
fs.writeFileSync(path.join(home, '.bashrc'), "export PS1='notes-app $ '\n")
const zh = LANGV === 'zh'

// ── 演示项目：一个小笔记应用，带几次提交和一个 tag ──
const sh = (c, dir = cwd) => execSync(c, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'demo', GIT_COMMITTER_EMAIL: 'demo@example.com' } })
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true }); fs.writeFileSync(path.join(cwd, p), s) }
w('package.json', JSON.stringify({ name: 'notes-app', version: '0.3.0', type: 'module' }, null, 2))
w('src/store.ts', "import { save } from './storage'\nexport interface Note { id: string; title: string; body: string }\nexport function addNote(list: Note[], n: Note): Note[] {\n  const next = [...list, n]\n  save(next)\n  return next\n}\n")
w('src/storage.ts', "import type { Note } from './store'\nexport function save(list: Note[]): void {\n  localStorage.setItem('notes', JSON.stringify(list))\n}\n")
w('src/ui/list.ts', "import { addNote } from '../store'\nexport function renderList(): string {\n  return '<ul class=\"notes\"></ul>'\n}\nexport const onAdd = addNote\n")
w('README.md', zh ? '# notes-app\n\n一个极简的笔记应用，用来演示 Eas-Term。\n\n## 功能\n\n- 新建、搜索笔记\n- 本地保存\n' : '# notes-app\n\nA tiny notes app used to demo Eas-Term.\n\n## Features\n\n- Create and search notes\n- Saved locally\n')
w('index.html', `<!doctype html><html><body style="font:16px -apple-system;margin:40px;background:#fafafa"><h1>notes-app</h1><p>${zh ? '今天的笔记' : "Today's notes"}</p><ul><li>${zh ? '写周报' : 'Write the weekly report'}</li><li>${zh ? '整理设计稿' : 'Tidy up the design files'}</li></ul></body></html>`)
fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(cwd, 'logo.png'))
sh('git init -q -b main && git add package.json src/store.ts src/storage.ts && git commit -qm "init: store and storage"')
sh('git add src/ui/list.ts && git commit -qm "feat: note list"'); sh('git tag v0.2.0')
sh('git add README.md index.html logo.png && git commit -qm "docs: readme and demo page"')
w('src/store.ts', fs.readFileSync(path.join(cwd, 'src/store.ts'), 'utf8') + "export const search = (list: Note[], q: string) => list.filter(n => n.title.includes(q))\n")

// ── 演示知识库 ──
const ww = (p, s) => { fs.mkdirSync(path.dirname(path.join(wiki, p)), { recursive: true }); fs.writeFileSync(path.join(wiki, p), s) }
ww('index.md', zh ? '# 我的知识库\n\n- [[写作方法]]\n- [[本地优先]]\n' : '# My wiki\n\n- [[Writing method]]\n- [[Local-first]]\n')
ww(zh ? 'methods/写作方法.md' : 'methods/Writing method.md', zh ? '---\ntags: [写作]\nsummary: 先列结论再展开\n---\n# 写作方法\n\n先写结论，再补理由。参见 [[本地优先]]。\n' : '---\ntags: [writing]\nsummary: Lead with the conclusion\n---\n# Writing method\n\nConclusion first, reasons after. See [[Local-first]].\n')
ww(zh ? 'domains/本地优先.md' : 'domains/Local-first.md', zh ? '---\ntags: [架构]\nsummary: 数据先存在本机\n---\n# 本地优先\n\n数据先落本机，再同步。\n' : '---\ntags: [architecture]\nsummary: Data lives on your machine first\n---\n# Local-first\n\nKeep data on the device first, then sync.\n')
ww('00-inbox/meeting-notes.md', zh ? '# 周会记录\n\n讨论了发布节奏。\n' : '# Weekly meeting\n\nDiscussed the release cadence.\n')
fs.writeFileSync(path.join(profile, 'wiki.json'), JSON.stringify({ path: wiki }))

// ── 应用状态 ──
const projects = [{ id: 'p1', name: 'notes-app', path: cwd, addedAt: 1, status: 'doing' }]
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify(projects))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: true, lang: LANGV }))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
const sid = 'ac-manual-' + Date.now()
const N = (o) => o
import http from 'node:http'
const srv = http.createServer((q, r) => { const f = path.join(cwd, q.url === '/' ? 'index.html' : q.url.slice(1)); try { if (f.endsWith('.html')) r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(f)) } catch { r.statusCode = 404; r.end() } })
await new Promise((r) => srv.listen(5173, '127.0.0.1', r))
fs.writeFileSync(path.join(profile, 'canvas.json'), JSON.stringify({ version: 1, viewMode: 'canvas', viewModePicked: true, viewport: { x: 30, y: 10, scale: 0.55 }, frames: [
  { id: 'f', projectId: 'p1', name: 'notes-app', x: 20, y: 20, w: 2560, h: 1460, collapsed: false, nodes: [
    N({ id: 'n0', x: 20, y: 50, w: 1000, h: 1380, agent: { kind: 'claude' }, pane: { kind: 'agent', cli: 'claude', resumeCli: 'claude', sessionId: sid, cwd } }),
    N({ id: 'n1', x: 1040, y: 50, w: 740, h: 560, pane: { kind: 'code', filePath: path.join(cwd, 'src/store.ts') } }),
    N({ id: 'n2', x: 1800, y: 50, w: 740, h: 560, pane: { kind: 'web', url: 'http://localhost:5173/' } }),
    N({ id: 'n3', x: 1040, y: 630, w: 740, h: 800, component: { type: 'git' } }),
    N({ id: 'n4', x: 1800, y: 630, w: 740, h: 380, pane: { kind: 'image', filePath: path.join(cwd, 'logo.png') } }),
    N({ id: 'n5', x: 1800, y: 1030, w: 740, h: 400, component: { type: 'codegraph' } }),
    N({ id: 'n6', x: 2620, y: 50, w: 700, h: 560, component: { type: 'team' } })
  ] },
  { id: 'f2', projectId: 'p1', name: zh ? '新想法' : 'New idea', x: 20, y: 1560, w: 900, h: 560, collapsed: false, nodes: [] }
], shapes: [], freeNodes: [], todos: [] }))

const env = { ...process.env, HOME: home, EAS_VERIFY: '1' }
for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)) delete env[k]
const INSPECT = 9510 + (zh ? 0 : 1)
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--remote-debugging-port=0', `--inspect=${INSPECT}`, '--use-mock-keychain', '--user-data-dir=' + profile, `--lang=${zh ? 'zh-CN' : 'en-US'}`], { env, stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, n = 300) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout') }
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }
  const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) })
  return { ws, send, ev: async (x) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description); return m.result.result.value } }
}
const sockets = []
const done = []; const failed = []
try {
  const port = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } })
  const list = async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { return [] } }
  const page = await connect((await until(async () => (await list()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))).webSocketDebuggerUrl); sockets.push(page.ws)
  const main = await connect((await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json())[0] } catch { return null } })).webSocketDebuggerUrl); sockets.push(main.ws)
  const electron = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
  await main.ev(`(()=>{const w=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));w.setContentSize(1440,900);w.center();return true})()`)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  const finish = () => page.ev("document.getAnimations().forEach(a=>{try{a.finish()}catch{}});true")
  const shot = async (id, prep) => {
    if (ONLY && !ONLY.has(id)) return
    try {
      if (prep) await prep()
      await finish(); await wait(250)
      const s = await page.send('Page.captureScreenshot', { format: 'png' })
      const png = path.join(raw, id + '.png'); fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'))
      execSync(`cwebp -quiet -q 82 -resize 1600 0 "${png}" -o "${path.join(out, `manual-${LANGV}-${id}.webp`)}"`)
      done.push(id)
    } catch (e) { failed.push(id + ': ' + String(e.message || e).slice(0, 120)) }
  }
  const store = (x) => page.ev(`(()=>{const s=window.__store.getState();${x};return true})()`)
  const esc = () => page.ev("['keydown','keyup'].forEach(t=>document.dispatchEvent(new KeyboardEvent(t,{key:'Escape',bubbles:true})));document.body.click();true")
  const clickText = (re, sel = 'button,[role=button],a,li,[role=menuitem],[role=tab]') => page.ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${re}.test((b.textContent||'').trim())&&b.getBoundingClientRect().width>0);if(b){b.click();return true}return false})()`)
  const dbl = (x, y) => page.ev(`(()=>{const el=document.elementFromPoint(${x},${y});el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:${x},clientY:${y}}));return el.className})()`)
  const ctx = (x, y) => page.ev(`(()=>{const el=document.elementFromPoint(${x},${y});el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:${x},clientY:${y}}));return el.className})()`)
  const max = (id) => store(`s.setMaximizedNode({frameId:'f',nodeId:'${id}'})`)
  const unmax = () => store('s.setMaximizedNode(null)')

  await until(() => page.ev('!!window.__store'))
  // 手册里不出现开发构建的标记：底部版本戳整条隐藏，更新页的「（开发构建）」在拍那张时去掉
  await page.ev("(()=>{const st=document.createElement('style');st.textContent='.build-stamp{display:none!important}';document.head.appendChild(st);return true})()")
  await wait(2500)
  // ① 首次启动引导（跳过之前先拍）
  await shot('01', () => wait(500))
  for (let i = 0; i < 30; i++) { if (await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()")) break; await wait(100) }
  await wait(4000)

  // 对话内容：从主进程回放事件（不连模型）
  const emit = (e) => main.ev(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('agentChat:event',${JSON.stringify({ sessionId: sid, event: e })})`)
  const T = zh ? {
    u1: '给笔记列表加一个按标题搜索的功能，并补上测试', a1: '好的。我先看一下现有的 store 和列表渲染，再动手。', x1: '读取 src/store.ts', x2: '运行 npm test',
    a2: '已完成：\n\n- `store.ts` 新增 `search(list, q)`，按标题过滤\n- 列表页加了搜索框\n- 新增 3 条测试，全部通过\n\n要不要顺手把搜索做成不区分大小写？', plan: '补上搜索的测试',
    ap: '运行 npm run build', u2: '好，不区分大小写', a3: '我来改一下过滤条件，改之前需要你允许执行构建。'
  } : {
    u1: 'Add search-by-title to the notes list and cover it with tests', a1: "Sure. I'll read the existing store and list rendering first.", x1: 'Read src/store.ts', x2: 'Run npm test',
    a2: 'Done:\n\n- `store.ts` gains `search(list, q)`, filtering by title\n- The list page has a search box\n- 3 new tests, all passing\n\nShould I make the search case-insensitive as well?', plan: 'Cover search with tests',
    ap: 'Run npm run build', u2: 'Yes, make it case-insensitive', a3: "I'll update the filter. I need your permission to run the build first."
  }
  const replay = async () => {
  await emit({ k: 'user.message', text: T.u1 }); await emit({ k: 'turn.start' })
  await emit({ k: 'text.done', text: T.a1 })
  await emit({ k: 'exec.start', execId: 'e1', label: T.x1, detail: 'src/store.ts', kind: 'read' }); await emit({ k: 'exec.done', execId: 'e1', ok: true, output: 'export interface Note …' })
  await emit({ k: 'plan.progress', plan: { planId: 'p', done: 2, total: 3, currentTitle: T.plan, version: 1 } })
  await emit({ k: 'exec.start', execId: 'e2', label: T.x2, detail: 'npm test', kind: 'command' }); await emit({ k: 'exec.done', execId: 'e2', ok: true, output: '✓ 3 passing' })
  await emit({ k: 'text.done', text: T.a2 }); await emit({ k: 'turn.done', usage: { inputTokens: 48210, outputTokens: 1830 } })
  }
  await wait(1200)

  // ② 画布总览
  await shot('02', () => wait(800))
  // ③ 双击空白 → 项目菜单
  await shot('03', async () => { await store('s.setViewport({x:-2400,y:10,scale:0.55})'); await wait(700); console.error('dbl target:', await dbl(720, 450)); await wait(1000) }); await esc(); await wait(400)
  // ④ 空 Frame（选 CLI）
  await shot('04', async () => { await store("s.setViewport({x:60,y:-760,scale:0.75})"); await wait(900) })
  // ⑤ 双击 Frame → 插入面板
  await shot('05', async () => { await dbl(400, 600); await wait(1000) }); await esc(); await wait(400)
  // ⑥ Frame 右键
  await shot('06', async () => { const r = await page.ev("(()=>{const h=[...document.querySelectorAll('.cframe-head')].pop();const b=h.getBoundingClientRect();return [b.left+120,b.top+b.height/2]})()"); await ctx(r[0], r[1]); await wait(700) }); await esc(); await wait(400)
  await store("s.setViewport({x:30,y:10,scale:0.55})"); await wait(600)
  // ⑦ AI 对话：分屏里开一个 agent 面板（与 verify-bg-task-cd 同法），对话内容走回放
  await store(`window.__store.setState({viewMode:'split',tabs:[{id:'tab-c',title:'AI',projectId:'p1',cwd:${JSON.stringify(cwd)},activeLeafId:'leaf-c',root:{type:'leaf',id:'leaf-c',pane:{kind:'agent',cli:'claude',resumeCli:'claude',sessionId:${JSON.stringify(sid)},cwd:${JSON.stringify(cwd)}}}}],activeTabId:'tab-c'})`); await wait(2500)
  await replay(); await wait(1500)
  await shot('07', () => wait(500))
  // ⑧ 审批卡片
  await shot('08', async () => { await emit({ k: 'user.message', text: T.u2 }); await emit({ k: 'turn.start' }); await emit({ k: 'text.done', text: T.a3 }); await emit({ k: 'approval.request', approvalId: 'ap1', kind: 'exec', title: T.ap, detail: 'npm run build', cwd }); await wait(1400) })
  // ⑨ @ 引用
  await shot('09', async () => { await page.ev("(()=>{const t=document.querySelector('.cm-content');t.focus();document.execCommand('insertText',false,'@');return true})()"); await wait(1200) })
  await shot('25', async () => { await page.ev("(()=>{const t=document.querySelector('.cm-content');if(t){t.focus();document.execCommand('selectAll');document.execCommand('delete')}return true})()"); await esc(); await store(`s.openFile(${JSON.stringify(path.join(cwd, 'README.md'))})`); await wait(2500) })
  await page.ev("(()=>{const t=document.querySelector('.cm-content');if(!t)return false;t.focus();document.execCommand('selectAll');document.execCommand('delete');return true})()").catch(() => {}); await esc(); await store("s.setViewMode('canvas')"); await wait(1200)
  // ⑪ 代码 ⑫ 网页 ⑬ 版本管理 ⑭ 图片 ⑮ 代码地图 ⑯ 团队面板
  for (const [id, n] of [['11', 'n1'], ['12', 'n2'], ['13', 'n3'], ['14', 'n4'], ['15', 'n5'], ['16', 'n6']]) { await shot(id, async () => { await max(n); await wait(2200) }); await unmax(); await wait(600) }
  // ⑩ 终端
  await store("s.addTerminalNode('f')"); await wait(2500)
  await shot('10', async () => { const id = await page.ev("(()=>{const f=window.__store.getState().canvas.frames.find(f=>f.id==='f');return f.nodes[f.nodes.length-1].id})()"); await max(id); await wait(1500) }); await unmax(); await wait(600)
  // ⑰ 左抽屉（文件）⑱ 右抽屉 · 知识库 / 插件 / 技能库 / 用量
  await shot('17', async () => { await store('s.setResDrawerOpen(true)'); await wait(1500) }); await store('s.setResDrawerOpen(false)'); await wait(500)
  for (const [id, re] of [['18', zh ? '/^知识库$/' : '/^Wiki$/'], ['19', zh ? '/^插件$/' : '/^Plugins$/'], ['20', zh ? '/^技能库$/' : '/^Skills$/'], ['21', zh ? '/^用量$/' : '/^Usage$/']]) {
    await shot(id, async () => { await page.ev("document.querySelector('.wk-edge-guide')?.click();true"); await wait(900); await clickText(re); await wait(1800) })
  }
  await page.ev("document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true"); await esc(); await wait(600)
  // ㉒ 创作参考
  await shot('22', async () => { await store("s.setViewMode('split');s.openChat("+JSON.stringify(cwd)+")"); await wait(1500); await page.ev("(async()=>{const s=window.__store.getState();const tab=s.tabs.find(t=>t.id===s.activeTabId);await s.setPaneKind(tab.id,tab.activeLeafId,'dict');return true})()"); await wait(3000); await page.ev("(()=>{const t=[...document.querySelectorAll('.dict-pill')].find(x=>/Debounce|防抖/.test(x.textContent));t.scrollIntoView({block:'center'});t.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return true})()"); await wait(1500) })
  // 收掉创作参考的悬停浮层（它挂在 body 上，不收会一路跟进后面的截图）
  await page.ev("(async()=>{document.querySelector('.dict-list')?.dispatchEvent(new MouseEvent('mouseleave',{bubbles:false}));const s=window.__store.getState();const tab=s.tabs.find(t=>t.id===s.activeTabId);await s.setPaneKind(tab.id,tab.activeLeafId,'chat');return true})()"); await wait(800)
  await store("s.setViewMode('canvas')"); await wait(800)
  // ㉓ 看板 ㉔ 甘特图 ㉕ 分屏
  await shot('23', async () => { await store("s.setViewMode('board')"); await wait(2000) })
  await shot('24', async () => { await store("s.setViewMode('gantt')"); await wait(2500) })
  await store("s.setViewMode('canvas')"); await wait(1000)
  // ㉖ 密钥柜
  await shot('26', async () => { await clickText(zh ? /^密钥$/ : /^Keys$/); await wait(1500) }); await esc(); await wait(500)
  // ㉗–㉝ 设置各页
  for (const [id, tab] of [['27', 'theme'], ['28', 'ai'], ['29', 'mcp'], ['30', 'phone'], ['31', 'update'], ['32', 'privacy'], ['33', 'keys']]) {
    await shot(id, async () => { await page.ev(`window.dispatchEvent(new CustomEvent('eas:open-settings',{detail:{tab:'${tab}'}}));true`); await wait(1500); await page.ev("document.querySelectorAll('.cset-rowname').forEach(e=>{e.textContent=e.textContent.replace(/（开发构建）| \\(dev build\\)/,'')});true") })
  }
  await page.ev("window.dispatchEvent(new CustomEvent('eas:close-settings'));true"); await wait(500)
  // ㉞ 灵动岛（单独窗口）
  if (!ONLY || ONLY.has('34')) {
    try {
      await main.ev(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).minimize()`)
      await until(async () => (await list()).some((x) => x.type === 'page' && /island/i.test(x.url)), 80).catch(() => {})
      await wait(2000)
      const isl = (await list()).find((x) => x.type === 'page' && /island/i.test(x.url))
      if (isl) {
        const ic = await connect(isl.webSocketDebuggerUrl); sockets.push(ic.ws)
        const clip = await ic.ev("({x:0,y:0,width:Math.round(innerWidth),height:Math.min(140,Math.round(innerHeight)),scale:2})")
        const s = await ic.send('Page.captureScreenshot', { format: 'png', clip })
        const png = path.join(raw, '34.png'); fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'))
        execSync(`cwebp -quiet -q 85 "${png}" -o "${path.join(out, `manual-${LANGV}-34.webp`)}"`); done.push('34')
      } else failed.push('34: island page not found')
    } catch (e) { failed.push('34: ' + e.message) }
  }
  console.log(JSON.stringify({ lang: LANGV, done, failed, raw }, null, 1))
} finally { srv.close(); for (const s of sockets) try { s.close() } catch {}; app.kill('SIGTERM'); await wait(1500); try { app.kill('SIGKILL') } catch {} }
