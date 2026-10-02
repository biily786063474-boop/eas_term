// Isolated native-input diagnosis. No application data or live sessions used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'island-native-click-'))
const electron=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const jxa=s=>execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");'+s],{encoding:'utf8'}).trim()
const foreground=()=>Number(jxa('Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)'))
const fullFlag=path.join(dir,'fullscreen')
const nativeSource='import AppKit\nlet app=NSApplication.shared\napp.setActivationPolicy(.regular)\nlet w=NSWindow(contentRect:NSRect(x:100,y:100,width:900,height:550),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)\nw.title="Native foreground probe"\nw.makeKeyAndOrderFront(nil)\napp.activate(ignoringOtherApps:true)\nvar requested=false\nTimer.scheduledTimer(withTimeInterval:0.1,repeats:true){ _ in let full=FileManager.default.fileExists(atPath:CommandLine.arguments[1]);if full != requested { requested=full;w.toggleFullScreen(nil) } }\napp.run()'
fs.writeFileSync(path.join(dir,'foreground.swift'),nativeSource)
const bundle=path.join(dir,'Foreground.app','Contents');fs.mkdirSync(path.join(bundle,'MacOS'),{recursive:true})
fs.writeFileSync(path.join(bundle,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.eas.verify.foreground.'+Date.now()+'</string><key>CFBundleExecutable</key><string>Foreground</string><key>CFBundleName</key><string>Foreground Fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>')
const helperExe=path.join(bundle,'MacOS','Foreground')
execFileSync('/usr/bin/swiftc',[path.join(dir,'foreground.swift'),'-o',helperExe])
fs.writeFileSync(path.join(dir,'click.swift'),`import AppKit
import ApplicationServices
let x=Double(CommandLine.arguments[1])!, y=Double(CommandLine.arguments[2])!
func front()->Int32 { NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1 }
var rows:[[String:Any]] = [["phase":"before","front":front()]]
for (name,type) in [("move",CGEventType.mouseMoved),("down",CGEventType.leftMouseDown),("up",CGEventType.leftMouseUp)] {
 CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:CGPoint(x:x,y:y),mouseButton:.left)?.post(tap:.cghidEventTap)
 RunLoop.current.run(until:Date(timeIntervalSinceNow:0.15))
 rows.append(["phase":name,"front":front()])
}
let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
rows.append(["phase":"visible-windows","pids":windows.compactMap{$0[kCGWindowOwnerPID as String]}])
print(String(data:try! JSONSerialization.data(withJSONObject:rows),encoding:.utf8)!)
`)
execFileSync('/usr/bin/swiftc',[path.join(dir,'click.swift'),'-o',path.join(dir,'click')])
const panelContents=path.join(dir,'NativePanel.app','Contents');fs.mkdirSync(path.join(panelContents,'MacOS'),{recursive:true})
fs.writeFileSync(path.join(panelContents,'Info.plist'),fs.readFileSync(path.join(bundle,'Info.plist'),'utf8').replaceAll('Foreground','NativePanel').replace('foreground.','panel.'))
fs.writeFileSync(path.join(dir,'panel.swift'),`import AppKit
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let p=NSPanel(contentRect:NSRect(x:350,y:NSScreen.screens[0].frame.height-300,width:400,height:200),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
p.backgroundColor=NSColor.systemBlue
p.level = .screenSaver
p.hidesOnDeactivate=false
p.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
p.orderFrontRegardless()
try! JSONSerialization.data(withJSONObject:["bounds":["x":350,"y":100],"dock":true]).write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
app.run()
`)
const panelExe=path.join(panelContents,'MacOS','NativePanel')
execFileSync('/usr/bin/swiftc',[path.join(dir,'panel.swift'),'-o',panelExe])
const helper=spawn(helperExe,[fullFlag],{stdio:'ignore'}),results=[]
let child
try {
 await delay(1500)
 for(const config of [{name:'regular-panel',skip:true,rounded:false},{name:'accessory-panel',skip:false,rounded:false},{name:'regular-rounded-panel',skip:true,rounded:true},{name:'native-panel'},{name:'native-fullscreen'}]){
  if(config.name==='native-fullscreen'){fs.writeFileSync(fullFlag,'1');await delay(2500)}
  const ready=path.join(dir,config.name+'.json'),entry=path.join(dir,config.name+'.cjs')
  fs.writeFileSync(entry,"const {app,BrowserWindow}=require('electron');const fs=require('fs');app.whenReady().then(async()=>{const w=new BrowserWindow({x:350,y:100,width:400,height:200,show:false,frame:false,transparent:true,focusable:false,type:'panel',skipTaskbar:true,resizable:false,roundedCorners:"+config.rounded+"});w.setAlwaysOnTop(true,'screen-saver');w.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:"+config.skip+"});await w.loadURL('data:text/html,<body style=\"background:%23222222;color:white\">Blank native click probe — no handlers</body>');w.showInactive();fs.writeFileSync("+JSON.stringify(ready)+",JSON.stringify({pid:process.pid,bounds:w.getContentBounds(),dock:app.dock.isVisible()}))});")
  child=config.name.startsWith('native-')?spawn(panelExe,[ready],{stdio:'ignore'}):spawn(electron,[entry,'--user-data-dir='+path.join(dir,config.name)],{stdio:'ignore'})
  for(let i=0;!fs.existsSync(ready)&&i<100;i++)await delay(100)
  const state=JSON.parse(fs.readFileSync(ready,'utf8'))
  jxa('$.NSRunningApplication.runningApplicationWithProcessIdentifier('+helper.pid+').activateWithOptions(3)');await delay(500);console.log('helper',helper.pid,'exit',helper.exitCode,'front',foreground());console.log(jxa('var a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(a.processIdentifier),name:ObjC.unwrap(a.localizedName),url:ObjC.unwrap(a.executableURL.path)})'))
  const before=foreground(),x=state.bounds.x+200,y=state.bounds.y+100
  if(before!==helper.pid)throw Error('Foreground changed externally; refusing click')
  const phases=JSON.parse(execFileSync(path.join(dir,'click'),[String(x),String(y)],{encoding:'utf8'}))
  results.push({config:config.name,before,phases,after:foreground(),host:child.pid,helper:helper.pid,dock:state.dock})
  if(config.name==='native-fullscreen')execFileSync('/usr/sbin/screencapture',['-x',path.join(root,'docs/diagnostics/island-native-click/native-fullscreen.png')])
  child.kill('SIGTERM');await delay(500);child=null
 }
} finally {child?.kill('SIGTERM');helper.kill('SIGTERM');fs.writeFileSync(path.join(root,'docs/diagnostics/island-native-click/result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))}
