import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'

const root = process.cwd()
const output = process.env.EAS_VERIFY_OUTPUT || path.join(root, 'docs/verification/idle-window-recovery')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-live-page-profile-'))
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-live-page-project-'))
fs.writeFileSync(path.join(profile, 'projects.json'), JSON.stringify([{ id: 'live-page-project', name: '页面验收', path: project }]))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  const body = '<!doctype html><html><title>Live Page Fixture</title><body style="background:#dce9ff;font:24px sans-serif"><h1>LIVE PAGE VERIFIED</h1><input id="name" placeholder="Name"><button id="action" onclick="document.querySelector(\'h1\').textContent=\'CLICKED\'">Click me</button></body></html>'
  if (req.url === '/slow') setTimeout(() => res.end(body), 600)
  else res.end(body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port + '/'
const executable = process.env.EAS_VERIFY_ELECTRON || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const env = { ...process.env, EAS_VERIFY: '1' }
for (const name of Object.keys(env)) if (name.startsWith('EAS_TERM_') || name.startsWith('EAS_CAPABILITY_')) delete env[name]
const policy = '(version 1) (allow default) ' + ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map(n => '(deny file-read* file-write* (subpath ' + JSON.stringify(path.join(os.homedir(), n)) + '))').join(' ')
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, executable, root, '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', x => logs += x)
child.stderr.on('data', x => logs += x)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async fn => { for (let i = 0; i < 350; i++) { const value = await fn(); if (value) return value; await wait(100) } throw Error('Timed out') }
const checks = []
function check(value, name) { if (!value) throw Error(name); checks.push(name) }
let ws,send
try {
  const port = await until(async () => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch { if (child.exitCode !== null) throw Error(logs.slice(-2000)) } })
  const targets = async () => await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  const target = await until(async () => (await targets()).find(item => item.type === 'page' && item.title === 'Eas-Term'))
  const connect = async target => {
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  let id=0; const pending=new Map(); const socket=ws
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
  socket.addEventListener('close',()=>{for(const p of pending.values())p.reject(Error('renderer replaced'));pending.clear()})
  send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method))},10000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});socket.send(JSON.stringify({id:key,method,params}))})
  }; await connect(target)
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value }
  const motionSamples = async selector => evaluate("new Promise(resolve=>{const samples=[],start=performance.now(),panel=document.querySelector('.live-page-drawer');let done=false;const finish=()=>{if(!done){done=true;resolve(samples)}};setTimeout(finish,1200);document.querySelector(" + JSON.stringify(selector) + ").click();const tick=()=>{if(done)return;samples.push(new DOMMatrix(getComputedStyle(panel).transform).m41);if(performance.now()-start<580)requestAnimationFrame(tick);else finish()};requestAnimationFrame(tick)})")
  const endpoint = await until(async () => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'mcp-endpoint.json'), 'utf8')) } catch { return null } })
  const invoke = async (tool, args, leafId) => (await (await fetch('http://127.0.0.1:' + endpoint.port + '/invoke', { method: 'POST', headers: { 'x-eas-token': endpoint.token, 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, ctx: { agentLeafId: leafId } }) })).json())
  await until(() => evaluate('!!window.__store && !!window.api?.livePage'))
  await until(() => evaluate("!!document.querySelector('.onb-actions .onb-ghost')"))
  const dismiss = await evaluate("(()=>{const r=document.querySelector('.onb-actions .onb-ghost').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
  await send('Input.dispatchMouseEvent', {type:'mousePressed',...dismiss,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',...dismiss,button:'left',clickCount:1})
  await until(() => evaluate("!document.querySelector('.onb-mask')"))
  check(await evaluate('window.api.agentChat.saveHistory("recovery-a",[{role:"user",text:"历史消息恢复验收",execs:[]}],null,'+JSON.stringify(project)+')'),'真实聊天记录写盘')
  const tabs=[{id:'recovery-tab',title:'分屏恢复验收',projectId:'live-page-project',cwd:project,activeLeafId:'recovery-a',root:{type:'split',id:'split-r',dir:'row',ratio:0.55,children:['a','b'].map(id=>({type:'leaf',id:'recovery-'+id,pane:{kind:'agent',cwd:project,cli:'codex'}}))}}]
  await evaluate('window.__store.setState('+JSON.stringify({tabs,activeTabId:'recovery-tab',viewMode:'split'})+')')
  await until(()=>evaluate('document.querySelectorAll(".ac-input").length===2'))
  await until(()=>evaluate('document.body.textContent.includes("历史消息恢复验收")'))
  await evaluate('document.querySelector(".ac-input").scrollIntoView({block:"center"})');await wait(300)
  const point=await evaluate('(()=>{const r=document.querySelector(".ac-input").getBoundingClientRect();return {x:r.x+40,y:r.y+20}})()')
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
  await send('Input.insertText',{text:'未发送草稿：恢复后不能丢失'})
  check(await evaluate('document.querySelector(".ac-input").value.includes("未发送草稿")'),'真实输入草稿')
  await evaluate('(async()=>{const c=document.createElement("canvas");c.width=40;c.height=30;c.getContext("2d").fillRect(0,0,40,30);const b=await new Promise(r=>c.toBlob(r,"image/png"));const d=new DataTransfer();d.items.add(new File([b],"draft.png",{type:"image/png"}));document.querySelector(".ac-input").dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:d}))})()')
  await until(()=>evaluate('!!document.querySelector(".ac-attachments img") || !!document.querySelector(".ac-attach img")'))
  const checkpoint=await until(()=>evaluate('window.__recoveryVerify.prepare()'))
  check(checkpoint.values.workspace.tabs[0].root.ratio===0.55,'保存分屏比例及原始标签布局')
  const images=checkpoint.values['images:recovery-a:startup']
  check(images?.length===1&&fs.existsSync(images[0].path),'图片已实际落盘且进入检查点')
  fs.writeFileSync(path.join(output,'before.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await wait(3000)
  await evaluate('window.api.runtimeSetIdleRecovery(false)')
  await evaluate('window.api.idleRecovery.test()');await wait(600)
  check((await targets()).some(t=>t.id===target.id)&&!(await evaluate('window.api.idleRecovery.status()')).last,'关闭自动恢复时不替换窗口')
  await evaluate('window.api.runtimeSetIdleRecovery(true)')
  await evaluate('window.__store.getState().requestConfirm({message:"恢复中不得丢弃确认",onConfirm:()=>{}})')
  let vetoed=false
  for(let i=0;i<10&&!vetoed;i++){await evaluate('window.api.idleRecovery.test()');await wait(800);vetoed=(await evaluate('window.api.idleRecovery.status()')).lastFailure==='prepare-or-activity'}
  check((await targets()).some(t=>t.id===target.id)&&vetoed,'未完成确认时真实主进程拒绝替换')
  await evaluate('window.__store.getState().cancelConfirm()');await wait(500)
  await evaluate('window.dispatchEvent(new CustomEvent("eas:open-settings"))');await wait(300)
  check(await evaluate('window.__recoveryVerify.prepare().then(x=>x===null)'), '设置弹窗阻止恢复以保留局部未保存状态')
  await evaluate('document.querySelector(".cset-overlay").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))');await wait(300)
  await evaluate('window.api.idleRecovery.test()')
  const next=await until(async()=>{
   const list=await targets(); const newer=list.find(t=>t.type==='page'&&t.id!==target.id&&t.title==='Eas-Term')
   if(newer&&!list.some(t=>t.id===target.id))return newer
   return null
  }).catch(async e=>{console.error(await evaluate('window.api.idleRecovery.status()'));throw e})
  await connect(next)
  const status=await evaluate('window.api.idleRecovery.status()')
  const canvasRead=await invoke('canvas_get_state',{},'recovery-a')
  check(canvasRead.ok===true,'恢复后真实MCP工具路由到新窗口并完成调用')
  check(status.last?.oldPid!==status.last?.newPid&&status.last?.newPid>0,'真实新旧渲染进程PID不同')
  check(!(await targets()).some(t=>t.id===target.id),'旧窗口销毁、新窗口接管')
  await until(()=>evaluate('document.querySelectorAll(".ac-input").length===2'))
  check(await evaluate('document.querySelector(".ac-input").value.includes("未发送草稿")'),'真实新窗口恢复草稿')
  check(fs.existsSync(images[0].path),'交接卸载不会误删未发送图片')
  check(await until(()=>evaluate('Array.from(document.querySelectorAll(".ac-attachments img,.ac-attach img")).some(i=>i.complete&&i.naturalWidth>0)')),'恢复后图片缩略图可见')
  check(await evaluate('window.__store.getState().tabs[0].root.children[1].id==="recovery-b"'),'恢复分屏第二个面板ID')
  check(await until(()=>evaluate('document.body.textContent.includes("历史消息恢复验收")')),'真实聊天历史恢复显示')
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:10});await wait(500)
  fs.writeFileSync(path.join(output,'restored.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await until(()=>evaluate('window.__recoveryVerify.prepare()'))
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await send('Input.insertText',{text:'新编辑'})
  check(await evaluate('(()=>{try{window.__recoveryVerify.remount();return false}catch{return true}})()'),'检查点之后新编辑阻止恢复')
  await evaluate('window.__store.getState().requestConfirm({message:"未完成确认",onConfirm:()=>{}})')
  check(await evaluate('window.__recoveryVerify.prepare().then(x=>x===null)'),'确认弹窗阻止恢复')
  await evaluate('window.__store.getState().cancelConfirm()')
  fs.writeFileSync(path.join(output,'after.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scope:'actual new BrowserWindow and renderer process; manual trigger, not wall-clock hour',checks},null,2))
  console.log(JSON.stringify({passed:true,checks},null,2))
} catch (error) {
  if(send)try{const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'failure.png'),Buffer.from(shot.data,'base64'))}catch{}
  console.error(error)
  process.exitCode = 1
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ checks, error: String(error) }, null, 2))
} finally {
  ws?.close()
  child.kill('SIGTERM')
  server.close()
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  if (process.exitCode) fs.writeFileSync(path.join(output, 'app.log'), logs)
  else fs.rmSync(path.join(output, 'app.log'), { force: true })
  await fs.promises.rm(profile, { recursive: true, force: true })
  await fs.promises.rm(project, { recursive: true, force: true })
}
