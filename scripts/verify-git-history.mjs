#!/usr/bin/env node
// Real Electron settings + IPC verification in an isolated profile. No model/paid generation calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'docs/verification/git-history')
fs.mkdirSync(output, { recursive: true })
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-git-ui-'))
const g = (...args) => execFileSync('git', args, {cwd:fixture,encoding:'utf8'}).trim()
g('init','-b','main'); g('config','user.name','UI Test'); g('config','user.email','ui@example.invalid')
fs.writeFileSync(path.join(fixture,'modified.ts'),'const value = 1;\n')
fs.writeFileSync(path.join(fixture,'deleted.ts'),'old code\n')
g('add','.');g('commit','-m','Initial version');const first=g('rev-parse','HEAD')
fs.writeFileSync(path.join(fixture,'modified.ts'),'const value = 2;\n')
fs.writeFileSync(path.join(fixture,'added.ts'),'export const added = true;\n')
g('rm','deleted.ts');g('add','.');g('commit','-m','Add, remove and modify files');const second=g('rev-parse','HEAD')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-builtin-ui-'))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'git-ui-fixture',name:'Git UI test',path:fixture}]))
const supplied = process.argv.indexOf('--executable')
const executable = supplied >= 0 ? process.argv[supplied + 1] : path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const launchArgs = [...(supplied < 0 ? [root] : []), '--remote-debugging-port=0', ...(process.platform === 'darwin' ? ['--no-sandbox'] : []), '--user-data-dir=' + profile]
const env = { ...process.env, EAS_VERIFY: '1' }
for (const name of Object.keys(env)) if (name.startsWith('EAS_TERM_') || name.startsWith('EAS_CAPABILITY_')) delete env[name]
// Guard against legacy startup hooks writing real user instructions/config during validation.
const protectedRoots = ['.codex', '.claude', '.claude.json', '.eas', '.dsh'].map(name => path.join(os.homedir(), name))
const policy = '(version 1) (allow default) ' + protectedRoots.map(target => '(deny file-read* file-write* (subpath ' + JSON.stringify(target) + '))').join(' ')
const app = process.platform === 'darwin'
  ? spawn('/usr/bin/sandbox-exec', ['-p', policy, executable, ...launchArgs], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(executable, launchArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
app.stdout.on('data', chunk => { logs += chunk })
app.stderr.on('data', chunk => { logs += chunk })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let ws
const checks = []
const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message) }
try {
  let port
  for (let attempt = 0; attempt < 150; attempt++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port) break } catch {}
    if (app.exitCode !== null) throw new Error('App exited before debugger: ' + logs.slice(-1200))
    await wait(100)
  }
  if (!port) throw new Error('No debugger endpoint')
  let page
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    page = targets.find(item => item.type === 'page' && !item.url.includes('island'))
    if (page) break
    await wait(100)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', event => { const data = JSON.parse(event.data); const call = pending.get(data.id); if (call) { pending.delete(data.id); clearTimeout(call.timer); data.error ? call.reject(new Error(JSON.stringify(data.error))) : call.resolve(data.result) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value }
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate('!!window.__store && !!window.api?.capabilities')) break; await wait(100) }


  await evaluate("window.__store.getState().setViewMode('split')");
  await evaluate("window.__store.getState().openHistory("+JSON.stringify(fixture)+")");
  for(let i=0;i<60;i++){if(await evaluate("document.querySelectorAll('.history-row').length===2"))break;await wait(100)}
  check(await evaluate("document.querySelectorAll('.history-row').length===2"),'Real history renders fixture commits');
  await evaluate("document.querySelector('.history-row').click()");
  await wait(600);
  check(await evaluate("document.querySelectorAll('.history-files .git-row').length===3"),'Added/deleted/modified files rendered');
  check(await evaluate("!!document.querySelector('.history-status-A') && !!document.querySelector('.history-status-D')"),'Semantic file colors and counts rendered');
  const shot = async name => fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await shot('files');
  await evaluate("[...document.querySelectorAll('.history-row')].at(-1).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:450,clientY:240}))");
  await wait(250); await shot('menu');
  check(await evaluate("document.querySelector('.canvas-ctxmenu').innerText.includes('检出此提交')"),'Real context menu has checkout');
  await evaluate("[...document.querySelectorAll('.canvas-ctxmenu button')].find(b=>b.textContent.includes('检出此提交')).click()");
  await wait(150); await shot('checkout');
  check(await evaluate("!!document.querySelector('.history-action')"),'Checkout confirmation rendered');

  fs.writeFileSync(path.join(fixture,'ui-dirty.txt'),'keep');
  await evaluate("document.querySelector('.history-action').requestSubmit()");
  await wait(500);
  check(await evaluate("document.querySelector('.history-action').textContent.includes('未提交')"),'Confirmation surfaces dirty-worktree rejection');
  fs.unlinkSync(path.join(fixture,'ui-dirty.txt'));
  await evaluate("document.querySelector('.history-action').requestSubmit()");
  await wait(650);
  check(g('rev-parse','HEAD')===first && await evaluate("!document.querySelector('.history-action')"),'UI confirmation performs checkout');
  await evaluate("[...document.querySelectorAll('.history-feedback button')].find(b=>b.textContent.includes('返回 main')).click()");
  await evaluate("document.querySelector('.history-action').requestSubmit()");
  await wait(650);
  check(g('branch','--show-current')==='main','UI return button restores branch');
  await evaluate("document.querySelector('.history-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:450,clientY:240}))");
  await wait(100);
  await evaluate("[...document.querySelectorAll('.canvas-ctxmenu button')].find(b=>b.textContent.includes('与当前 HEAD')).click()");
  await wait(400);
  check(await evaluate("document.querySelector('.history-detail-head').textContent.includes('退出比较')"),'UI shows explicit compare direction');
  await evaluate("document.documentElement.dataset.theme='light'");
  await shot('light');

  // Real preload IPC against authorized temporary repo, never the user project.
  const call = async (action,target,name) => evaluate("window.api.git.historyAction("+[fixture,action,target,name].map(x=>JSON.stringify(x)??'undefined').join(',')+")");
  fs.writeFileSync(path.join(fixture,'dirty.txt'),'keep');
  check(!(await call('checkout',first)).ok && g('rev-parse','HEAD')===second,'IPC blocks dirty checkout');
  fs.unlinkSync(path.join(fixture,'dirty.txt'));
  check((await call('checkout',first)).ok && g('rev-parse','HEAD')===first,'IPC checks out clean fixture');
  check((await call('switch','main')).ok && g('rev-parse','HEAD')===second,'IPC returns to main');
  check((await call('branch',first,'review/ui')).ok,'IPC creates branch');
  check((await call('tag',first,'ui-tag')).ok,'IPC creates tag');
  const outside=await evaluate("window.api.git.historyAction("+JSON.stringify(root)+",'checkout',"+JSON.stringify(first)+")");
  check(!outside.ok,'Unauthorized project write rejected');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,passed:true},null,2));
  console.log(JSON.stringify({checks,passed:true,output}));
} finally {
  ws?.close()
  app.kill('SIGTERM')
  await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(2000)])
  if(app.exitCode===null && app.signalCode===null) app.kill('SIGKILL')
  fs.writeFileSync(path.join(output,'app.log'),logs)
  fs.rmSync(profile,{recursive:true,force:true})
  fs.rmSync(fixture,{recursive:true,force:true})
}
