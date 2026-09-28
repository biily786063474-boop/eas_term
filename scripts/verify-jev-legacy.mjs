import {McpClient} from '../src/main/mcpClient.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/jev-legacy-release');fs.mkdirSync(output,{recursive:true})
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-jev-ui-')),profile=path.join(fixture,'profile'),home=path.join(fixture,'home');fs.mkdirSync(profile);fs.mkdirSync(home)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'jev-fixture',name:'Jev 验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const plugin=path.join(home,'.eas/plugins/jev');fs.mkdirSync(path.dirname(plugin),{recursive:true});fs.mkdirSync(plugin);const archive=path.join(fixture,'legacy.tar');execFileSync('git',['archive','--format=tar','--output='+archive,'v0.4.114','resources/plugins/jev'],{cwd:root});execFileSync('tar',['-xf',archive,'--strip-components=3','-C',plugin])
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
   if(await candidate.eval("!!document.getElementById('welcome')")){console.log('Jev target identified by actual document',await candidate.eval('document.title'));return candidate}
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
 await frame.eval("showConnect();document.getElementById('verify').click()")
 await until(()=>frame.eval('state.connected&&!busy'))
 check(count()===1,'首次验证只有一次固定测试请求')
 await frame.eval("document.getElementById('enable').click()");await until(()=>frame.eval('state.enabled'))
 await shot('decision')
 check(await frame.eval('state.connected&&state.enabled'),'旧版可以显式验证并启用')
 await wait(600);await stop();launch();await attach();await attachFrame()
 check(await frame.eval('!state.connected&&!state.enabled'),'旧版重启仍可打开，不调用不支持的恢复协议')
 check(count()===1,'旧版重启不自动收费验证')
 await shot('legacy-reopened')
 await frame.eval("showConnect();document.getElementById('verify').click()")
 await until(()=>frame.eval('state.connected&&!busy'))
 check(count()===2,'旧版重开后仍可显式再次验证')
 await frame.eval("document.getElementById('enable').click()")
 await until(()=>frame.eval('state.enabled'))
 await frame.eval("document.getElementById('allOn').click()")
 await until(()=>frame.eval('!busy'))
 check(await frame.eval('state.enabled&&state.selected.milestone'),'旧版能力开启不要求无法存储的新项目范围')
 await shot('legacy-reconnected')
 const jevUrl=await frame.eval('location.href')
 await main.eval("(()=>{const s=window.__store.getState(),f=s.canvas.frames.find(f=>f.projectId==='jev-fixture');window.__jevFrame=f.id;s.addComponentNode(f.id,'plugin-panel',1100,60,850,680,{pluginId:'eas:timeline',panelId:'main'})})()")
 const timeline=await connect((await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='iframe'&&x.url.startsWith('eas-plugin:')&&x.url!==jevUrl))).webSocketDebuggerUrl)
 timelineUrl=await timeline.eval('location.href')
 await until(()=>timeline.eval("typeof globalState!=='undefined'&&!!globalState"))
 await timeline.eval("document.getElementById('captureToggle').click();document.getElementById('globalDialogSave').click()")
 await until(()=>timeline.eval("document.getElementById('captureToggle').getAttribute('aria-pressed')==='true'"))
 const beforeEvent=count()
 fs.writeFileSync(path.join(fixture,'turn-fixture.json'),JSON.stringify([{k:'turn.start'},{k:'text.done',text:'已完成旧版插件兼容修复，补充回归测试。'},{k:'turn.done'}]))
 const candidateFile=path.join(fixture,'.eas/timeline-candidates.json')
 const candidate=await until(()=>{try{return JSON.parse(fs.readFileSync(candidateFile)).items.find(c=>c.jev)}catch{return false}})
 check(candidate.review==='pending'&&candidate.jev.milestone.accepted===false,'旧版真实时间线事件生成待复核建议，不自动验收')
 check(count()===beforeEvent+2,'旧版两项已选能力各调用一次，不自动恢复或重复验证')
 check(!fs.existsSync(path.join(fixture,'.eas/timeline.json')),'旧版增强不冒充已验收记录')

 if(fs.existsSync(path.join(output,'failure.json')))fs.renameSync(path.join(output,'failure.json'),path.join(output,'historical-ui-harness-failure.json'))
 fs.writeFileSync(path.join(output,'ui-result.json'),JSON.stringify({checks,liveProvider:false,realOnlineCLI:false,windows:false,fixture},null,2))
}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(error)},null,2));throw error}
finally{fs.writeFileSync(path.join(output,'app.log'),logs);if(child?.exitCode===null)await stop();fs.rmSync(fixture,{recursive:true,force:true})}
