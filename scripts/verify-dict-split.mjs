#!/usr/bin/env node
// Real Electron settings + IPC verification in an isolated profile. No model/paid generation calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'docs/verification/dict-split')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-builtin-ui-'))
fs.writeFileSync(path.join(profile, 'skill-prefs.json'), JSON.stringify({ muted: true }))
fs.writeFileSync(path.join(profile, 'prefs.json'), JSON.stringify({ autoUpdateCheck: false, telemetry: false, island: false }))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'split-fixture',name:'交互验收',path:profile}]))
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



  async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error('condition timed out')}
  async function shot(name){await wait(350);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
  await evaluate("window.__store.getState().setViewMode('split');window.__store.getState().setActiveProject('split-fixture')")
  await until(()=>evaluate("document.querySelectorAll('.empty-state .cframe-start-btn').length===3"))
  check(await evaluate("document.querySelector('.empty-state').textContent.includes('先创建一个终端')"),'分屏空态三个AI与独立终端入口')
  check(await evaluate("[...document.querySelectorAll('.empty-state .cframe-start-name')].every(e=>e.scrollWidth<=e.clientWidth)"),'分屏三个入口名称完整可见')
  await shot('split-dark')
  for(const cli of ['claude','codex','omp']){
   const index=['claude','codex','omp'].indexOf(cli)
   await evaluate("document.querySelectorAll('.empty-state .cframe-start-btn')["+index+"].click()")
   await until(()=>evaluate("window.__store.getState().tabs.length===1"))
   check(await evaluate("(()=>{const s=window.__store.getState(),p=s.tabs[0].root.pane;return s.viewMode==='split'&&p.kind==='agent'&&p.cli==='"+cli+"'&&!p.sessionId&&s.tabs[0].projectId==='split-fixture'})()"),'真实'+cli+'启动入口保留项目及分屏，不发送模型消息')
   await evaluate("window.__store.getState().closeTab(window.__store.getState().tabs[0].id)")
   await until(()=>evaluate("document.querySelectorAll('.empty-state .cframe-start-btn').length===3"))
  }
  await evaluate("document.querySelector('.empty-state .cframe-start-term').click()")
  await until(()=>evaluate("window.__store.getState().tabs[0]?.root.pane.kind==='terminal'"))
  check(await evaluate("!!window.__store.getState().tabs[0].root.pane.ptyId&&window.__store.getState().viewMode==='split'"),'终端入口创建真实PTY且不跳画布')
  await evaluate("window.__store.getState().closeTab(window.__store.getState().tabs[0].id);window.__store.getState().setTheme('light')")
  await until(()=>evaluate("!!document.querySelector('.empty-state .cframe-start-btn')"));await shot('split-light')
  await evaluate("window.__store.getState().setTheme('dark');window.__store.getState().setViewMode('canvas');window.__store.getState().addProjectFrame('split-fixture',100,100)")
  await until(()=>evaluate("document.querySelectorAll('.cframe-start-btn').length===3"))
  check(true,'空Frame仍复用相同三个入口')
  await evaluate("window.__store.getState().setDictOpen(true)")
  await until(()=>evaluate("!!document.querySelector('.dict-seg')"))
  check(await evaluate("!document.querySelector('.dict-cats-2,.dict-cats-blk')&&!!document.querySelector('.dict-cats')&&!!document.querySelector('.dict-search')"),'辞典去掉二级和区块筛选，保留一级与搜索')
  await shot('dictionary')
  await evaluate("document.querySelectorAll('.dict-seg button')[1].click()")
  await until(()=>evaluate("document.querySelectorAll('.bp-thumb').length===10"));await shot('blueprints')
  const neutralRegions = selector => evaluate(`(()=>{const regions=[...document.querySelectorAll('${selector}')];const c=document.createElement('canvas').getContext('2d');return regions.length>0&&regions.every(e=>{const s=getComputedStyle(e.querySelector('rect'));c.fillStyle=s.stroke;const actual=c.fillStyle;return ['--t-3',...(e.closest('.bp-card:hover,.bp-card:focus-visible')?['--t-2']:[])].some(token=>{c.fillStyle=getComputedStyle(e).getPropertyValue(token).trim();return actual===c.fillStyle})})})()`)
  check(await neutralRegions('.bp-thumb .bp-region'),'缩略图默认中性色，无全彩填充')

  for(const name of ['首页','控制台 / 后台']){
   await evaluate("[...document.querySelectorAll('.bp-card')].find(e=>e.querySelector('.bp-card-n').textContent==='"+name+"').click()")
   await until(()=>evaluate("!!document.querySelector('.bp-diagram')"))
   check(await evaluate("!!document.querySelector('.bp-diagram [role=button]')&&document.querySelector('.bp-location').textContent.includes('选择区域')"),name+'SVG位置说明可见')
   const pick=name==='首页'?'标签栏':'侧边栏'
   await evaluate("[...document.querySelectorAll('.bp-region')].find(e=>e.textContent==='"+pick+"').scrollIntoView({block:'center'})")
   await wait(250)
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:70})
   await evaluate("[...document.querySelectorAll('.bp-region')].find(e=>e.textContent==='"+pick+"').focus()")
   await until(()=>evaluate("document.querySelector('.bp-location strong').textContent==='"+pick+"'"))
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
   await until(()=>evaluate("!!document.querySelector('.bp-slot-body .dict-pill')"))
   await wait(650)
   check(await evaluate("(()=>{const p=document.querySelector('.bp-view'),r=document.querySelector('.bp-slot.open').getBoundingClientRect(),b=p.getBoundingClientRect();return p.scrollTop>0&&r.top>=b.top&&r.top<b.bottom})()"),name+'选择SVG自动滚动到对应区块')
   check(await neutralRegions('.bp-diagram .bp-region:not(.is-active):not(.is-selected)'),name+'未交互区域保持中性色')
   check(await evaluate("(()=>{const a=document.querySelector('.bp-diagram .is-selected>rect'),n=document.querySelector('.bp-diagram .bp-region:not(.is-active):not(.is-selected)>rect');return getComputedStyle(a).fill!==getComputedStyle(n).fill&&getComputedStyle(a).stroke!==getComputedStyle(n).stroke})()"),name+'只有交互区域使用高亮色')
   check(true,name+'键盘聚焦定位并展开相关词条')
   await evaluate("document.querySelector('.bp-view').scrollTop=0")
   await shot(name==='首页'?'mobile':'desktop')
   await evaluate("document.querySelector('.bp-diagram .bp-region.is-selected').scrollIntoView({block:'center'})")
   await wait(120)
   const pos = await evaluate("(()=>{const r=document.querySelector('.bp-diagram .bp-region.is-selected').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1})
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1})
   await wait(650)
   check(await evaluate("document.querySelector('.bp-slot.open .bp-slot-b').textContent==='"+pick+"'&&document.querySelector('.bp-view').scrollTop>0"),name+'重复鼠标点击仍定位不折叠')
   check(await evaluate("getComputedStyle(document.querySelector('.bp-slot.open')).getPropertyValue('--bp-color')===getComputedStyle(document.querySelector('.bp-diagram .bp-region.is-selected')).getPropertyValue('--bp-color')"),name+'图与词条同色')
   await shot(name==='首页'?'mobile-jump':'desktop-jump')
   // Move the pointer off the scrolling panel before testing keyboard-only focus.
   // Otherwise scroll-induced mouseenter may legitimately replace the inspected region.
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:70})
   await evaluate("document.querySelector('.bp-slot-hd').focus()")
   await until(()=>evaluate("document.querySelector('.bp-region.is-active text').textContent===document.querySelector('.bp-slot-b').textContent"))
   check(true,name+'列表聚焦联动SVG高亮')
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
   check(await evaluate("getComputedStyle(document.querySelector('.bp-region.is-active .bp-region-pulse')).animationName==='none'"),'减少动态时停止呼吸动画：'+name)
   await send('Emulation.setEmulatedMedia',{features:[]})
   await evaluate("document.querySelector('.bp-back').click()")
  }
  for (const [name,block,file] of [['列表 / 分类页','列表','mobile-list'],['详情页','图集','mobile-detail'],['表单 / 提交页','表单','mobile-form']]) {
    await evaluate("[...document.querySelectorAll('.bp-card')].find(e=>e.querySelector('.bp-card-n')?.textContent==='"+name+"').click()")
    await until(()=>evaluate("!!document.querySelector('.bp-diagram')"))
    check(await evaluate("(()=>{const g=[...document.querySelectorAll('.bp-diagram .bp-region')].find(e=>e.textContent==='"+block+"');return !!g?.querySelector('.bp-wireframe')&&g.querySelector('.bp-wireframe').children.length>1})()"),name+'主体区块有可辨认线框')
    await wait(400)
    check(await evaluate("document.querySelector('.bp-view').scrollTop<5"),name+'切换后从蓝图顶部显示')
    await shot(file)
    await evaluate("[...document.querySelectorAll('.bp-diagram .bp-region')].find(e=>e.textContent==='"+block+"').focus()")
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await until(()=>evaluate("document.querySelector('.bp-slot.open .bp-slot-b')?.textContent==='"+block+"'"))
    check(await evaluate("document.querySelector('.bp-diagram .bp-region.is-selected text')?.textContent==='"+block+"'"),name+'键盘选择与词条区块联动')
    await evaluate("document.querySelector('.bp-back').click()")
    await until(()=>evaluate("document.querySelectorAll('.bp-card').length===10"))
  }
  await evaluate("window.__store.getState().setTheme('light');document.querySelector('.bp-card').click()")
  await until(()=>evaluate("!!document.querySelector('.bp-diagram')"));check(await neutralRegions('.bp-diagram .bp-region:not(.is-active):not(.is-selected)'),'浅色主题未交互区域保持中性');await shot('blueprint-light')
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,passed:true},null,2))
  console.log(JSON.stringify({checks,passed:true,output}))
} finally {
  ws?.close()
  app.kill('SIGTERM')
  await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(2000)])
  if(app.exitCode===null && app.signalCode===null) app.kill('SIGKILL')
  fs.writeFileSync(path.join(output,'app.log'),logs)
  fs.rmSync(profile,{recursive:true,force:true})
}
