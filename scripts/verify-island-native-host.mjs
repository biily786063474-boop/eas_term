// Actual isolated app + fixture events; never starts a CLI or changes the installed app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-island-dock-')),profile=path.join(temp,'profile'),home=path.join(temp,'home')
for(const d of [profile,home])fs.mkdirSync(d)
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({island:true,autoUpdateCheck:false,telemetry:false}))
const out=path.join(root,(process.env.ISLAND_NATIVE_OUT??'docs/verification/island-native-host-20260928')+(process.env.ISLAND_LAB_APP?'/packaged':process.env.ISLAND_PROD_APP?'/packaged-prod':''));fs.mkdirSync(out,{recursive:true})
const env={...process.env,EAS_VERIFY:'1',...(process.env.ISLAND_PROD_APP?{}:{EAS_ISLAND_NATIVE:'1'}),HOME:process.env.ISLAND_LAB_APP?process.env.HOME:home,EAS_ISLAND_LAB_VERIFY_ROOT:temp};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const packagedApp=process.env.ISLAND_LAB_APP??process.env.ISLAND_PROD_APP
if(process.env.ISLAND_PROD_APP)delete env.EAS_ISLAND_NATIVE
const app=spawn(packagedApp??path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[...(packagedApp?[]:[root]),'--inspect=0','--remote-debugging-port=0','--user-data-dir='+profile,'--use-mock-keychain'],{env,stdio:['ignore','pipe','pipe']})
let logs='';app.stdout.on('data',x=>logs+=x);app.stderr.on('data',x=>logs+=x)
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
async function until(fn,label){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await sleep(100)}throw Error('timeout: '+label)}
async function connect(url,awaitPromise=true){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};const send=async(method,params={})=>{const id=++seq;let timer;try{const r=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}))});if(r.error)throw Error(JSON.stringify(r.error));return r.result}finally{clearTimeout(timer)}};return {send,eval:async expression=>{console.log('eval',expression.slice(0,160));const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}}}
const native=()=>JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");var a=$.NSRunningApplication.runningApplicationWithProcessIdentifier('+app.pid+');JSON.stringify({front:Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),policy:Number(a.activationPolicy)})'],{encoding:'utf8'}))
const E="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
let main,page,helper

const shot=async(p,name)=>{const s=await p.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(s.data,'base64'))}
try{
 main=await connect(await until(()=>logs.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1],'main inspector'),false)
 const actualProfile=await main.eval(E+".app.getPath('userData')")
 if(process.env.ISLAND_LAB_APP)assert.equal(actualProfile,path.join(temp,'Eas-Term Island Lab'))
 const port=await until(()=>Number(logs.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]),'renderer port')
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 page=await connect((await until(async()=>(await targets()).find(t=>t.url.endsWith('/index.html')),'main page')).webSocketDebuggerUrl)
 await page.send('Page.bringToFront');await page.send('Runtime.enable');await sleep(2500);await until(()=>page.eval('!!window.__store&&!!window.api'),'store');await page.eval("document.querySelector('.onb-ghost')?.click()");await sleep(300)
 await main.eval('globalThis.__dockMain='+E+".BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));true")
 const sid='ac-dock-fixture',tab={id:'dock-tab',title:'Dock 回归任务',projectId:'dock-project',cwd:temp,activeLeafId:'dock-leaf',root:{type:'leaf',id:'dock-leaf',pane:{kind:'agent',cwd:temp,cli:'codex',sessionId:sid}}}
 const frame={id:'dock-frame',projectId:'dock-project',name:'Dock 焦点验收',x:30,y:30,w:850,h:650,collapsed:false,nodes:[{id:'dock-node',leafId:'dock-leaf',x:16,y:50,w:800,h:547}]}
 await page.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",projects:[{id:"dock-project",name:"Dock 焦点验收",path:'+JSON.stringify(temp)+'}],tabs:['+JSON.stringify(tab)+'],activeTabId:"dock-tab",canvas:{...s.canvas,frames:['+JSON.stringify(frame)+']}})})()')
 await page.eval('window.api.prefs.set("island",true)');await sleep(1000)
 const assertDock=async label=>{assert.equal(await main.eval(E+'.app.dock.isVisible()'),true,label);assert.equal(native().policy,0,label+' native policy');checks.push(label)}
 await assertDock('startup Dock present / regular app')
 if(process.env.ISLAND_PROD_APP){
  assert.equal(fs.realpathSync(actualProfile),fs.realpathSync(profile))
  assert.equal(await main.eval(E+'.app.isPackaged'),true)
  assert.equal(await main.eval(E+'.app.getName()'),'Eas-Term')
  assert.equal(await main.eval('process.env.EAS_ISLAND_NATIVE??null'),null)
  checks.push('packaged release build, isolated profile, native island not forced by env')
 }
 if(process.env.ISLAND_LAB_APP){
  const identity=await main.eval('({name:'+E+'.app.getName(),profile:'+E+'.app.getPath("userData"),home:'+E+'.app.getPath("home"),codex:process.env.CODEX_HOME,dsh:process.env.DSH_HOME,zdot:process.env.ZDOTDIR})')
  assert.equal(identity.name,'Eas-Term Island Lab');assert.ok(identity.profile.endsWith('/Eas-Term Island Lab'))
  for(const key of ['home','codex','dsh','zdot'])assert.ok(identity[key].startsWith(identity.profile+'/'))
  assert.deepEqual(await page.eval('window.api.update.check()'),{ok:true,info:null,lab:true})
  assert.equal((await page.eval('window.api.update.download()')).ok,false)
  assert.equal(await main.eval('process.env.HOME'),process.env.HOME)
  assert.equal(await main.eval(E+'.safeStorage.decryptString('+E+'.safeStorage.encryptString("lab-verification-only"))'),'lab-verification-only')
  checks.push('packaged identity/profile/CLI paths/updater isolated; system keychain roundtrip works')
 }

 const helperScript=path.join(temp,'foreground.swift'),helperState=path.join(temp,'foreground-state.json'),helperMode=path.join(temp,'foreground-mode'),helperBinary=path.join(temp,'Foreground.app/Contents/MacOS/Foreground')
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
 'var requested=false',
 'Timer.scheduledTimer(withTimeInterval:0.1,repeats:true){_ in let full=FileManager.default.fileExists(atPath:'+JSON.stringify(helperMode)+');if full != requested {requested=full;w.toggleFullScreen(nil)};try! JSONSerialization.data(withJSONObject:["full":w.styleMask.contains(.fullScreen)]).write(to:URL(fileURLWithPath:'+JSON.stringify(helperState)+'))}',
 'app.run()'].join('\n'))
 fs.mkdirSync(path.dirname(helperBinary),{recursive:true});fs.writeFileSync(path.join(temp,'Foreground.app/Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.eas.verify.foreground.'+Date.now()+'</string><key>CFBundleExecutable</key><string>Foreground</string><key>CFBundleName</key><string>Native Foreground Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>')
 execFileSync('/usr/bin/swiftc',[helperScript,'-o',helperBinary])
 helper=spawn(helperBinary,[],{env,stdio:'ignore'})
 await until(()=>fs.existsSync(helperState),'foreground helper')
 const otherForeground=async()=>{execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");$.NSRunningApplication.runningApplicationWithProcessIdentifier('+helper.pid+').activateWithOptions(3)']);await until(()=>native().front===helper.pid,'other application foreground')}

 const clickSource=path.join(temp,'click.swift'),clickBin=path.join(temp,'click')
 fs.writeFileSync(clickSource,'import AppKit\nimport ApplicationServices\nlet p=CGPoint(x:Double(CommandLine.arguments[1])!,y:Double(CommandLine.arguments[2])!)\nfor t:CGEventType in [.mouseMoved,.leftMouseDown,.leftMouseUp] { CGEvent(mouseEventSource:nil,mouseType:t,mouseCursorPosition:p,mouseButton:.left)?.post(tap:.cghidEventTap);RunLoop.current.run(until:Date(timeIntervalSinceNow:0.1)) }')
 execFileSync('/usr/bin/swiftc',[clickSource,'-o',clickBin])
 const click=(panel,x)=>{const b=panel.kCGWindowBounds;execFileSync(clickBin,[String(b.X+x),String(b.Y+b.Height-26)])}
 const emit=async e=>main.eval("__dockMain.webContents.send('agentChat:event',"+JSON.stringify({sessionId:sid,event:e})+')')
 const notice=async n=>{await emit({k:'turn.start'});await emit({k:'text.done',text:'隔离通知 '+n});await emit({k:'turn.done',usage:{input:1,output:1}})}
 const querySource=path.join(temp,'windows.swift'),queryBin=path.join(temp,'windows')
 fs.writeFileSync(querySource,'import AppKit\nimport ApplicationServices\nlet rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []\nprint(String(data:try! JSONSerialization.data(withJSONObject:rows),encoding:.utf8)!)')
 execFileSync('/usr/bin/swiftc',[querySource,'-o',queryBin])
 const windows=()=>JSON.parse(execFileSync(queryBin,[],{encoding:'utf8'}))
 await main.eval('__dockMain.minimize()');await otherForeground();await sleep(800)
 await notice('原生宿主');await sleep(1000)
 const nativePid=await until(()=>{const rows=execFileSync('/bin/ps',['-axo','pid,ppid,comm'],{encoding:'utf8'}).split('\n');for(const row of rows){const m=row.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);if(m&&+m[2]===app.pid&&m[3].endsWith('/IslandHost'))return +m[1]}},'owned native process')
 const panel=await until(()=>windows().find(w=>w.kCGWindowOwnerPID===nativePid),'native panel visible')
 assert.equal(native().front,helper.pid);await assertDock('native notification does not steal foreground or hide Dock')
 execFileSync('/usr/sbin/screencapture',['-x','-l',String(panel.kCGWindowNumber),path.join(out,'native-notification.png')])
 fs.writeFileSync(path.join(out,'panel.json'),JSON.stringify(panel,null,2))
 const beforeDismiss=await page.eval('window.__store.getState().silencedNotices.length')
 click(panel,175);await sleep(500)
 assert.ok(await page.eval('window.__store.getState().silencedNotices.length>'+beforeDismiss),'native click must silence a notice')
 if(!packagedApp)assert.ok(logs.includes('"type":"dismiss"'),'actual dismiss handler must receive native click')
 assert.equal(native().front,helper.pid,'dismiss must not activate app');await assertDock('native dismiss keeps other app foreground and Dock')
 await page.eval('window.__store.setState({activeTabId:"not-selected"})')
 await notice('跳转');await sleep(800)
 const target=await until(()=>windows().find(w=>w.kCGWindowOwnerName==='Eas-Term Island Host'),'second native panel')
 assert.equal(native().front,helper.pid)
 click(target,75)
 await until(()=>native().front===app.pid,'task activates main app')
 if(!packagedApp)assert.ok(logs.includes('"type":"focus"'),'actual focus handler must receive native click')
 assert.equal(await main.eval('__dockMain.isFocused()'),true)
 assert.equal(await page.eval('window.__store.getState().activeTabId'),'dock-tab')
 await sleep(800);assert.equal(windows().some(w=>w.kCGWindowOwnerName==='Eas-Term Island Host'),false)
 await assertDock('native task click restores main and removes island hit layer');await shot(page,'task-focused')
 await main.eval('__dockMain.minimize()');fs.writeFileSync(helperMode,'1')
 await until(()=>{try{return JSON.parse(fs.readFileSync(helperState,'utf8')).full}catch{return false}},'native foreground fullscreen')
 await otherForeground();await sleep(1500);await notice('全屏通知');await sleep(800)
 const fullPanel=await until(()=>windows().find(w=>w.kCGWindowOwnerName==='Eas-Term Island Host'),'native panel over fullscreen')
 assert.equal(native().front,helper.pid);await assertDock('native notification visible over foreign fullscreen without activation')
 execFileSync('/usr/sbin/screencapture',['-x',path.join(out,'fullscreen.png')])
 const fullBefore=await page.eval('window.__store.getState().silencedNotices.length');click(fullPanel,175);await sleep(500)
 assert.ok(await page.eval('window.__store.getState().silencedNotices.length>'+fullBefore));assert.equal(native().front,helper.pid)
 checks.push('fullscreen dismiss leaves foreign app active')
 await notice('全屏跳转');await sleep(800)
 const fullTarget=await until(()=>windows().find(w=>w.kCGWindowOwnerName==='Eas-Term Island Host'),'fullscreen task panel')
 click(fullTarget,75);await until(()=>native().front===app.pid,'task exits foreign fullscreen to main')
 await sleep(1500);assert.equal(windows().some(w=>w.kCGWindowOwnerName==='Eas-Term Island Host'),false)
 assert.equal(await main.eval('__dockMain.isFocused()'),true);checks.push('fullscreen task click focuses main without residual island')
 fs.unlinkSync(helperMode)
 await page.eval('window.api.prefs.set("island",false)');await sleep(1200)
 assert.equal(windows().some(w=>w.kCGWindowOwnerPID===nativePid),false)
 await until(()=>{try{process.kill(nativePid,0);return false}catch{return true}},'owned helper exits')
 checks.push('native panel closes on preference disable')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,fixtureTasks:true,nativeForegroundChecked:true,taskClicks:'native CGEvent dismiss and task buttons',unverified:['manual Mission Control switching','Windows'],profile:actualProfile},null,2));console.log(JSON.stringify({passed:true,checks},null,2))
}catch(error){try{if(page)await shot(page,'failure')}catch{};fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),checks},null,2));throw error}
finally{helper?.kill('SIGTERM');for(const ws of sockets)ws.close();app.kill('SIGTERM');await Promise.race([new Promise(r=>app.once('exit',r)),sleep(3000)]);if(app.exitCode===null&&app.signalCode===null)app.kill('SIGKILL');fs.writeFileSync(path.join(out,'app.log'),logs)}
