// Real isolated app + real encrypted vault + installed archive + three actual shim children.
// Only native dialog selections are controlled; no production guard or encryption is replaced.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {packPlugin} from './pack-plugin.mjs'
import http from 'node:http'
import {McpClient} from '../src/main/mcpClient.ts'
const root=process.cwd(),output=path.join(root,'docs/verification/plugin-marketplace/local-files');fs.mkdirSync(output,{recursive:true})
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-files-vertical-')),profile=path.join(fixture,'profile'),home=path.join(fixture,'home'),allowed=path.join(fixture,'allowed')
for(const dir of [profile,home,allowed])fs.mkdirSync(dir)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'本地文件验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
const packed=packPlugin('plugins-store/local-files',{outRoot:path.join(fixture,'packages'),registrySchema:2})
const archive=fs.readFileSync(packed.zipPath)
const server=http.createServer((req,res)=>{if(req.url==='/plugins/v2/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[packed.entry],unavailable:[]}))}else if(req.url===new URL(packed.entry.url).pathname){res.end(archive)}else {res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const serverUrl='http://127.0.0.1:'+server.address().port
const bootstrap=path.join(fixture,'launch.cjs'),dialogLog=path.join(fixture,'dialog-log.json'),holdDialog=path.join(fixture,'hold-dialog')
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};
const {app,dialog,session}=require('electron');
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://eas.biily.top/plugins/local-files/*']},(details,callback)=>callback({redirectURL:${JSON.stringify(serverUrl)}+new URL(details.url).pathname})));
app.setAppPath(${JSON.stringify(root)});
const calls=[];
dialog.showOpenDialog=async()=>{calls.push('directory-picker');require('fs').writeFileSync(${JSON.stringify(dialogLog)},JSON.stringify(calls));return {canceled:false,filePaths:[${JSON.stringify(allowed)}]}};
dialog.showMessageBox=async(_win,options)=>{if(!['确认插件目录授权','保存插件配置','断开并清除插件配置'].includes(options.title))throw Error('Unexpected native dialog');calls.push(options.title);require('fs').writeFileSync(${JSON.stringify(dialogLog)},JSON.stringify(calls));while(options.title!=='断开并清除插件配置'&&require('fs').existsSync(${JSON.stringify(holdDialog)}))await new Promise(r=>setTimeout(r,20));return {response:1}};
require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
const env={...process.env,EAS_VERIFY:'1',EAS_PLUGIN_REGISTRY_URL:serverUrl+'/plugins/v2/registry.json'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_')||/TOKEN|API_KEY|SECRET|PASSWORD/.test(n))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),bootstrap,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x)
const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[],clients=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url,awaitPromise=true){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}

try{
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const main=await connect((await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.api?.plugins && !!window.__store'))
 const setup=await main.eval('window.api.secrets.setup("837194")');check(setup.ok,'隔离密钥柜真实设置并解锁，没有替换safeStorage')
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.wk-edge-guide')"));await main.eval("document.querySelector('.wk-edge-guide').click()")
 await until(()=>main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))"));await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))"));await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('.pm-card')].some(e=>e.textContent.includes('本地文件'))"))
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('本地文件')).querySelector('button').click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
 check(!fs.existsSync(path.join(home,'.eas/plugins/local-files/plugin.json')),'本地文件包安装前需真实市场确认')
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
 await until(()=>main.eval("!!document.querySelector('[data-plugin-config=\"eas:local-files\"]')"))
 await main.eval("document.querySelector('[data-plugin-config=\"eas:local-files\"] button').focus()")
 await main.eval("document.querySelector('[data-plugin-config=\"eas:local-files\"] button').click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-config]').innerText.includes('未配置')"))
 check(await main.eval("!!document.querySelector('[data-plugin-config] dialog[open]')"),'配置在独立对话面板中打开，而非撑高列表卡片')
 check(await main.eval("[...document.querySelectorAll('.pm-card')].every(e=>e.getBoundingClientRect().height<180)"),'配置展开不拉高同排卡片')
 await main.eval("[...document.querySelectorAll('[data-plugin-config] button')].find(e=>e.textContent.includes('选择目录')).click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-config]').innerText.includes('已保存')"))
 check(JSON.parse(fs.readFileSync(dialogLog)).includes('确认插件目录授权'),'真实UI触发目录选择和二次确认（原生对话框返回值受控）')
 const files=fs.readdirSync(path.join(profile,'plugin-credentials'));check(files.length===1&&!fs.readFileSync(path.join(profile,'plugin-credentials',files[0]),'utf8').includes(allowed),'原生目录授权真实加密落盘，不以明文路径持久化')
 await main.eval("document.querySelector('[data-plugin-config]').closest('.pm-card').scrollIntoView({block:'center'})")
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'configured.png'),Buffer.from(shot.data,'base64'))
 const credentialFile=path.join(profile,'plugin-credentials',files[0]),savedBytes=fs.readFileSync(credentialFile)
 for(const action of ['save','directory']){
  const before=JSON.parse(fs.readFileSync(dialogLog)).length
  fs.writeFileSync(holdDialog,'hold native confirmation')
  await main.eval('window.__pendingConfig=window.api.plugins.configuration('+JSON.stringify(action)+',"eas:local-files",'+(action==='save'?'{}':'"root"')+');void 0')
  await until(()=>JSON.parse(fs.readFileSync(dialogLog)).length>before+(action==='directory'?1:0))
  await main.eval('window.api.secrets.lock()')
  const unlocked=await main.eval('window.api.secrets.unlock("837194")');check(unlocked.ok,action+'等待原生确认时实际锁定并重新解锁')
  fs.unlinkSync(holdDialog)
  const late=await main.eval('window.__pendingConfig')
  check(!late.ok&&late.error.includes('失效')&&fs.readFileSync(credentialFile).equals(savedBytes),action+'旧确认结果不能跨解锁代次写入，原密文不变')
 }
 check(await main.eval("[...document.querySelectorAll('[data-plugin-config] button')].some(e=>e.textContent==='测试连接')"),'配置卡片提供真实测试连接入口')
 await main.eval("[...document.querySelectorAll('[data-plugin-config] button')].find(e=>e.textContent==='测试连接').click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-config]').innerText.includes('连接测试通过')"))
 check(fs.readdirSync(allowed).length===0,'配置连接测试只列工具，不执行业务写入')
 const tested=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'configured.png'),Buffer.from(tested.data,'base64'))
 check(await main.eval("!document.querySelector('[data-plugin-config]').innerText.includes('留空保留')"),'目录授权不显示不适用的留空文案')
 await main.eval("document.documentElement.dataset.theme='light'");await wait(100)
 const light=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'configured-light.png'),Buffer.from(light.data,'base64'))
 await main.eval("document.documentElement.dataset.theme='dark'")
 await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await main.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await until(()=>main.eval("!document.querySelector('.pm-settings[open]')"))
 check(await main.eval("!!document.querySelector('.pm-modal')"),'Escape只关闭配置面板，保留插件市场')
 check(await main.eval("document.activeElement===document.querySelector('[data-plugin-config] button')"),'关闭后焦点回到配置入口')
 const compact=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'market-compact.png'),Buffer.from(compact.data,'base64'))
 await main.eval("document.querySelector('[data-plugin-config] button').click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-config]').innerText.includes('已保存目录授权')"))
 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-endpoint.json')))
 for(const label of ['claude','codex','omp']){
  const c=new McpClient({name:'verify-'+label,command:process.execPath,args:[path.join(root,'mcp/eas-plugin-shim.mjs')],cwd:fixture,env:{PATH:process.env.PATH||'',EAS_PLUGIN:'local-files',EAS_TERM_PORT:String(endpoint.port),EAS_TERM_TOKEN:endpoint.token}});clients.push(c)
  await c.initialize('0.4.102');check((await c.listTools()).some(t=>t.name==='files_write'),label+'真实shim经实际应用宿主获得工具')
  const text='actual-'+label,result=await c.request('tools/call',{name:'files_write',arguments:{path:label+'.txt',text}})
  check(!result.isError&&fs.readFileSync(path.join(allowed,label+'.txt'),'utf8')===text,label+'真实工具调用写入授权临时目录')
 }
 const bad=await clients[0].request('tools/call',{name:'files_read',arguments:{path:'../profile/secrets.json'}});check(bad.isError,'真实宿主调用拒绝越出授权目录')
 const beforeClear=JSON.parse(fs.readFileSync(dialogLog)).length
 fs.writeFileSync(holdDialog,'hold pending save')
 await main.eval('window.__pendingConfig=window.api.plugins.configuration("save","eas:local-files",{});void 0')
 await until(()=>JSON.parse(fs.readFileSync(dialogLog)).length>beforeClear)
 await main.eval("[...document.querySelectorAll('[data-plugin-config] button')].find(e=>e.textContent==='断开并清除配置').click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-config]').innerText.includes('本地配置已清除')"))
 fs.unlinkSync(holdDialog)
 check(!(await main.eval('window.__pendingConfig')).ok,'清除配置使此前悬挂的保存确认失效')
 const cleared=await main.eval('window.api.plugins.configuration("status","eas:local-files")')
 check(cleared.ok&&cleared.configured.length===0&&fs.readdirSync(allowed).length===3,'清除真实配置但保留三个业务文件')
 let revoked=false;try{revoked=!!(await clients[0].request('tools/call',{name:'files_write',arguments:{path:'after-clear.txt',text:'forbidden'}})).isError}catch{revoked=true}
 check(revoked&&!fs.existsSync(path.join(allowed,'after-clear.txt')),'清除使旧shim连接不能继续写入')
 await main.eval("[...document.querySelectorAll('[data-plugin-config] button')].find(e=>e.textContent.includes('选择目录')).click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-config]').innerText.includes('已保存')"))
 await clients[0].initialize('0.4.102')
 const restored=await clients[0].request('tools/call',{name:'files_read',arguments:{path:'claude.txt'}})
 check(!restored.isError,'重新授权后可以重新建立连接读取原业务文件')
 await main.eval('window.api.secrets.lock()');await wait(500)
 let blocked=false;try{const r=await clients[0].request('tools/call',{name:'files_write',arguments:{path:'after-lock.txt',text:'must-not-write'}});blocked=!!r.isError}catch{blocked=true}
 check(blocked&&!fs.existsSync(path.join(allowed,'after-lock.txt')),'密钥柜锁定关闭实际配置插件，后续调用不能写入')
 const state=await main.eval('window.api.plugins.configuration("status","eas:local-files")');check(!state.ok&&!('values' in state),'锁定后配置IPC不返回明文')
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,scope:'Real market UI install/hash/extraction -> actual app/native-dialog adapter -> real safeStorage -> actual shared host -> three shim subprocesses -> real temp files. Not actual model CLI or native picker interaction; no production publish.'},null,2))
 console.log(JSON.stringify({passed:true,checks},null,2))
}catch(error){process.exitCode=1;console.error(error);fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(error)},null,2))}
finally{
 for(const c of clients){c.close();await c.exited}
 for(const ws of sockets)ws.close()
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close()
 fs.writeFileSync(path.join(output,'app.log'),logs)
 await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
