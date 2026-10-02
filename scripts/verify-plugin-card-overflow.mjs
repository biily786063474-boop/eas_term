// 隔离实例：画布右侧「更多 › 插件」里，已装插件的长描述 / 长名字不能冲出卡片，面板也不能被横着拖走
// （2026-10-02 用户截图：Codex / Claude 插件的英文描述冲出卡片，触控板一拖整块面板往左滑、标题被切掉）。
// 取一张真实渲染的已装卡片，按「不可点卡片」的原样结构（内容直接挂在卡片上、没有 .mk-card-open 按钮）摆好，
// 换成超长文字后量位置，再用真实滚轮事件横向拖一下看面板动没动。截图到 docs/verification/plugin-card-overflow/。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import assert from 'node:assert/strict'
const LANG = process.env.EAS_VERIFY_LANG === 'en' ? 'en' : 'zh', TAB = LANG === 'en' ? 'Plugins' : '插件'
const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-mkcard-')), profile = path.join(temp, 'p'), home = path.join(temp, 'h'), proj = path.join(temp, 'proj')
const out = path.join(root, process.env.EAS_VERIFY_OUTPUT ?? 'docs/verification/plugin-card-overflow'); for (const d of [profile, home, proj, out]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: LANG }))
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'p', name: 'demo', path: proj, addedAt: 1 }]))
const env = { ...process.env, HOME: home, EAS_VERIFY: '1' }; for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)) delete env[k]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--remote-debugging-port=0', '--use-mock-keychain', '--user-data-dir=' + profile], { env, stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, n = 300) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout') }
async function connect(url) { const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }; const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) }); return { ws, send, ev: async (x) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description ?? 'eval failed'); return m.result?.result?.value } } }
const DESC = 'Discover and manage animated ChatGPT pets, not real-world or other-app pets. A skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques.'
const NAME = 'superpowers-extended-design-intelligence-pro-max-plugin-with-a-very-long-name'
try {
  const dp = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } })
  const page = await connect((await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term') } catch { return null } })).webSocketDebuggerUrl)
  await until(() => page.ev('!!window.__store')); await wait(1500)
  for (let i = 0; i < 30; i++) { if (await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()")) break; await wait(100) }
  await page.ev("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('p',30,30);s.setViewport({x:0,y:0,scale:1});return true})()")
  await until(() => page.ev("!!document.querySelector('.wk-edge-guide')"))
  await page.ev("document.querySelector('.wk-edge-guide').click();true")
  await until(() => page.ev("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('"+TAB+"'))"))
  await page.ev("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('"+TAB+"')).click();true")
  await until(() => page.ev("!!document.querySelector('.mk-panel .mk-card .mk-sw')"))
  await wait(800)
  // 已装卡片（带开关）→ 改成不可点卡片的原样结构：PluginLogo + span.mk-body 直接挂在 .mk-card 上
  const setup = await page.ev(`(()=>{const card=document.querySelector('.mk-panel .mk-card .mk-sw').closest('.mk-card');const btn=card.querySelector('.mk-card-open');if(btn){btn.querySelector('.mk-chat-hint')?.remove();while(btn.firstChild)card.insertBefore(btn.firstChild,btn);btn.remove()}
    card.querySelector('.mk-name').textContent=${JSON.stringify(NAME)};card.querySelector('.mk-desc').textContent=${JSON.stringify(DESC)};card.id='mk-probe';card.scrollIntoView({block:'center'});return {descTag:card.querySelector('.mk-desc').tagName,hadButton:!!btn}})()`)
  await wait(300)
  const measure = () => page.ev(`(()=>{const p=document.querySelector('.mk-panel'),c=document.getElementById('mk-probe'),R=e=>e.getBoundingClientRect(),cr=R(c),d=R(c.querySelector('.mk-desc')),n=R(c.querySelector('.mk-name')),src=R(c.querySelector('.mk-src')),act=R(c.querySelector('.mk-act'));
    return {panelOverflowX:p.scrollWidth-p.clientWidth,scrollLeft:p.scrollLeft,descRight:Math.round(d.right),nameRight:Math.round(n.right),srcRight:Math.round(src.right),actLeft:Math.round(act.left),cardLeft:Math.round(cr.left),cardRight:Math.round(cr.right),descDisplay:getComputedStyle(c.querySelector('.mk-desc')).display}})()`)
  const before = await measure()
  // 真实滚轮（触控板横向拖）：落在探针卡片上，横向 400px
  const pt = await page.ev("(()=>{const r=document.getElementById('mk-probe').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()")
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 400, deltaY: 0 }); await wait(600)
  const after = await measure()
  const r = { setup, before, afterWheel: after }
  console.log(JSON.stringify(r, null, 1))
  fs.writeFileSync(path.join(out, `result-${LANG}.json`), JSON.stringify(r, null, 1))
  const clip = await page.ev("(()=>{const r=document.querySelector('.mk-panel').getBoundingClientRect();return {x:Math.max(0,r.left-8),y:Math.max(0,r.top-8),width:r.width+16,height:Math.min(r.height+16,720),scale:1}})()")
  fs.writeFileSync(path.join(out, `drawer-${LANG}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png', clip })).result.data, 'base64'))
  assert.equal(setup.descTag, 'SPAN', '探针必须是已装卡片的 span 描述')
  assert.equal(before.panelOverflowX, 0, '面板没有横向溢出')
  assert.ok(before.descRight <= before.actLeft, '描述不越过右侧开关')
  assert.ok(before.srcRight <= before.actLeft, '长名字不把来源标签挤过开关')
  assert.ok(before.cardRight - before.cardLeft > 0 && before.descRight <= before.cardRight, '描述在卡片内')
  assert.equal(after.scrollLeft, 0, '横向滚轮后面板没被拖走')
  assert.equal(after.cardLeft, before.cardLeft, '横向滚轮后卡片位置不变')
  console.log('PASS')
} finally { app.kill('SIGTERM'); await wait(1500); try { app.kill('SIGKILL') } catch {}; fs.rmSync(temp, { recursive: true, force: true }) }
