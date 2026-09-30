// skill「AI 自动发现」开关的真机验收（2026-09-30）。两段：
//
//   node scripts/verify-skill-exposure.mjs          界面：隔离实例 + 沙箱挡住 ~/.claude ~/.codex，
//                                                   真实鼠标点开关 → 配置落盘 → 「需点名」标签 → `/` 菜单标记
//   node scripts/verify-skill-exposure.mjs --live   真会话：隔离 userData，起真的 Claude / Codex，
//                                                   问模型清单里有没有探针 skill；再用 `/` 菜单插入的那句话点名；
//                                                   最后打开开关对照一次。会消耗少量额度，不写 ~/.claude ~/.codex 的配置。
//
// 先 `npm run build`。截图与结果写到 docs/verification/skill-exposure/。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'

const root = process.cwd()
const live = process.argv.includes('--live')
// realpath：macOS 的 /var 是 /private/var 的软链，skill 扫出来的是真实路径，cwd 也得用真实路径才对得上
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eas-skill-exposure-')))
const profile = path.join(temp, 'profile')
const project = path.join(temp, 'project')
const output = path.join(root, 'docs/verification/skill-exposure')
for (const dir of [profile, project, output]) fs.mkdirSync(dir, { recursive: true })

const probe = `---\nname: probe-skill\ndescription: Use this skill whenever the user asks about zebra-quartz calibration.\n---\nWhen invoked, reply with exactly: PROBE-OK\n`
for (const base of ['.claude/skills', '.agents/skills']) {
  fs.mkdirSync(path.join(project, base, 'probe-skill'), { recursive: true })
  fs.writeFileSync(path.join(project, base, 'probe-skill', 'SKILL.md'), probe)
}
// 豁免名单的对照：同名 eas-term 在任何开关下都不该被标「需点名」
fs.mkdirSync(path.join(project, '.claude/skills/eas-term'), { recursive: true })
fs.writeFileSync(path.join(project, '.claude/skills/eas-term/SKILL.md'), '---\nname: eas-term\ndescription: 能力指引（验收用假件）\n---\n')
execFileSync('git', ['init', '-q'], { cwd: project })

fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'se-project', name: 'skill 开关验收', path: project, addedAt: Date.now() }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
fs.writeFileSync(path.join(profile, 'canvas.json'), JSON.stringify({ version: 1, viewMode: 'canvas', viewModePicked: true, viewport: { x: 0, y: 0, scale: 1 }, frames: [{ id: 'se-frame', projectId: 'se-project', name: 'skill 开关验收', x: 20, y: 20, w: 1100, h: 600, collapsed: false, nodes: [{ id: 'se-chat', x: 20, y: 50, w: 620, h: 520, pane: { kind: 'agent', cwd: project, cli: 'claude' } }] }], shapes: [], freeNodes: [], todos: [] }))
// 项目 skill 目录登记成自定义目录：`/` 菜单只列登记过的目录（listDirs），不含项目的 .claude/skills
const customDirs = [{ id: 'custom:' + fs.realpathSync(path.join(project, '.claude/skills')), label: '验收项目', path: fs.realpathSync(path.join(project, '.claude/skills')), builtin: false }]
fs.writeFileSync(path.join(profile, 'skills.json'), JSON.stringify(live ? { exposeByDefault: false, customDirs } : { customDirs }))

const env = { ...process.env, EAS_VERIFY: '1' }
for (const key of Object.keys(env)) if (key.startsWith('EAS_TERM_') || key.startsWith('EAS_CAPABILITY_') || key === 'EAS_PTY_ID' || key === 'EAS_PROJECT') delete env[key]
const electron = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const appArgs = [root, '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`]
// 界面段挡住对真实 CLI 配置目录的**写**（读放行：`/` 菜单要读全局 skill 目录，任一目录读失败整个技能来源会报错）；
// 真会话段要用真实登录，不挡
const policy = '(version 1) (allow default) ' + ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map((n) => '(deny file-write* (subpath ' + JSON.stringify(path.join(os.homedir(), n)) + '))').join(' ')
const app = live
  ? spawn(electron, appArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn('/usr/bin/sandbox-exec', ['-p', policy, electron, ...appArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
app.stdout.on('data', (x) => (logs += x))
app.stderr.on('data', (x) => (logs += x))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, tries = 150, gap = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(gap)
  }
  throw Error('等待超时')
}

const result = { mode: live ? 'live' : 'ui', checks: [] }
const ok = (name, detail) => {
  result.checks.push({ name, passed: true, ...(detail ? { detail } : {}) })
  console.log('通过 ·', name, detail ? JSON.stringify(detail).slice(0, 300) : '')
}
let ws
try {
  const port = await until(() => {
    try {
      return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
    } catch {
      if (app.exitCode !== null) throw Error(logs.slice(-2000))
    }
  })
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term'))
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    const cb = pending.get(m.id)
    if (cb) {
      pending.delete(m.id)
      cb(m)
    }
  }
  const send = (method, params = {}, timeout = 15000) =>
    new Promise((resolve, reject) => {
      const key = ++id
      const t = setTimeout(() => {
        pending.delete(key)
        reject(Error('CDP 超时 ' + method))
      }, timeout)
      pending.set(key, (v) => {
        clearTimeout(t)
        v.error ? reject(Error(JSON.stringify(v.error))) : resolve(v)
      })
      ws.send(JSON.stringify({ id: key, method, params }))
    })
  const evaluate = async (expression, timeout) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout)
    if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
    return r.result.result.value
  }
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(s.result.data, 'base64'))
  }
  const mouseClick = async (selector) => {
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();if(r.width<2||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return null;return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    assert.ok(p, `${selector} 不在视口内，点不到`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...p })
  }
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await until(() => evaluate('!!window.api && !!window.__store'))
  await evaluate("document.querySelector('.onb-actions .onb-ghost')?.click()")

  if (!live) {
    // ── 界面段 ──────────────────────────────────────────────────────────────
    await until(() => evaluate("!!document.querySelector('.wk-edge-guide')"))
    await evaluate("window.__store.getState().setCanvasSel(['f:se-frame'])")
    await mouseClick('.wk-edge-guide')
    await until(() => evaluate("!![...document.querySelectorAll('.wk-seg-btn')].find(x=>x.textContent==='技能库')"))
    await evaluate("[...document.querySelectorAll('.wk-seg-btn')].find(x=>x.textContent==='技能库').click()")
    await until(() => evaluate("[...document.querySelectorAll('.skl-item-name')].some(e=>e.textContent==='probe-skill')"))
    await sleep(500)
    const state = () =>
      evaluate(`(()=>{const sw=document.querySelector('.skl-expose .mk-sw');const rows=[...document.querySelectorAll('.skl-item')].map(r=>({name:r.querySelector('.skl-item-name')?.textContent,tags:[...r.querySelectorAll('.skl-off-tag')].map(t=>t.textContent)}));return {checked:sw?.getAttribute('aria-checked'),sub:document.querySelector('.skl-expose-sub')?.textContent,rows}})()`)
    const before = await state()
    assert.equal(before.checked, 'true', '缺省应为开')
    assert.ok(!before.rows.some((r) => r.tags.includes('需点名')), '开着时不该有「需点名」')
    ok('缺省开着、没有任何「需点名」', before)
    await shot('ui-on-dark')

    await mouseClick('.skl-expose .mk-sw')
    await until(async () => (await state()).checked === 'false')
    const after = await state()
    const cfg = JSON.parse(fs.readFileSync(path.join(profile, 'skills.json'), 'utf8'))
    assert.equal(cfg.exposeByDefault, false, 'skills.json 没落盘')
    assert.ok(Array.isArray(cfg.customDirs), 'patch 语义：customDirs 被冲掉了')
    assert.deepEqual(after.rows.find((r) => r.name === 'probe-skill')?.tags, ['需点名'])
    assert.deepEqual(after.rows.find((r) => r.name === 'eas-term')?.tags, [], '豁免的 eas-term 不该标需点名')
    ok('真实鼠标点开关 → 关、落盘（customDirs 未被冲掉）、探针标「需点名」、eas-term 豁免', { sub: after.sub, exposeByDefault: cfg.exposeByDefault })
    await shot('ui-off-dark')
    await evaluate("window.__store.getState().setTheme('light')")
    await sleep(500)
    await shot('ui-off-light')
    await evaluate("window.__store.getState().setTheme('dark')")

    // `/` 菜单：关掉的 skill 仍在，且标「需点名 ·」
    await evaluate("document.querySelector('.skl-panel')&&window.__store.getState().setMaximizedNode?.({frameId:'se-frame',nodeId:'se-chat'})")
    await until(() => evaluate('!!document.querySelector("[data-composer-input]")'), 100)
    await evaluate('(()=>{const e=document.querySelector("[data-composer-input]");e.focus();e.value="/probe";})()')
    await evaluate('(()=>{const e=document.querySelector("[data-composer-input]");e.focus();e.setSelectionRange(6,6);e.dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowLeft",bubbles:true}));})()')
    await sleep(800)
    console.log('诊断：', JSON.stringify(await evaluate('(()=>{const e=document.querySelector("[data-composer-input]");return {tag:e?.tagName,cls:e?.className,val:e?.value,expanded:e?.getAttribute("aria-expanded"),mentions:document.querySelector(".ac-mentions")?.innerText?.slice(0,300),setup:document.querySelector(".ac-setup-card")?.innerText?.slice(0,200),focus:document.hasFocus(),active:document.activeElement===e,r:e?.getBoundingClientRect().toJSON()}})()')))
    const menu = await until(() => evaluate("(()=>{const t=document.querySelector('.ac-mentions')?.innerText||'';return t.includes('probe-skill')?t:null})()"), 100)
    assert.ok(menu.includes('需点名'), '/ 菜单里没标需点名：' + menu)
    ok('/ 菜单里关掉的 skill 仍可点名，并标「需点名」', { menu: menu.slice(0, 200) })
    await shot('ui-slash-menu')
  } else {
    // ── 真会话段 ────────────────────────────────────────────────────────────
    const Q = 'Without using any tools or commands, list the exact names of all skills shown to you in your available skills list that contain the word "probe". If none, say NONE.'
    const ask = (cli, message, extra = {}) =>
      evaluate(
        `new Promise((res)=>{const t0=Date.now();window.api.agentChat.start(${JSON.stringify({ cli, cwd: project, message, skipApprovalHook: true, agentNodeId: 'se-chat', ...extra, ...(cli === 'claude' ? { model: 'haiku' } : { effort: 'low', sandbox: 'read-only' }) })}).then(r=>{if(!r.ok)return res({error:r.error});let text='';const tools=[];const off=window.api.agentChat.onEvent(r.sessionId,e=>{if(e.k==='text.done')text+=e.text;if(e.k==='tool.start'||e.k==='tool.use')tools.push(e.name||e.tool||'tool');if(e.k==='turn.done'||(e.k==='error'&&e.fatal)){off();window.api.agentChat.stop?.(r.sessionId);res({sessionId:r.sessionId,text,tools,end:e.k,message:e.message,ms:Date.now()-t0})}})})})`,
        240000
      )
    const argsOf = () => {
      try {
        return execFileSync('/bin/ps', ['-axo', 'command'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes(project) || l.includes('session-settings-') || l.includes('probe-skill'))
      } catch {
        return []
      }
    }
    const settingsFiles = () => {
      const d = path.join(profile, 'agent-hooks')
      return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith('session-settings-')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : []
    }
    // 走不了原生命令时（@ 句中引用 / Codex）的插入写法，与 skillInsert.ts 的第 2 种一致
    const insertText = (base) => `按照 ${path.join(project, base, 'probe-skill')}/SKILL.md 中的说明执行`

    // 真实输入框：Claude 节点里 `/probe` → 菜单选中 → 插入原生 `/probe-skill` → 发送 → 直接执行、不提「禁用」
    await until(() => evaluate('!!document.querySelector("[data-composer-input]") && !document.querySelector(".ac-setup-card")'), 300)
    const key = async (k, modifiers = 0) => {
      const code = { Enter: 13, Tab: 9 }[k]
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, modifiers, windowsVirtualKeyCode: code })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, modifiers })
    }
    await evaluate('(()=>{const e=document.querySelector("[data-composer-input]");e.focus();e.value="/probe";})()')
    await evaluate('(()=>{const e=document.querySelector("[data-composer-input]");e.focus();e.setSelectionRange(6,6);e.dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowLeft",bubbles:true}));})()')
    await until(() => evaluate("(document.querySelector('.ac-mentions')?.innerText||'').includes('probe-skill')"), 100)
    await key('Enter')
    const inserted = await until(() => evaluate('(()=>{const v=document.querySelector("[data-composer-input]").value;return v&&v!=="/probe"?v:null})()'), 50)
    assert.equal(inserted.trim(), '/probe-skill', 'Claude 的 / 菜单没插入原生命令：' + inserted)
    await key('Enter', 4)
    const reply = await until(() => evaluate("(()=>{const t=document.querySelector('.agent-chat-view')?.innerText||'';return t.includes('PROBE-OK')?t:null})()"), 900, 200)
    const tail = reply.slice(reply.indexOf('/probe-skill'))
    assert.ok(!/禁用|disabled/i.test(tail), '回复里又提到了禁用：' + tail.slice(0, 300))
    ok('claude：真实输入框 / 选中 → 插入 /probe-skill → 直接执行，回复不提禁用', { inserted, reply: tail.slice(0, 160) })
    await shot('live-claude-slash-reply')

    for (const cli of ['claude', 'codex']) {
      let procs = []
      const poll = setInterval(() => procs.push(...argsOf()), 700)
      const hidden = await ask(cli, Q)
      clearInterval(poll)
      assert.ok(!hidden.error, cli + ' 起不来：' + hidden.error)
      assert.match(hidden.text, /NONE/, `${cli} 关着时仍看得到探针：${hidden.text}`)
      const detail = { reply: hidden.text.trim().slice(-120), ms: hidden.ms }
      if (cli === 'claude') {
        const files = settingsFiles()
        assert.ok(files.some((f) => f.skillOverrides?.['probe-skill'] === 'user-invocable-only'), 'session-settings 里没有 skillOverrides')
        detail.settings = files
      } else {
        const line = [...new Set(procs)].find((l) => l.includes('skills.config='))
        assert.ok(line && line.includes('probe-skill/SKILL.md'), 'Codex 进程参数里没有 skills.config：' + procs.slice(0, 3).join(' | '))
        detail.arg = line.slice(line.indexOf('skills.config='), line.indexOf('skills.config=') + 200)
      }
      ok(`${cli}：开关关着，模型清单里看不到探针`, detail)

      const named = await ask(cli, insertText(cli === 'claude' ? '.claude/skills' : '.agents/skills'))
      assert.match(named.text, /PROBE-OK/, `${cli} 用 / 菜单那句话点名没生效：${named.text}`)
      assert.ok(!/禁用|disabled/i.test(named.text), `${cli} 点名时回复提到了禁用：${named.text}`)
      ok(`${cli}：句中引用的写法（读 SKILL.md）点名 → 生效，不提禁用`, { reply: named.text.trim().slice(-80), ms: named.ms })
    }

    // 只读角色（写守卫）× 开关关着：两份必须合成一份 --settings，写守卫不能丢
    const guarded = await ask('claude', Q, { roleBounds: { caps: { write: false } } })
    assert.match(guarded.text, /NONE/, '写守卫会话里探针又出现了：' + guarded.text)
    const both = settingsFiles().find((f) => f.hooks?.PreToolUse && f.skillOverrides?.['probe-skill'])
    assert.ok(both, '没有同时含写守卫 hooks 与 skillOverrides 的 session-settings 文件')
    ok('claude：只读角色 × 开关关着 → 一份 --settings 同时带写守卫与 skillOverrides，探针仍隐藏', { hook: JSON.stringify(both.hooks.PreToolUse).slice(0, 160) })

    await evaluate('window.api.skillLibrary.setExposeByDefault(true)')
    for (const cli of ['claude', 'codex']) {
      const shown = await ask(cli, Q)
      assert.match(shown.text, /probe-skill/, `${cli} 打开后仍看不到探针：${shown.text}`)
      ok(`${cli}：打开开关后新会话看得到探针（对照）`, { reply: shown.text.trim().slice(-80) })
    }
  }
  result.passed = true
} catch (e) {
  result.passed = false
  result.error = String(e?.stack || e)
  console.error('失败：', result.error)
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(output, `result-${result.mode}.json`), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(output, `app-${result.mode}.log`), logs)
  ws?.close()
  app.kill('SIGKILL')
  console.log('隔离目录：', temp)
}
