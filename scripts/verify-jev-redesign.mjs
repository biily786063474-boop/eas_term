import {McpClient} from '../src/main/mcpClient.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/jev-redesign');fs.mkdirSync(output,{recursive:true})
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-jev-ui-')),profile=path.join(fixture,'profile'),home=path.join(fixture,'home');fs.mkdirSync(profile);fs.mkdirSync(home)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'jev-fixture',name:'Jev 验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const plugin=path.join(home,'.eas/plugins/jev');fs.mkdirSync(path.dirname(plugin),{recursive:true});fs.cpSync(path.join(root,'resources/plugins/jev'),plugin,{recursive:true})
// Test-only transport adapter in copied package: never alters production client or real provider.
fs.writeFileSync(path.join(plugin,'fixture-fetch.mjs'),`import fs from 'node:fs';globalThis.fetch=async(url,init)=>{fs.appendFileSync(${JSON.stringify(path.join(fixture,'calls.log'))},'call\\n');if(url!=='https://api.typesafe.ai/v1/systemone'||init.headers.Authorization!=='Bearer jev-fixture-not-a-real-key')throw Error('Unexpected fixture request');const body=JSON.parse(init.body),answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:.8}:q.type==='choice'?{type:'choice',choice:Object.keys(q.criteria)[0],probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i)=>[k,i?0:1])),confidence:1}:{type:'score',score:0,legend:Object.fromEntries(q.criteria.map((v,i)=>[i,String(v)])),probabilities:Object.fromEntries(q.criteria.map((v,i)=>[i,i?0:1])),confidence:1}]));return new Response(JSON.stringify({model:'fixture-not-live',answers,usage:{input_tokens:5,output_tokens:1}}))}`)
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json')));manifest.mcp.args=['--import','./fixture-fetch.mjs','./server.mjs'];fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify(manifest))
const bootstrap=path.join(fixture,'launch.cjs')
const instrumentation=';setInterval(()=>{try{const f='+JSON.stringify(path.join(fixture,'turn-fixture.json'))+';const x=require("fs").readFileSync(f,"utf8");require("fs").unlinkSync(f);for(const event of JSON.parse(x))observePluginTurn("jev-event-fixture",'+JSON.stringify(fixture)+',event)}catch{}},50);'
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};const {app,dialog}=require('electron');app.setAppPath(${JSON.stringify(root)});app.setVersion(${JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version)});dialog.showMessageBox=async(_window,options)=>{if(options.title==='验证插件连接')await new Promise(resolve=>setTimeout(resolve,600));if(!['验证插件连接','打开安全连接设置','重新启动插件服务','保存插件配置','断开并清除插件配置','确认发送给 TypeSafe','授权时间线增强','退出 Jev'].includes(options.title))throw Error('Unexpected dialog: '+options.title);return {response:1}};const Module=require('node:module'),entry=${JSON.stringify(path.join(root,'out/main/index.js'))},m=new Module(entry,module);m.filename=entry;m.paths=Module._nodeModulePaths(require('path').dirname(entry));m._compile(require('fs').readFileSync(entry,'utf8')+${JSON.stringify(instrumentation)},entry);`)

const env={...process.env,EAS_VERIFY:'1'};for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_')||/TOKEN|API_KEY|SECRET|PASSWORD/.test(n))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
let child,logs='';
function launch(){
 try{fs.unlinkSync(path.join(profile,'DevToolsActivePort'))}catch{}
 child=spawn('/usr/bin/sandbox-exec',['-p',policy,process.env.EAS_ELECTRON_BIN||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),bootstrap,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x)
}
const sockets=[],checks=[],clients=[];const check=(v,n)=>{if(!v)throw Error(n);checks.push(n);console.log(n)};
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function connect(url,awaitPromise=true){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}

let main,frame,port,timelineUrl=null
const count=()=>{try{return fs.readFileSync(path.join(fixture,'calls.log'),'utf8').trim().split('\n').length}catch{return 0}}
async function attach(){
 port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-2000))}})
 main=await connect((await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.__store&&!!window.api'))
}
const frameConnections=new Map()
async function attachFrame(){
 frame=await until(async()=>{
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
  for(const target of targets.filter(x=>x.type==='iframe'&&x.url.startsWith('eas-plugin:'))){
   let candidate=frameConnections.get(target.webSocketDebuggerUrl)
   if(!candidate){candidate=await connect(target.webSocketDebuggerUrl);frameConnections.set(target.webSocketDebuggerUrl,candidate)}
   if(await candidate.eval("!!document.getElementById('material')")){console.log('Jev target identified by actual document',await candidate.eval('document.title'));return candidate}
  }
 })
 await until(()=>frame.eval("typeof state!=='undefined'&&state.usage"))
}

async function shot(name){const s=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(s.data,'base64'))}
async function stop(){for(const s of sockets)s.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r))}
try{
 launch();await attach()
 check(await main.eval("window.api.secrets.setup('837194',true).then(r=>r.ok)"),'隔离凭证柜建立并明确开启设备信任')
 check(await main.eval("window.api.plugins.configuration('save','eas:jev',{'api-key':'jev-fixture-not-a-real-key'}).then(r=>r.ok)"),'通过真实宿主保存测试凭证')
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('jev-fixture',30,30);const f=window.__store.getState().canvas.frames.find(f=>f.projectId==='jev-fixture');window.__jevFrame=f.id;s.addComponentNode(f.id,'plugin-panel',20,60,1040,800,{pluginId:'eas:jev',panelId:'main'});s.setViewport({x:0,y:0,scale:.8})})()")
 await attachFrame();check(await frame.eval('!state.connected&&!state.enabled'),'首次保存不伪造连接或开启')
 await frame.eval("showConnect();$('verify').click()")
 await until(()=>frame.eval('state.connected&&!busy'))
 check(count()===1,'首次验证只有一次固定测试请求')
 await frame.eval("$('enable').click()");await until(()=>frame.eval('state.enabled'))
 await shot('decision')
 await frame.eval("$('material').value='预览按钮点击后白屏';updatePreview();$('run').click()")
 await until(()=>frame.eval("!busy&&$('result').textContent.includes('fixture-not-live')"))
 check(count()===2,'材料预览确认后完成一次判断')
 await frame.eval("tab('usage')");check(await frame.eval("$('records').children.length===2"),'用量页显示真实两条记录');await shot('usage')
 await frame.eval("tab('automation')");await shot('automation')
 await main.eval("document.querySelector('iframe.plg-frame').style.width='440px'")
 await until(()=>frame.eval('innerWidth===440'))
 check(await frame.eval('document.documentElement.scrollWidth<=innerWidth+1'),'窄屏无横向溢出');await shot('narrow')
 await wait(800);await stop();launch();await attach();await attachFrame()
 check(await frame.eval('state.connected&&state.enabled'),'整应用重启恢复连接和已启用状态')
 check(count()===2,'恢复不重复发收费验证请求')
 await frame.eval("$('master').click()");await until(()=>frame.eval('!state.enabled&&!busy'));await wait(500)
 await stop();launch();await attach();await attachFrame()
 check(await frame.eval('state.connected&&!state.enabled&&!state.enabledIntent'),'暂停后整应用重启仍暂停且保留连接')
 check(count()===2,'暂停重启没有业务或验证请求');await shot('paused-restored')
 await frame.eval("$('master').click();$('enable').click()");await until(()=>frame.eval('state.enabled&&!busy'))
 const jevUrl=await frame.eval('location.href')
 await main.eval("(()=>{const s=window.__store.getState(),f=s.canvas.frames.find(f=>f.projectId==='jev-fixture');window.__jevFrame=f.id;s.addComponentNode(f.id,'plugin-panel',1100,60,850,680,{pluginId:'eas:timeline',panelId:'main'})})()")
 const timeline=await connect((await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='iframe'&&x.url.startsWith('eas-plugin:')&&x.url!==jevUrl))).webSocketDebuggerUrl)
 timelineUrl=await timeline.eval('location.href')
 await until(()=>timeline.eval("typeof globalState!=='undefined'&&!!globalState"))
 await timeline.eval("document.getElementById('captureToggle').click();document.getElementById('globalDialogSave').click()")
 await until(()=>timeline.eval("document.getElementById('captureToggle').getAttribute('aria-pressed')==='true'"))
 await frame.eval("document.querySelector('[data-cap=milestone]').click()")
 await until(()=>frame.eval("!busy&&state.selected.milestone&&state.projectIds.includes('jev-fixture')"))
 await main.eval("(()=>{const s=window.__store.getState(),f=s.canvas.frames.find(f=>f.projectId==='jev-fixture'),n=f.nodes.find(n=>n.component?.type==='plugin-panel'&&n.component?.props?.pluginId==='eas:jev');if(!n)throw Error('Jev node not found');s.removeNode(f.id,n.id)})()")
 await wait(32000) // let the panel's last reference expire before the event
 const beforeEvent=count()
 fs.writeFileSync(path.join(fixture,'turn-fixture.json'),JSON.stringify([{k:'turn.start'},{k:'text.done',text:'已完成图片预览修复，补充了回归测试。'},{k:'turn.done'}]))
 const candidateFile=path.join(fixture,'.eas/timeline-candidates.json')
 const candidate=await until(()=>{try{return JSON.parse(fs.readFileSync(candidateFile)).items.find(c=>c.jev)}catch{return false}})
 check(candidate.review==='pending'&&candidate.jev.milestone.accepted===false,'关闭面板且进程回收后，授权新事件仍获得待复核建议')
 check(count()===beforeEvent+1,'事件恢复不重复验证，只调用一次增强')
 check(!fs.existsSync(path.join(fixture,'.eas/timeline.json')),'增强不冒充已验收时间线记录')
 await main.eval("(()=>{const s=window.__store.getState(),f=s.canvas.frames.find(f=>f.projectId==='jev-fixture');s.addComponentNode(f.id,'plugin-panel',20,60,1040,800,{pluginId:'eas:jev',panelId:'main'})})()")
 await main.eval("(()=>{const s=window.__store.getState(),f=s.canvas.frames.find(f=>f.projectId==='jev-fixture'),n=f.nodes.find(n=>n.component?.props?.pluginId==='eas:jev');s.setViewport({x:50-(f.x+n.x)*.8,y:100-(f.y+n.y)*.8,scale:.8})})()")
 await attachFrame();await until(()=>frame.eval('state.connected&&state.enabled'))
 const beforeLock=count()
 check(await main.eval("window.api.secrets.lock().then(r=>r.locked&&!r.trustedDevice)"),'手动锁柜撤销设备信任与运行凭证')
 await until(()=>main.eval("document.body.textContent.includes('插件进程退出')||document.body.textContent.includes('重新打开')||document.body.textContent.includes('重新启动')"))
 check(count()===beforeLock,'锁柜没有产生额外服务请求')
 check(await main.eval("window.api.secrets.unlock('837194',true).then(r=>r.ok)"),'明确解锁后恢复设备信任')
 await wait(600);await stop();launch();await attach();timelineUrl=null
 // Identify the Jev iframe by its document title; timeline may also restore.
 await attachFrame()
 await until(()=>frame.eval('typeof state!=="undefined"&&state.connected&&state.enabled'))
 check(count()===beforeLock,'锁柜再解锁重启后恢复旧意图且不重复验证')
 await frame.eval("tab('usage');$('logout').click()")
 await until(()=>main.eval("window.api.plugins.configuration('status','eas:jev').then(r=>r.ok&&r.configured.length===0)"))
 check(true,'退出操作真实清除 Jev 凭证')
 await wait(600);await stop();launch();await attach()
 await attachFrame()
 await until(()=>frame.eval('typeof state!=="undefined"&&state.usage'))
 check(await frame.eval('!state.connected&&!state.enabled'),'退出后重启不会复活旧连接')
 check(count()===beforeLock,'退出重启没有额外服务调用')
 if(fs.existsSync(path.join(output,'failure.json')))fs.renameSync(path.join(output,'failure.json'),path.join(output,'historical-ui-harness-failure.json'))
 fs.writeFileSync(path.join(output,'ui-result.json'),JSON.stringify({checks,liveProvider:false,realOnlineCLI:false,windows:false,fixture},null,2))
}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(error)},null,2));throw error}
finally{fs.writeFileSync(path.join(output,'app.log'),logs);if(child?.exitCode===null)await stop();fs.rmSync(fixture,{recursive:true,force:true})}
