// 隔离实例：AI 对话里点开图片 —— 要在屏幕正中、显示原图（不是 384px 缩略图）、能滚轮/按钮缩放。
// 从主进程回放 agentChat 事件（不连模型），图片是现场画的 2400×1600 细字 PNG。截图到 docs/verification/chat-image-viewer/。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import assert from 'node:assert/strict'
const LANG = process.env.EAS_VERIFY_LANG === 'en' ? 'en' : 'zh'
const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-civ-')), profile = path.join(temp, 'p'), home = path.join(temp, 'h'), cwd = path.join(temp, 'proj')
const out = path.join(root, process.env.EAS_VERIFY_OUTPUT ?? 'docs/verification/chat-image-viewer'); for (const d of [profile, home, cwd, out]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false, lang: LANG }))
const env = { ...process.env, HOME: home, EAS_VERIFY: '1' }; for (const k of Object.keys(env)) if (k.startsWith('EAS_TERM_') || k.startsWith('EAS_CAPABILITY_') || /TOKEN|SECRET|API_KEY|PASSWORD/.test(k)) delete env[k]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, '--remote-debugging-port=0', '--inspect=9541', '--use-mock-keychain', '--user-data-dir=' + profile], { env, stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, n = 300) { for (let i = 0; i < n; i++) { const v = await f(); if (v) return v; await wait(100) } throw Error('timeout') }
async function connect(url) { const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r)); let id = 0; const P = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); P.get(m.id)?.(m); P.delete(m.id) }; const send = (method, params = {}) => new Promise((r) => { const k = ++id; P.set(k, r); ws.send(JSON.stringify({ id: k, method, params })) }); return { ws, send, ev: async (x) => { const m = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description ?? 'eval failed'); return m.result?.result?.value } } }
const shot = async (page, name) => fs.writeFileSync(path.join(out, `${name}-${LANG}.png`), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
const results = {}
try {
  const dp = await until(() => { try { return +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] } catch { return 0 } })
  const page = await connect((await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find((x) => x.type === 'page' && x.title === 'Eas-Term') } catch { return null } })).webSocketDebuggerUrl)
  const main = await connect((await until(async () => { try { return (await (await fetch('http://127.0.0.1:9541/json/list')).json())[0] } catch { return null } })).webSocketDebuggerUrl)
  await until(() => page.ev('!!window.__store')); await wait(1500)
  for (let i = 0; i < 30; i++) { if (await page.ev("(()=>{const b=document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()")) break; await wait(100) }
  const sid = 'ac-civ-' + Date.now()
  await page.ev(`(()=>{window.__store.setState({viewMode:'split',projects:[{id:'p',name:'demo',path:${JSON.stringify(cwd)},addedAt:1}],tabs:[{id:'t',title:'AI',projectId:'p',cwd:${JSON.stringify(cwd)},activeLeafId:'l',root:{type:'leaf',id:'l',pane:{kind:'agent',cli:'claude',resumeCli:'claude',sessionId:'${sid}',cwd:${JSON.stringify(cwd)}}}}],activeTabId:'t'});return true})()`)
  await wait(2500)
  // 2400×1600 的细字图：缩略图（384px）放大后字会糊成一片，原图能看清
  const dataUrl = await page.ev(`(()=>{const c=document.createElement('canvas');c.width=2400;c.height=1600;const g=c.getContext('2d');g.fillStyle='#f4f1ea';g.fillRect(0,0,2400,1600);g.fillStyle='#1d2433';g.font='22px Menlo, monospace';for(let y=40,i=0;y<1600;y+=34,i++)g.fillText('line '+String(i).padStart(2,'0')+' — the quick brown fox jumps over the lazy dog 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ',30,y);g.strokeStyle='#c0392b';g.lineWidth=6;g.strokeRect(3,3,2394,1594);return c.toDataURL('image/png')})()`)
  const E = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
  const emit = (e) => main.ev(`${E}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('agentChat:event',${JSON.stringify({ sessionId: sid, event: e })})`)
  await emit({ k: 'user.message', text: '画一张测试图' }); await emit({ k: 'turn.start' })
  await emit({ k: 'images', images: [{ url: dataUrl, mimeType: 'image/png' }] })
  await emit({ k: 'text.done', text: '图画好了。' }); await emit({ k: 'turn.done', usage: { inputTokens: 1, outputTokens: 1 } })
  await until(() => page.ev("!!document.querySelector('.ac-returned-images img')"))
  await wait(800)
  results.thumb = await page.ev("(()=>{const i=document.querySelector('.ac-returned-images img');return {natural:[i.naturalWidth,i.naturalHeight],insideMd:!!i.closest('.ac-md'),insideTurnImgs:!!i.closest('.ac-turn-imgs')}})()")
  await page.ev("(document.querySelector('.ac-returned-images button')||document.querySelector('.ac-returned-images img')).click();true")
  await wait(1500)
  const probe = `(()=>{const d=[...document.querySelectorAll('dialog[open]')].pop();if(!d)return null;const img=d.querySelector('img');const r=img.getBoundingClientRect();const m=new DOMMatrix(getComputedStyle(img).transform);
    return {dialogClass:d.className,viewport:[innerWidth,innerHeight],natural:[img.naturalWidth,img.naturalHeight],scale:+m.a.toFixed(4),shown:[Math.round(r.width),Math.round(r.height)],center:[Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)],pct:d.querySelector('.izoom-pct')?.textContent,bar:[...d.querySelectorAll('.izoom-bar button')].map(b=>b.getAttribute('aria-label'))}})()`
  const S = () => page.ev(probe)
  // 图上某一点（原图像素坐标）此刻在屏幕上的位置
  const screenOf = (u, v) => page.ev(`(()=>{const img=[...document.querySelectorAll('dialog[open] img')].pop();const r=img.getBoundingClientRect();return [r.left+${u}*r.width/img.naturalWidth, r.top+${v}*r.height/img.naturalHeight]})()`)
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol
  const opened = results.opened = await S()
  await shot(page, 'opened')
  assert.ok(opened, '点开后有弹窗'); assert.match(opened.dialogClass, /image-popup/)
  assert.deepEqual(opened.natural, [2400, 1600], '放大看的是原图，不是 384px 缩略图')
  assert.ok(near(opened.center[0], opened.viewport[0] / 2) && near(opened.center[1], opened.viewport[1] / 2), `居中：图心 ${opened.center} vs 窗口中心 ${opened.viewport.map(x => x / 2)}`)
  assert.ok(opened.shown[0] <= opened.viewport[0] - 90 && opened.shown[1] <= opened.viewport[1] - 90, '适应窗口：整张图都在屏幕内')
  assert.equal(opened.bar.length, 4, '缩放工具条四个按钮')
  // 滚轮放大：光标下那一点不动
  const cx = Math.round(opened.viewport[0] * 0.3), cy = Math.round(opened.viewport[1] * 0.35)
  const rect0 = await page.ev("(()=>{const img=[...document.querySelectorAll('dialog[open] img')].pop();const r=img.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
  const u = (cx - rect0[0]) / rect0[2] * 2400, v = (cy - rect0[1]) / rect0[3] * 1600
  for (let i = 0; i < 4; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120 }); await wait(120) }
  await wait(300)
  const zoomed = results.wheelIn = await S(); const anchor = await screenOf(u, v)
  assert.ok(zoomed.scale > opened.scale * 1.5, `滚轮放大 ${opened.scale} → ${zoomed.scale}`)
  assert.ok(near(anchor[0], cx, 3) && near(anchor[1], cy, 3), `光标下那一点不动：${anchor.map(Math.round)} vs ${[cx, cy]}`)
  // 拖动
  const before = zoomed.center
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
  for (let k = 1; k <= 6; k++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + k * 20, y: cy + k * 10, button: 'left', buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 120, y: cy + 60, button: 'left', clickCount: 1 }); await wait(300)
  const dragged = results.dragged = await S()
  assert.ok(dragged, '拖完弹窗还在（拖动结束不算点遮罩）')
  assert.ok(dragged.center[0] - before[0] > 60, `拖动平移 ${before} → ${dragged.center}`)
  await shot(page, 'zoomed')
  // 1:1
  await page.ev("[...document.querySelectorAll('dialog[open] .izoom-bar [data-zoom=actual]')].pop().click();true"); await wait(300)
  const actual = results.actual = await S()
  assert.equal(actual.scale, 1, '1:1 按钮'); assert.equal(actual.pct, '100%')
  await shot(page, 'actual')
  // 键盘：- 缩小、0 回适应
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '-', code: 'Minus', text: '-' }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '-', code: 'Minus' }); await wait(250)
  results.keyMinus = await S(); assert.ok(results.keyMinus.scale < 1, '- 键缩小')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '0', code: 'Digit0', text: '0' }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '0', code: 'Digit0' }); await wait(250)
  results.keyZero = await S(); assert.equal(results.keyZero.scale, opened.scale, '0 键回到适应窗口')
  // 双击：适应 → 1:1 → 适应
  const dbl = async () => { await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 2 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 2 }); await wait(300) }
  await dbl(); results.dbl1 = await S(); assert.equal(results.dbl1.scale, 1, '双击到 1:1')
  await dbl(); results.dbl2 = await S(); assert.equal(results.dbl2.scale, opened.scale, '再双击回适应窗口')
  // 点空白处关闭
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: Math.round(opened.viewport[1] / 2), button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: Math.round(opened.viewport[1] / 2), button: 'left', clickCount: 1 }); await wait(400)
  results.closedByBackdrop = !(await page.ev("!!document.querySelector('dialog[open]')"))
  assert.ok(results.closedByBackdrop, '点空白处关闭')
  // 第二种：自己贴的图。消息里只有 96px 缩略图（usePastedImages.THUMB_PX），原图在磁盘上（data-tip 是路径）。
  // 按 MessageList.UserMessageImage 的原样结构插一张，点开必须是磁盘上的原图。
  const big = path.join(cwd, 'pasted-big.png')
  fs.writeFileSync(big, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
  await page.ev(`(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;c.getContext('2d').fillStyle='#888';c.getContext('2d').fillRect(0,0,96,64);
    const box=document.createElement('div');box.className='ac-turn-imgs';const img=document.createElement('img');img.src=c.toDataURL();img.alt='pasted-big.png';img.dataset.tip=${JSON.stringify(big)};img.id='civ-pasted';box.append(img);
    document.querySelector('.ac-messages').append(box);img.scrollIntoView({block:'center'});return true})()`)
  await wait(300)
  await page.ev("document.getElementById('civ-pasted').click();true")
  await until(() => page.ev("(()=>{const i=[...document.querySelectorAll('dialog[open] img')].pop();return !!i&&i.naturalWidth>0})()"))
  await wait(400)
  results.pasted = await S()
  await shot(page, 'pasted')
  assert.deepEqual(results.pasted.natural, [2400, 1600], `自己贴的图放大看原图，不是 96px 缩略图：${results.pasted.natural}`)
  assert.ok(near(results.pasted.center[0], results.pasted.viewport[0] / 2) && near(results.pasted.center[1], results.pasted.viewport[1] / 2), '自己贴的图同样居中')
  results.passed = true
  console.log(JSON.stringify(results, null, 1))
  console.log('PASS')
} finally { fs.writeFileSync(path.join(out, `result-${LANG}.json`), JSON.stringify(results, null, 1)); app.kill('SIGTERM'); await wait(1500); try { app.kill('SIGKILL') } catch {}; fs.rmSync(temp, { recursive: true, force: true }) }
