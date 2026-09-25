// Frame context menu in an isolated Electron profile (no real credentials).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const output = process.env.EAS_VERIFY_OUTPUT || path.join(root, 'docs/verification/frame-context-menu')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-frame-menu-profile-'))
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-frame-menu-project-'))
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'frame-menu-fixture', name: '菜单验收', path: fixture }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
const executable = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const env = { ...process.env, EAS_VERIFY: '1' }
for (const name of Object.keys(env)) if (name.startsWith('EAS_TERM_') || name.startsWith('EAS_CAPABILITY_')) delete env[name]
const policy = '(version 1) (allow default) ' + ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map(n => '(deny file-read* file-write* (subpath ' + JSON.stringify(path.join(os.homedir(), n)) + '))').join(' ')
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, executable, root, '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', x => logs += x)
child.stderr.on('data', x => logs += x)
const wait = ms => new Promise(r => setTimeout(r, ms))
const sockets = []
const checks = []
function check(value, name) { if (!value) throw Error(name); checks.push(name) }
async function until(fn) { for (let i = 0; i < 120; i++) { const value = await fn(); if (value) return value; await wait(100) } throw Error('Timed out') }
async function connect(url) {
  const ws = new WebSocket(url); sockets.push(ws)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  ws.addEventListener('message', e => { const msg = JSON.parse(e.data); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout ' + method)) }, 15000); pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params })) })
  return { send, eval: async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value } }
}
try {
  const port = await until(async () => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (child.exitCode !== null) throw Error(logs.slice(-1500)) } })
  const targets = async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
  const page = await connect((await until(async () => (await targets()).find(t => t.type === 'page' && t.title === 'Eas-Term'))).webSocketDebuggerUrl)
  await until(() => page.eval('!!window.__store && !!window.api'))
  await page.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('frame-menu-fixture',80,80);s.setViewport({x:0,y:0,scale:1});s.setTheme('dark')})()")
  await until(() => page.eval("!!document.querySelector('.cframe-head')"))
  await page.eval("(()=>{const h=document.querySelector('.cframe-head'),r=h.getBoundingClientRect();h.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+16}))})()")
  await until(() => page.eval("!!document.querySelector('.canvas-ctxmenu')"))
  const top = await page.eval("[...document.querySelectorAll('.canvas-ctxmenu:not(.cctx-sub) > .cctx-item')].map(x=>({label:x.querySelector('.cctx-label')?.textContent,arrow:!!x.querySelector('.cctx-arrow'),quiet:x.classList.contains('quiet-danger'),danger:x.classList.contains('danger'),color:getComputedStyle(x).color}))")
  check(top.some(x => x.label === '组件' && x.arrow), '组件为一级子菜单且有右箭头')
  check(top.some(x => x.label === '新建' && x.arrow), '新建有右箭头')
  check(top.some(x => x.label === '删除 Frame' && x.danger && x.quiet), '删除 Frame 保留危险语义但视觉克制')
  check(top.find(x => x.label === '删除 Frame')?.color === top.find(x => x.label === '重命名')?.color, '删除项文字与普通菜单项同色')
  const hover = async label => {
    const expression = "(()=>{const x=[...document.querySelectorAll('.canvas-ctxmenu:not(.cctx-sub) > .cctx-item')].find(x=>x.querySelector('.cctx-label')?.textContent===" + JSON.stringify(label) + ");const r=x.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()"
    const r = await page.eval(expression)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
    await until(() => page.eval("!!document.querySelector('.canvas-ctxmenu.cctx-sub')"))
    return await page.eval("[...document.querySelectorAll('.canvas-ctxmenu.cctx-sub .cctx-label')].map(x=>x.textContent)")
  }
  const create = await hover('新建')
  check(create.includes('AI 对话') && create.includes('终端') && create.includes('浏览器') && !create.includes('版本管理'), '新建只含对话、终端、浏览器')
  const components = await hover('组件')
  check(['版本管理', '设计模块', '团队面板', '代码地图', '插件面板'].every(x => components.includes(x)), '组件子菜单复用完整注册表')
  await wait(500)
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, 'component-menu.png'), Buffer.from(shot.data, 'base64'))
  await page.eval("window.__store.getState().setTheme('light')")
  await wait(300)
  const light = await page.eval("(()=>{const rows=[...document.querySelectorAll('.canvas-ctxmenu:not(.cctx-sub) > .cctx-item')];return {deleteColor:getComputedStyle(rows.find(x=>x.querySelector('.cctx-label')?.textContent==='删除 Frame')).color,normalColor:getComputedStyle(rows.find(x=>x.querySelector('.cctx-label')?.textContent==='重命名')).color}})()")
  check(light.deleteColor === light.normalColor, '亮色主题删除项也保持中性文字')
  const lightShot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, 'component-menu-light.png'), Buffer.from(lightShot.data, 'base64'))
  const target = await page.eval("(()=>{const x=[...document.querySelectorAll('.canvas-ctxmenu.cctx-sub .cctx-item')].find(x=>x.querySelector('.cctx-label')?.textContent==='版本管理');const r=x.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()")
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  check(await until(() => page.eval("window.__store.getState().canvas.frames.some(f=>f.nodes.some(n=>n.component?.type==='git'))")), '点击组件子菜单实际插入注册表组件')
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks, top, create, components }, null, 2))
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ checks, error: String(error) }, null, 2))
} finally {
  for (const ws of sockets) ws.close()
  child.kill('SIGTERM')
  await Promise.race([new Promise(r => child.once('exit', r)), wait(2000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  fs.writeFileSync(path.join(output, 'app.log'), logs)
  await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await fs.promises.rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
