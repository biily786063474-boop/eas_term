// Actual isolated app + fixture events; never starts a CLI or changes the installed app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-island-dock-')),profile=path.join(temp,'profile'),home=path.join(temp,'home')
for(const d of [profile,home])fs.mkdirSync(d)
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({island:true,autoUpdateCheck:false,telemetry:false}))
const out=path.join(root,process.env.ISLAND_DOCK_OUT??'docs/verification/island-dock-20260928');fs.mkdirSync(out,{recursive:true})
const env={...process.env,EAS_VERIFY:'1',HOME:home};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--inspect=0','--remote-debugging-port=0','--user-data-dir='+profile,'--use-mock-keychain'],{env,stdio:['ignore','pipe','pipe']})
let logs='';app.stdout.on('data',x=>logs+=x);app.stderr.on('data',x=>logs+=x)
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[],observed={}
async function until(fn,label){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await sleep(100)}throw Error('timeout: '+label)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};const send=async(method,params={})=>{const id=++seq;let timer;try{const r=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}))});if(r.error)throw Error(JSON.stringify(r.error));return r.result}finally{clearTimeout(timer)}};return {send,eval:async expression=>{console.log('eval',expression.slice(0,160));const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}}}
const native=()=>JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");var a=$.NSRunningApplication.runningApplicationWithProcessIdentifier('+app.pid+');JSON.stringify({front:Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),policy:Number(a.activationPolicy)})'],{encoding:'utf8'}))
const E="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
let main,page,helper
const nativeClick=async(p,selector)=>{
 const r=await p.eval('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b)throw Error("button missing");const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
 const b=await main.eval(E+".BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/island.html')).getContentBounds()")
 const x=b.x+r.x,y=b.y+r.y
 execFileSync('/usr/bin/swift',['-e','import ApplicationServices; let p=CGPoint(x:'+x+',y:'+y+'); for t:CGEventType in [.mouseMoved,.leftMouseDown,.leftMouseUp] { CGEvent(mouseEventSource:nil,mouseType:t,mouseCursorPosition:p,mouseButton:.left)?.post(tap:.cghidEventTap); usleep(80000) }'])
}

const shot=async(p,name)=>{const s=await p.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(s.data,'base64'))}
try{
 main=await connect(await until(()=>logs.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1],'main inspector'))
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{}},'renderer port')
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 page=await connect((await until(async()=>(await targets()).find(t=>t.url.endsWith('/index.html')),'main page')).webSocketDebuggerUrl)
 await page.send('Runtime.enable');await sleep(2500);await until(()=>page.eval('!!window.__store&&!!window.api'),'store');await page.eval("document.querySelector('.onb-ghost')?.click()");await sleep(300)
 await main.eval('globalThis.__dockMain='+E+".BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));true")
 const sid='ac-dock-fixture',tab={id:'dock-tab',title:'Dock 回归任务',projectId:'dock-project',cwd:temp,activeLeafId:'dock-leaf',root:{type:'leaf',id:'dock-leaf',pane:{kind:'agent',cwd:temp,cli:'codex',sessionId:sid}}}
 const frame={id:'dock-frame',projectId:'dock-project',name:'Dock 焦点验收',x:30,y:30,w:850,h:650,collapsed:false,nodes:[{id:'dock-node',leafId:'dock-leaf',x:16,y:50,w:800,h:547}]}
 await page.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",projects:[{id:"dock-project",name:"Dock 焦点验收",path:'+JSON.stringify(temp)+'}],tabs:['+JSON.stringify(tab)+'],activeTabId:"dock-tab",canvas:{...s.canvas,frames:['+JSON.stringify(frame)+']}})})()')
 await page.eval('window.api.prefs.set("island",true)');await sleep(1000)
 const assertDock=async label=>{if(process.env.ISLAND_DOCK_BASELINE){checks.push(label+' (baseline dock='+await main.eval(E+'.app.dock.isVisible()')+' policy='+native().policy+')');return}assert.equal(await main.eval(E+'.app.dock.isVisible()'),true,label);assert.equal(native().policy,0,label+' native policy');checks.push(label)}
 await assertDock('startup Dock present / regular app')
 const helperScript=path.join(temp,'foreground.swift'),helperState=path.join(temp,'foreground-state.json'),helperMode=path.join(temp,'foreground-mode'),helperBinary=path.join(temp,'foreground')
 fs.writeFileSync(helperScript,[
 'import AppKit',
 'let app = NSApplication.shared',
 'app.setActivationPolicy(.regular)',
 'let w = NSWindow(contentRect:NSRect(x:100,y:100,width:1000,height:650),styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false)',
 'w.title = "Independent native foreground fixture"',
 'w.backgroundColor = NSColor.darkGray',
 'w.makeKeyAndOrderFront(nil)',
 'app.activate(ignoringOtherApps:true)',
 'try! "{}".write(toFile:'+JSON.stringify(helperState)+',atomically:true,encoding:.utf8)',
 'app.run()'].join('\n'))
 execFileSync('/usr/bin/swiftc',[helperScript,'-o',helperBinary])
 helper=spawn(helperBinary,[],{env,stdio:'ignore'})
 await until(()=>fs.existsSync(helperState),'foreground helper')
 const otherForeground=async()=>{execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");$.NSRunningApplication.runningApplicationWithProcessIdentifier('+helper.pid+').activateWithOptions(3)']);try{await until(()=>native().front===helper.pid,'other application foreground')}catch(e){console.log('FG-DUMP helper='+helper.pid+' exit='+helper.exitCode+' app='+app.pid+' front='+native().front+' name='+execFileSync('/bin/ps',['-o','comm=','-p',String(native().front)],{encoding:'utf8'}).trim());throw e}}

 if(process.env.ISLAND_DOCK_PROBE3){
  console.log('P3-start focused='+await main.eval('__dockMain.isFocused()')+' front='+native().front+' app='+app.pid)
  await main.eval('__dockMain.minimize()');await otherForeground();await sleep(500)
  await main.eval('__dockMain.restore();__dockMain.show();'+E+'.app.focus({steal:true});__dockMain.moveTop();__dockMain.focus();__dockMain.webContents.focus();true');await sleep(1500)
  console.log('P3-steal focused='+await main.eval('__dockMain.isFocused()')+' front='+native().front)
  await main.eval('__dockMain.minimize()');await otherForeground();await sleep(500)
  execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");$.NSRunningApplication.runningApplicationWithProcessIdentifier('+app.pid+').activateWithOptions(1)'])
  await main.eval('__dockMain.restore();__dockMain.focus();true');await sleep(1500)
  console.log('P3-external-activate focused='+await main.eval('__dockMain.isFocused()')+' front='+native().front)
  process.exit(0)
 }
 const emit=async e=>main.eval("__dockMain.webContents.send('agentChat:event',"+JSON.stringify({sessionId:sid,event:e})+')')
 const notice=async n=>{await emit({k:'turn.start'});await emit({k:'text.done',text:'隔离通知 '+n});await emit({k:'turn.done',usage:{input:1,output:1}})}
 const island=async()=>connect((await until(async()=>(await targets()).find(t=>t.url.includes('/island.html')),'island page')).webSocketDebuggerUrl)
 await main.eval('__dockMain.minimize()');await otherForeground();await sleep(800);const foreground=native().front;assert.notEqual(foreground,app.pid,'another application must own foreground')
 await notice('首次');const isl=await island();await sleep(700)
 assert.equal(native().front,foreground,'notification must not change native foreground');await assertDock('background notification retains Dock');checks.push('notification does not take native foreground')
 const wstate=await main.eval(E+".BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/island.html')).map(w=>({visible:w.isVisible(),focusable:w.isFocusable(),focused:w.isFocused(),allSpaces:w.isVisibleOnAllWorkspaces()}))")
 assert.equal(wstate[0].visible,true);assert.equal(wstate[0].focusable,false);assert.equal(wstate[0].focused,false);assert.equal(wstate[0].allSpaces,true);checks.push('visible nonfocusable island across workspaces');await shot(isl,'notification')
 if(!process.env.ISLAND_DOCK_SKIP_DISMISS){await until(()=>isl.eval("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('知道了'))"),'dismiss button')
 await isl.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('知道了')).setAttribute('data-dock-dismiss','true')");await nativeClick(isl,'[data-dock-dismiss]');await sleep(500);observed.dismissKeptForeground=native().front===foreground;console.log('OBSERVED dismissKeptForeground='+observed.dismissKeptForeground);if(!process.env.ISLAND_DOCK_OBSERVE_DISMISS)assert.equal(native().front,foreground);await assertDock('dismiss retains Dock')}else{await main.eval('__dockMain.webContents.send("island:action",{type:"dismiss",key:"x"})');}
 await notice('点击任务');const isl2=await island();await sleep(600)
 await until(()=>isl2.eval("!!document.querySelector('.isl-btn.primary')"),'task button');if(process.env.ISLAND_DOCK_JS_CLICK)await isl2.eval("document.querySelector('.isl-btn.primary').click();true");else await nativeClick(isl2,'.isl-btn.primary')
 await until(()=>native().front===app.pid,'task activation');try{await until(()=>main.eval('__dockMain.isFocused()&&__dockMain.webContents.isFocused()'),'main window and contents focused after task click');observed.taskClickFocused=true}catch(e){observed.taskClickFocused=false;console.log('FOCUS-DUMP '+JSON.stringify(await main.eval(E+'.BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL().split("/").pop(),min:w.isMinimized(),vis:w.isVisible(),foc:w.isFocused(),wcf:w.webContents.isFocused()}))'))+' focused='+await main.eval(E+'.BrowserWindow.getFocusedWindow()?.webContents.getURL()')+' native='+JSON.stringify(native()));if(process.env.ISLAND_DOCK_REFOCUS_PROBE){await main.eval('__dockMain.focus();true');await sleep(500);console.log('REFOCUS-1 '+await main.eval('__dockMain.isFocused()'));await main.eval(E+'.app.focus({steal:true});__dockMain.focus();true');await sleep(500);console.log('REFOCUS-2 '+await main.eval('__dockMain.isFocused()'))}if(!process.env.ISLAND_DOCK_OBSERVE_FOCUS)throw e};assert.equal(await page.eval('window.__store.getState().activeTabId'),'dock-tab')
 await sleep(700);assert.equal(await main.eval(E+".BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('/island.html')&&w.isVisible())"),false);await assertDock('task click activates normal app and removes island hit layer');await shot(page,'task-focused')
 for(let i=0;i<3;i++){await main.eval('__dockMain.minimize()');await main.eval(E+'.app.hide()');await otherForeground();await sleep(350);const before=native().front;assert.notEqual(before,app.pid);await notice('重复'+i);await island();await sleep(500);assert.equal(native().front,before);await assertDock('cycle '+i+' Dock');await page.eval('window.api.prefs.set("island",false)');await sleep(500);await assertDock('cycle '+i+' destroyed Dock');await page.eval('window.api.prefs.set("island",true)')}
 await page.eval('window.api.prefs.set("island",false)')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,observed,fixtureTasks:true,nativeForegroundChecked:true,taskClicks:'native CGEvent mouse clicks on actual panel buttons',unverified:['manual Mission Control switching','foreign app native fullscreen overlap','Windows'],profile},null,2));console.log(JSON.stringify({passed:true,checks,observed},null,2))
}catch(error){try{if(page)await shot(page,'failure')}catch{};fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),checks},null,2));throw error}
finally{helper?.kill('SIGTERM');for(const ws of sockets)ws.close();app.kill('SIGTERM');await Promise.race([new Promise(r=>app.once('exit',r)),sleep(3000)]);if(app.exitCode===null&&app.signalCode===null)app.kill('SIGKILL');fs.writeFileSync(path.join(out,'app.log'),logs)}
