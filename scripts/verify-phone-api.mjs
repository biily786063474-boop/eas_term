// 手机端回归：扮演手机，走和真手机一模一样的 HTTP 协议（/pair → /pair/wait → /api），
// 把局域网 + 浏览器这条路（第一、二步）的能力逐项跑一遍。2026-10-02 真机回归时写的。
//
//   npm run build && node scripts/verify-phone-api.mjs
//
// · 隔离实例（独立 userData），**临时项目**：md / 图片 / 本地 HTML 报告 / AI 对话 / 终端各一个，
//   不碰真实画布与真实项目。AI 对话会真的拉起 Claude（真实登录，几句很短的话）。
// · 电脑端那一侧（开总开关、出配对码、点「允许」）走 IPC，手机那一侧只走 HTTP —— 协议层就是真手机看到的样子。
// 结果写 docs/verification/phone-regress/result.json。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const output = path.join(root, 'docs/verification/phone-regress')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-phone-')))
const profile = path.join(temp, 'profile')
const project = path.join(temp, 'project')
for (const d of [output, profile, project]) fs.mkdirSync(d, { recursive: true })

// ── 临时项目里的三种文件 ─────────────────────────────────────────────
const md = path.join(project, 'notes.md')
fs.writeFileSync(md, '# 回归笔记\n\n- 第一项 **粗体**\n- 第二项 `code`\n\n```js\nconsole.log(1)\n```\n\n<script>alert(1)</script>\n')
const png = path.join(project, 'pic.png')
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
const html = path.join(project, 'report.html')
// 报告里放一段「攻击脚本」：脚本必须能跑（图表要靠它），但读不到手机页的配对 token、也用不了自己的存储
fs.writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"><title>报告</title></head><body><h1>回归报告</h1><p id="s">NO-SCRIPT</p><p id="o"></p>' +
  '<script>var r;try{r="LEAK:"+parent.localStorage.getItem("eas.phone.token")}catch(e){r="BLOCKED-PARENT"}var o;try{o="OWN:"+localStorage.getItem("x")}catch(e){o="BLOCKED-OWN"}' +
  'document.getElementById("o").textContent=r+"|"+o;document.getElementById("s").textContent="SCRIPT-RAN"</script></body></html>')

const P = 'pr-phone-regress', F = 'f-phone-regress'
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: P, name: '手机回归', path: project, addedAt: Date.now() }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
fs.writeFileSync(path.join(profile, 'canvas.json'), JSON.stringify({
  version: 1, viewMode: 'canvas', viewModePicked: true, viewport: { x: 0, y: 0, scale: 1 },
  frames: [{ id: F, projectId: P, name: '手机回归', x: 20, y: 20, w: 1400, h: 800, collapsed: false, nodes: [
    { id: 'n-md', x: 20, y: 60, w: 400, h: 300, name: 'notes.md', pane: { kind: 'code', filePath: md } },
    { id: 'n-img', x: 440, y: 60, w: 300, h: 300, name: 'pic.png', pane: { kind: 'image', filePath: png } },
    { id: 'n-html', x: 760, y: 60, w: 400, h: 300, name: 'report.html', pane: { kind: 'web', url: 'file://' + html } },
    { id: 'n-chat', x: 20, y: 380, w: 600, h: 400, pane: { kind: 'agent', cwd: project, cli: 'claude' } },
    // 「重启之后的旧对话」：电脑上有落盘历史、这次运行没启动（2026-10-02 真机回归：手机上点开一片空白）
    { id: 'n-old', x: 640, y: 380, w: 600, h: 400, name: '旧对话', pane: { kind: 'agent', cwd: project, cli: 'claude' } }
  ] }], shapes: [], freeNodes: [], todos: []
}))
fs.mkdirSync(path.join(profile, 'agent-history'), { recursive: true })
fs.writeFileSync(path.join(profile, 'agent-history', 'n-old.json'), JSON.stringify({
  v: 2, savedAt: Date.now() - 3600e3, resumeId: null, resumeCli: null, cwd: project,
  turns: [
    { role: 'user', text: '昨天问的问题 OLD-Q', seq: 1, execs: [] },
    { role: 'assistant', text: '## 昨天的回答\n\n- OLD-A 第一点\n- 第二点', seq: 2, execs: [] }
  ]
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

const result = { checks: [], issues: [] }
const ok = (name, detail) => { result.checks.push({ name, passed: true, detail }); console.log('通过 ·', name, detail ? JSON.stringify(detail).slice(0, 220) : '') }
const bad = (name, detail) => { result.checks.push({ name, passed: false, detail }); console.log('不通过 ·', name, JSON.stringify(detail).slice(0, 300)) }
const note = (s) => { result.issues.push(s); console.log('问题 ·', s) }

let ws
try {
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (app.exitCode !== null) throw Error(logs.slice(-1500)) } })
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0; const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); const cb = pending.get(m.id); if (cb) { pending.delete(m.id); cb(m) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const k = ++id; const t = setTimeout(() => { pending.delete(k); reject(Error('CDP 超时 ' + method)) }, 30000); pending.set(k, (v) => { clearTimeout(t); v.error ? reject(Error(JSON.stringify(v.error))) : resolve(v) }); ws.send(JSON.stringify({ id: k, method, params })) })
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value }
  await until(() => ev('!!window.api && !!window.__store'))
  await ev("document.querySelector('.onb-actions .onb-ghost')?.click()")

  // ── 电脑端：开总开关、出配对码 ───────────────────────────────────────
  await ev('window.api.phone.enable(true)')
  const st = await until(() => ev('window.api.phone.status().then(s=>s.url?s:null)'))
  const base = st.url.replace(/\/$/, '')
  const code = (await ev('window.api.phone.newCode()'))?.code ?? (await ev('window.api.phone.status()')).pending?.code
  if (!/^[A-Z0-9]{6}$/.test(String(code))) throw Error('拿不到配对码：' + JSON.stringify(code))

  // ── 手机：提交配对码 → 电脑点允许 → 取 token ─────────────────────────
  const r1 = await fetch(base + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: '回归模拟手机' }) })
  if (!r1.ok) throw Error('配对提交失败 ' + r1.status + ' ' + (await r1.text()))
  await ev('window.api.phone.approve()')
  const token = (await until(async () => (await (await fetch(base + '/pair/wait')).json()).token))
  ok('1 配对（提交码 → 电脑允许 → 取 token）', { url: base })

  const api = async (action, args = {}) => {
    const r = await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action, args }) })
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  }

  // ── 终端：电脑上建一个，写一行特征输出 ─────────────────────────────────
  await ev(`window.__store.getState().addTerminalNode(${JSON.stringify(F)})`)
  const ptyId = await until(() => ev(`(()=>{const s=window.__store.getState();const out=[];const walk=n=>{if(!n)return;if(n.type==='leaf'){if(n.pane?.kind==='terminal')out.push(n.pane.ptyId)}else (n.children||[n.a,n.b]).forEach(walk)};for(const t of s.tabs||[])walk(t.root);return out[0]||null})()`))
  await sleep(1500)
  await ev(`window.api.pty.write(${JSON.stringify(ptyId)}, 'echo PHONE-TERM-$((40+2))\\r')`)

  // ── 2 项目列表 ───────────────────────────────────────────────────────
  const projects = await api('projects')
  const mine = (projects.data || []).find((p) => p.id === P)
  mine ? ok('2 项目列表含测试项目', { n: projects.data.length }) : bad('2 项目列表', projects)

  // ── 3 会话状态 ───────────────────────────────────────────────────────
  const sessions = await until(async () => { const s = await api('sessions', { projectId: P }); return (s.data || []).length >= 2 ? s : null }, 40, 500).catch(() => null)
  const sess = sessions?.data || []
  const term = sess.find((s) => s.kind === 'terminal'), chat = sess.find((s) => s.kind === 'agent')
  term && chat ? ok('3 会话列表（终端 + AI 对话）', sess.map((s) => ({ kind: s.kind, state: s.state ?? s.status, sid: !!s.sessionId }))) : bad('3 会话列表', sessions)

  // ── 4 文件 ───────────────────────────────────────────────────────────
  const files = (await api('files', { projectId: P })).data || []
  const names = files.map((f) => f.name)
  names.includes('notes.md') && names.includes('pic.png') ? ok('4a 文件列表含 md 与图片', names) : bad('4a 文件列表', names)
  const rep = files.find((f) => f.id === 'n-html')
  rep && rep.kind === 'html' ? ok('4d 本地 HTML 报告进文件列表', rep) : bad('4d 本地 HTML 报告进文件列表', files)
  const hr = await api('file', { projectId: P, nodeId: 'n-html' })
  hr.kind === 'html' && /回归报告/.test(hr.text || '') ? ok('4e 读 HTML 报告', { chars: hr.text.length }) : bad('4e 读 HTML 报告', hr)
  const mdr = await api('file', { projectId: P, nodeId: 'n-md' })
  mdr.kind === 'doc' && /回归笔记/.test(mdr.text || '') ? ok('4b 读 md', { chars: mdr.text.length }) : bad('4b 读 md', mdr)
  const imr = await api('file', { projectId: P, nodeId: 'n-img' })
  imr.kind === 'image' && /^data:image\/png;base64,/.test(imr.dataUrl || '') ? ok('4c 读图片', { bytes: imr.dataUrl.length }) : bad('4c 读图片', imr)

  // ── 4f 没启动的旧对话：会话列表带历史键，凭它读到电脑上落盘的记录 ─────────
  const old = sess.find((x) => x.historyKey === 'n-old')
  old && !old.sessionId ? ok('4f 旧对话带历史键、标成没启动', old) : bad('4f 旧对话历史键', sess)
  const oh = await api('transcript', { historyKey: 'n-old', kind: 'agent' })
  const ot = (oh.data || []).map((m) => m.role + ':' + m.text).join('\n')
  ;/OLD-Q/.test(ot) && /assistant:## 昨天的回答/.test(ot) && oh.busy === false ? ok('4g 读到没启动旧对话的历史', { n: oh.data.length }) : bad('4g 读旧对话历史', oh)
  const evil = await api('transcript', { historyKey: '../prefs', kind: 'agent' })
  !(evil.data || []).length ? ok('4h 历史键带 ../ 读不到别的文件') : bad('4h 历史键越界', evil)

  // ── 5 已有 AI 对话：手机发第一句把它拉起来 → 读回复 → 再发一句 ─────────
  // 等回复期间顺便记下手机能看到的「它还在干活吗」：busy 与正在吐的半句 partial。
  // 手机页就靠这两个值显示「正在想…/正在回答…」与那个闪烁光标 —— 它们没来 = 等待期间界面全静止。
  const liveSeen = { busy: 0, partial: 0, samples: [] }
  const waitReply = async (sid, re) => until(async () => {
    const t = await api('transcript', { sessionId: sid })
    if (t.busy === true) liveSeen.busy++
    if (t.partial) liveSeen.partial++
    if (liveSeen.samples.length < 6) liveSeen.samples.push({ busy: t.busy ?? null, partial: (t.partial || '').length })
    const txt = (t.data || []).map((m) => m.role + ':' + m.text).join('\n'); return !t.busy && re.test(txt) ? { t, txt } : null
  }, 120, 1000)
  const s1 = await api('send', { projectId: P, nodeId: 'n-chat', text: '只回复 PHONE-ONE 这几个字母，不要别的' })
  if (s1.status !== 200 || !s1.sessionId) bad('5a 手机启动已有对话', s1)
  else {
    const r = await waitReply(s1.sessionId, /assistant:[\s\S]*PHONE-ONE/)
    ok('5a 手机启动已有对话并读到回复', { sessionId: s1.sessionId, tail: r.txt.slice(-80) })
    // 画布节点两种形态：会话号挂在节点自己的 pane 上，或挂在它引用的 leaf 上（provider.startSession 两处都写）
    const written = await until(() => ev(`(()=>{const s=window.__store.getState();const n=s.canvas.frames.find(f=>f.id===${JSON.stringify(F)}).nodes.find(n=>n.id==='n-chat');if(!n)return 'node-gone';if(n.pane?.sessionId)return n.pane.sessionId;let sid=null;const walk=x=>{if(!x||sid)return;if(x.type==='leaf'){if(x.id===n.leafId)sid=x.pane?.sessionId||null}else (x.children||[x.a,x.b]).forEach(walk)};for(const t of s.tabs||[])walk(t.root);return sid})()`), 20, 250).catch(() => null)
    written === s1.sessionId ? ok('5b sessionId 写回画布节点', { written }) : bad('5b sessionId 写回画布', { written, expect: s1.sessionId })
    const s2 = await api('send', { sessionId: s1.sessionId, text: '再只回复 PHONE-TWO' })
    if (s2.status !== 200) bad('5c 已在跑的对话再发一句', s2)
    else { const r2 = await waitReply(s1.sessionId, /PHONE-TWO/); ok('5c 已在跑的对话再发一句并读到回复', { tail: r2.txt.slice(-60) }) }
  }

  // ── 5d 让 AI 用 Markdown 回一段（给第 9 步的手机页渲染截图用）─────────
  let mdSid = null
  if (s1?.sessionId) {
    const s4 = await api('send', { sessionId: s1.sessionId, text: '用 Markdown 回复，只包含：一个二级标题「测试」、一个两项无序列表、一个 js 代码块（一行 console.log(1)），不要别的' })
    if (s4.status === 200) { await waitReply(s1.sessionId, /assistant:[\s\S]*```/); mdSid = s1.sessionId; ok('5d AI 用 Markdown 回复') }
    else bad('5d AI 用 Markdown 回复', s4)
  }

  // ── 5e 等回复期间手机拿不拿得到「在干活」的信号 ──────────────────────
  liveSeen.busy > 0
    ? ok('5e 等回复期间 busy=true 能传到手机（页面据此显示「正在想…」）', { busyTicks: liveSeen.busy, partialTicks: liveSeen.partial, samples: liveSeen.samples })
    : bad('5e 等回复期间 busy 没传到手机 —— 手机上整段等待是静止的', liveSeen)

  // ── 5f AI 跑命令那段：手机拿得到「此刻在做什么」，手机页自己刷出处理中气泡 ─────────
  // 2026-10-02 真机回归用户问「为什么没有正在处理的动态动画以及提示」。
  // 截图进程与 API 轮询同时跑：截图那边**不手动刷新**，验的是页面自己的轮询能把气泡刷出来
  const probeWorking = async (sfx, lang, marker) => {
    if (!s1?.sessionId) return bad('5f' + sfx + ' 没有可用会话', null)
    const sent = await api('send', { sessionId: s1.sessionId, text: `用 Bash 工具在前台执行这条命令（不要放到后台、不要设 run_in_background）：sleep 12 && echo ${marker}。执行完只回复 ${marker}` })
    if (sent.status !== 200) return bad('5f' + sfx + ' 发送', sent)
    const { spawn: sp } = await import('node:child_process')
    const shots = new Promise((res) => {
      const c = sp(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [path.join(root, 'scripts/phone-page-shots.cjs')], {
        env: { ...process.env, PHONE_BASE: base, PHONE_TOKEN: token, PHONE_PROJ: P, PHONE_OUT: output, PHONE_SUFFIX: sfx, PHONE_LANG: lang, PHONE_MODE: 'working', PHONE_WANT: 'sleep' }, stdio: 'ignore'
      })
      const t = setTimeout(() => c.kill('SIGKILL'), 90000); c.on('exit', () => { clearTimeout(t); res() })
    })
    const acts = new Set()
    let allowed = null
    await until(async () => {
      const t = await api('transcript', { sessionId: s1.sessionId })
      if (t.activity) acts.add(t.activity)
      // 卡在审批上：先留几秒给手机截「等你在电脑上允许」那张，再像用户一样到电脑上点允许
      if (allowed === null && /允许|allow/i.test(t.activity || '')) {
        await sleep(5000)
        allowed = await ev(`(()=>{const b=document.querySelector('.ac-approval-btn.allow');if(!b)return false;b.click();return true})()`)
      }
      // 认「最后一条是 AI 且含标记」—— 跨条匹配会把我自己发的那句（里面也有标记）当成回复
      const last = (t.data || []).slice(-1)[0]
      return !t.busy && last?.role === 'assistant' && last.text.includes(marker) ? t : null
    }, 400, 300).catch(() => null)
    await shots
    const after = await api('transcript', { sessionId: s1.sessionId })
    const list = [...acts]
    list.some((a) => a.includes('sleep')) && !after.activity && !after.busy
      ? ok('5f' + sfx + ' 跑命令时手机拿到 activity（含等审批），跑完清掉', { list, allowed }) : bad('5f' + sfx + ' activity', { list, allowed, after: { activity: after.activity, busy: after.busy } })
    const w = (() => { try { return JSON.parse(fs.readFileSync(path.join(output, 'phone-working' + sfx + '.json'), 'utf8')).working } catch { return null } })()
    w && w.dots === 3 && w.anim === 'dot' && w.text && w.visible && w.draftKept
      ? ok('5g' + sfx + ' 手机页自己刷出处理中气泡（三点动画 + 当前在做什么；在输入框上方看得见；轮询不吞没发的字）', w) : bad('5g' + sfx + ' 处理中气泡', w)
    return list
  }
  const zhActs = await probeWorking('', 'zh', 'PHONE-TOOL')
  zhActs && zhActs.some((a) => /^运行 /.test(a)) ? ok('5h 中文界面下 activity 是中文标签', zhActs) : bad('5h 中文 activity 标签', zhActs)
  zhActs && zhActs.some((a) => /^等你在电脑上允许：运行 sleep/.test(a)) ? ok('5i 卡在审批上时手机明说「等你在电脑上允许」') : bad('5i 审批等待提示', zhActs)

  // ── 6 新建对话 → 启动 → 画布上出现节点 ───────────────────────────────
  const nn = await api('newSession', { projectId: P })
  if (nn.status !== 200 || !nn.nodeId) bad('6a 新建对话', nn)
  else {
    const onCanvas = await ev(`(()=>{const s=window.__store.getState();return !!s.canvas.frames.find(f=>f.id===${JSON.stringify(F)}).nodes.find(n=>n.id===${JSON.stringify(nn.nodeId)})})()`)
    onCanvas ? ok('6a 新建对话，画布上出现节点', { nodeId: nn.nodeId }) : bad('6a 新建对话节点不在画布', nn)
    const s3 = await api('send', { projectId: P, nodeId: nn.nodeId, text: '只回复 PHONE-NEW' })
    if (s3.status !== 200 || !s3.sessionId) bad('6b 启动新建的对话', s3)
    else { const r3 = await waitReply(s3.sessionId, /assistant:[\s\S]*PHONE-NEW/); ok('6b 启动新建的对话并读到回复', { tail: r3.txt.slice(-60) }) }
  }

  // ── 7 终端输出 ───────────────────────────────────────────────────────
  const tsess = (await api('sessions', { projectId: P })).data?.find((s) => s.kind === 'terminal')
  const tt = tsess?.sessionId ? await until(async () => { const t = await api('transcript', { sessionId: tsess.sessionId, kind: 'terminal' }); const txt = (t.data || []).map((m) => m.text).join('\n'); return /PHONE-TERM-42/.test(txt) ? txt : null }, 30, 500).catch(() => null) : null
  tt && !/\x1b\[/.test(tt) ? ok('7 读终端输出（含特征行、无控制字符）', { tail: tt.slice(-80) }) : bad('7 读终端输出', { tsess, tt })

  // ── 9 手机页真实渲染（390×844）：md 文档与 AI 回复走 Markdown，原文 HTML 不生效 ─────
  {
    const { spawnSync } = await import('node:child_process')
    spawnSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [path.join(root, 'scripts/phone-page-shots.cjs')], {
      env: { ...process.env, PHONE_BASE: base, PHONE_TOKEN: token, PHONE_PROJ: P, PHONE_SID: mdSid || '', PHONE_OUT: output }, timeout: 120000
    })
    const pg = JSON.parse(fs.readFileSync(path.join(output, 'phone-page.json'), 'utf8'))
    const d = pg.doc, c = pg.chat
    d && d.h1 === 1 && d.li >= 2 && d.pre === 1 && d.strong >= 1 && d.script === 0 && d.scriptAsText
      ? ok('9a 手机页 md 文档渲染（标题/列表/代码块；<script> 只当文字）', d) : bad('9a 手机页 md 文档渲染', pg)
    c && c.h2 >= 1 && c.li >= 2 && c.pre >= 1 && c.userPlain
      ? ok('9b 手机页 AI 回复渲染 Markdown，用户消息保持原文', c) : bad('9b 手机页 AI 回复渲染', pg)
    const h = pg.report
    h && h.sandbox === 'allow-scripts' && h.inner && /SCRIPT-RAN/.test(h.inner) && /BLOCKED-PARENT\|BLOCKED-OWN/.test(h.inner)
      ? ok('9d 报告在沙箱里：脚本照跑，读不到配对 token 与存储', h) : bad('9d 报告沙箱', pg)
    pg.consoleErrors?.length ? bad('9c 手机页无脚本报错', pg.consoleErrors) : ok('9c 手机页无脚本报错')
    const oh2 = pg.history
    oh2 && oh2.h2 >= 1 && oh2.me >= 1 && oh2.composer && oh2.sub
      ? ok('9f 手机页点开没启动的旧对话：看得到以前的往来，能接着发', oh2) : bad('9f 手机页旧对话', oh2)
    const tl = pg.toLatest
    tl && tl.openGap < 4 && !tl.openBtn && tl.upBtn && tl.upBtnVisible && tl.afterGap < 4 && !tl.afterBtn && tl.label === '回到最新消息'
      ? ok('9e 打开对话即最新；上翻出现「回到最新」，点了回到底部', tl) : bad('9e 回到最新', tl)
  }

  // ── 10 英文界面：电脑切成英文 → 手机页指纹变（真手机据此自己重载）→ 界面文字没有一个汉字 ─────
  {
    const b0 = (await (await fetch(base + '/health')).json()).build
    await ev("window.api.prefs.set('lang', 'en')")
    const b1 = await until(async () => { const b = (await (await fetch(base + '/health')).json()).build; return b !== b0 ? b : null }, 40, 250).catch(() => null)
    b1 ? ok('10a 电脑切英文后手机页指纹变化（手机会自动重载）', { before: b0, after: b1 }) : bad('10a 切语言后指纹没变', { b0 })
    const { spawnSync } = await import('node:child_process')
    spawnSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [path.join(root, 'scripts/phone-page-shots.cjs')], {
      env: { ...process.env, PHONE_BASE: base, PHONE_TOKEN: token, PHONE_PROJ: P, PHONE_SID: mdSid || '', PHONE_OUT: output, PHONE_SUFFIX: '-en', PHONE_LANG: 'en' }, timeout: 120000
    })
    const en = JSON.parse(fs.readFileSync(path.join(output, 'phone-page-en.json'), 'utf8'))
    const leaks = (en.chrome || []).map((c) => ({ view: c.view, cjk: (c.text || '').replace(/手机回归/g, '').match(/[\u4e00-\u9fff][^|]*/g) })).filter((c) => c.cjk)
    ;(en.chrome || []).length >= 4 && !leaks.length && !en.error
      ? ok('10b 英文界面：手机页界面文字无中文', en.chrome.map((c) => c.view)) : bad('10b 英文界面残留中文', { leaks, error: en.error })
    en.doc && en.chat?.h2 >= 1 ? ok('10c 英文界面下 md 与 AI 回复照样渲染') : bad('10c 英文界面渲染', en)
    en.toLatest?.label === 'Jump to latest' && en.toLatest.openGap < 4 && en.toLatest.afterGap < 4 ? ok('10f 英文「回到最新」', en.toLatest) : bad('10f 英文「回到最新」', en.toLatest)
    const enActs = await probeWorking('-en', 'en', 'PHONE-TOOL-EN')
    enActs && enActs.length && enActs.every((a) => !/[\u4e00-\u9fff]/.test(a.replace(/sleep.*$/, '')))
      ? ok('10d 英文界面下 activity 是英文标签', enActs) : bad('10d 英文 activity 标签', enActs)
    enActs && enActs.some((a) => /^Waiting for you to allow on your computer: Run sleep/.test(a)) ? ok('10e 英文审批等待提示') : bad('10e 英文审批等待提示', enActs)
    await ev("window.api.prefs.set('lang', 'zh')")
  }

  // ── 留痕 ─────────────────────────────────────────────────────────────
  const audit = JSON.parse(fs.readFileSync(path.join(profile, 'phone-audit.json'), 'utf8'))
  ok('8 操作留痕', { n: audit.length, actions: [...new Set(audit.map((e) => e.action))] })
  result.passed = result.checks.every((c) => c.passed)
} catch (e) {
  result.passed = false; result.error = String(e?.stack || e); console.error('失败：', result.error)
} finally {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(output, 'app.log'), logs)
  ws?.close(); app.kill('SIGKILL')
  console.log('隔离目录：', temp)
  process.exitCode = result.passed ? 0 : 1
}
