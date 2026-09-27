// Isolated Electron visual check for the canvas task queue. No real user profile or CLI session.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createPlan, updateStep } from '../resources/plugins/execution-plan/lib/store.mjs'

const root = process.cwd()
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-dock-'))
const profile = path.join(temp, 'profile')
const project = path.join(temp, 'project')
const output = path.join(root, 'docs/verification/plan-dock')
for (const dir of [profile, project, output]) fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'dock-project', name: '执行清单外挂验收', path: project }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
fs.writeFileSync(path.join(profile, 'canvas.json'), JSON.stringify({ version: 1, viewMode: 'canvas', viewModePicked: true, viewport: { x: 0, y: 0, scale: 1 }, frames: [{ id: 'dock-frame', projectId: 'dock-project', name: '执行清单外挂验收', x: 20, y: 20, w: 1200, h: 740, collapsed: false, nodes: [{ id: 'dock-chat', x: 20, y: 50, w: 650, h: 590, pane: { kind: 'agent', cwd: project, cli: 'codex' } }] }], shapes: [], freeNodes: [], todos: [] }))
const plan = await createPlan(project, { sessionId: 'dock-session', turnId: 'dock-turn', ownerKey: 'node:dock-chat' }, { title: '执行清单外挂验收', steps: [{ title: '确认清单不占会话空间', criterion: '显示在右侧' }, { title: '确认逐任务圆环收起态', criterion: '点击切换' }, { title: '确认画板移动时跟随', criterion: '坐标更新' }] })

await updateStep(project, {sessionId:'dock-session',turnId:'dock-turn',ownerKey:'node:dock-chat'}, {planId:plan.planId,stepId:plan.steps[1].stepId,status:'reported_done',expectedVersion:plan.version})
const port = 9563
const env = { ...process.env, EAS_VERIFY: '1' }
for (const key of Object.keys(env)) if (key.startsWith('EAS_TERM_') || key.startsWith('EAS_CAPABILITY_')) delete env[key]
const app = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { env, stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 120; i++) { try { const value = await fn(); if (value) return value } catch {} await sleep(100) } throw Error('Timed out waiting for isolated app') }
let ws
try {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page' && x.url.includes('out/renderer')))
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const pending = new Map()
  ws.onmessage = event => { const message = JSON.parse(event.data); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); callback(message) } }
  const send = (method, params = {}) => new Promise(resolve => { const key = ++id; pending.set(key, resolve); ws.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value }
  const click = async selector => {
    await evaluate("window.__ringEvents=[];for(const type of ['mouseover','mouseout','mousemove','blur','focus'])document.addEventListener(type,e=>window.__ringEvents.push({type,x:e.clientX,y:e.clientY,target:e.target?.className,related:e.relatedTarget?.className,time:performance.now(),focused:document.hasFocus()}),true)")
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const inspect = () => evaluate("(()=>{const p=document.querySelector('.pane:has(.agent-chat-view)'),d=document.querySelector('.ac-plan-dock');if(!p||!d)return null;const a=p.getBoundingClientRect(),b=d.getBoundingClientRect();return {pane:{left:a.left,right:a.right,width:a.width},dock:{left:b.left,right:b.right,width:b.width},marker:d.classList.contains('is-collapsed'),dots:d.querySelectorAll('.ac-plan-task-ring').length,chatWidth:document.querySelector('.agent-chat-view')?.getBoundingClientRect().width}})()")
  const initial = await until(async () => { const x = await inspect(); return x?.dock.width > 0 ? x : null })
  assert.equal(initial.dock.width, 260)
  assert.ok(initial.dock.left >= initial.pane.right, JSON.stringify(initial))
  assert.ok(Math.abs(initial.chatWidth - initial.pane.width) <= 2, JSON.stringify(initial))
  const capture = async name => { await sleep(320); const result = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(result.result.data, 'base64')) }
  await capture('expanded')
  await sleep(1000)
  assert.equal((await inspect()).marker, false, 'new plan stays open before three seconds')
  const compact = await until(async () => { const x = await inspect(); return x?.marker ? x : null })
  assert.equal(compact.dock.width, 32)
  assert.equal(compact.dots, 3)
  await capture('collapsed')
  await evaluate("window.__ringEvents=[];for(const type of ['mouseover','mouseout','mousemove','blur','focus'])document.addEventListener(type,e=>window.__ringEvents.push({type,x:e.clientX,y:e.clientY,target:e.target?.className,related:e.relatedTarget?.className,time:performance.now(),focused:document.hasFocus()}),true)")
  const point = await evaluate("(()=>{const r=document.querySelector('.ac-plan-dock-marker').getBoundingClientRect();return {x:r.left+16,y:r.top+14}})()")
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',...point})
  const reopened = await until(async () => { const x = await inspect(); return x && !x.marker ? x : null })
  assert.equal(reopened.dock.width, 260)
  await sleep(3200)
  if ((await inspect()).marker) console.log(JSON.stringify(await evaluate('window.__ringEvents'),null,2))
  assert.equal((await inspect()).marker, false, 'hover prevents auto collapse')
  await capture('hover-expanded')
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:10,y:10})
  await until(async () => (await inspect())?.marker)
  await click('.ac-plan-dock-marker')
  await evaluate("document.querySelector('.pane:has(.agent-chat-view)').style.transform='translateX(80px)'")
  const moved = await until(async () => { const x = await inspect(); return x && x.dock.left > reopened.dock.left + 70 ? x : null })
  await capture('moved')
  await evaluate("document.activeElement?.blur();document.querySelector('.pane:has(.agent-chat-view)').style.transform='';window.__store.getState().setMaximizedNode({frameId:'dock-frame',nodeId:'dock-chat'})")
  const maximized = await until(async () => { const x = await inspect(); return x?.marker && x.pane.width > 800 ? x : null })
  assert.equal(maximized.dock.width, 32)
  await capture('maximized-compact')
  await click('.ac-plan-dock-marker')
  const maxOpen = await until(async () => { const x = await inspect(); return x && !x.marker && x.pane.width > 800 ? x : null })
  assert.ok(maxOpen.dock.left >= 0 && maxOpen.dock.right <= 1147, JSON.stringify(maxOpen))
  await capture('maximized-open')
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:10,y:10})
  await evaluate('document.activeElement?.blur()')
  await until(async () => (await inspect())?.marker)
  await evaluate("document.querySelector('.ac-plan-dock-marker').focus()")
  await until(async () => !(await inspect())?.marker)
  await sleep(500)
  assert.equal((await inspect()).marker, false, 'keyboard focus holds details open')
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.ac-plan-dock-detail')).transitionDuration"), '0s')
  const result = { keyboardFocus: true, reducedMotion: true, passed: true, initial, compact, reopened, moved, maximized, maxOpen }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { ws?.close(); app.kill('SIGKILL'); console.log('isolated profile:', temp) }
