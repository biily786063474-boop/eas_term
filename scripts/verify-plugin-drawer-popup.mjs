// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {packPlugin} from './pack-plugin.mjs'
import {catalogSource} from '../src/main/pluginCatalogSource.ts'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/jev/market');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'插入菜单验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
// Controlled package server; production URL validation remains unchanged.
const home=path.join(fixture,'home');fs.mkdirSync(home)
const source=path.join(fixture,'jev');fs.mkdirSync(source)
let version='1.0.0',broken=false,offline=false,debugPage
const archives=new Map(),entries=new Map(),requests=[]
const fixtureDetail={summary:'按需接入结构化判断能力，默认关闭。',scenarios:['需要将任务内容分类，或核对资料与评审判断时。'],steps:['先在插件设置中连接自己的 TypeSafe 密钥。','选择要开启的能力；AI 只在相关任务中调用。'],capabilities:[{title:'资料核对',description:'按需对资料进行结构化核对。',kind:'suggestion'},{title:'能力推荐',description:'结合当前任务给出建议。',kind:'suggestion'}],dataUse:'未连接时不发送任务内容；连接后仅处理所选任务所需的信息。',limitations:'测试夹具仅验证界面，不代表在线模型调用已验收。',changelog:'1.0.0 测试夹具说明。'}
for(const v of ['1.0.0','1.1.0','1.2.0']){
 fs.cpSync(path.join(root,'resources/plugins/jev'),source,{recursive:true})
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'plugin.json')));manifest.version=v;manifest.permissions={canvas:v==='1.0.0'?['canvas_open_url']:['canvas_open_file']};fs.writeFileSync(path.join(source,'plugin.json'),JSON.stringify(manifest))
 const packed=packPlugin(source,{outRoot:path.join(fixture,'packages'),baseUrl:'https://eas.biily.top/plugins',registrySchema:2})
 entries.set(v,packed.entry);archives.set(new URL(packed.entry.url).pathname,fs.readFileSync(packed.zipPath))
}
const server=http.createServer((req,res)=>{
 requests.push(req.url)
 if(offline){res.statusCode=503;res.end('offline fixture');return}
 if(req.url==='/plugins/v2/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[{...entries.get(version),detail:fixtureDetail}],unavailable:[]}));return}
 const bytes=archives.get(req.url)
 if(!bytes){res.statusCode=404;res.end();return}
 res.end(broken?Buffer.from('corrupt archive'):bytes)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const executable=process.env.EAS_VERIFY_EXECUTABLE||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1',EAS_PLUGIN_REGISTRY_URL:'http://127.0.0.1:'+server.address().port+'/plugins/v2/registry.json'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_')||/TOKEN|API_KEY|SECRET|PASSWORD/.test(n))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
// Disposable launch adapter substitutes only the package network destination;
// no product source/allowlist/TLS policy is changed. This is not HTTPS/CDN proof.
const bootstrap=path.join(fixture,'launch.cjs'),homeProof=path.join(fixture,'home-proof.json')
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};
const {app,session}=require('electron');
app.setAppPath(${JSON.stringify(root)});
require('fs').writeFileSync(${JSON.stringify(homeProof)},JSON.stringify({home:require('os').homedir()}));
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://eas.biily.top/plugins/jev/*']},(details,callback)=>callback({redirectURL:${JSON.stringify('http://127.0.0.1:'+server.address().port)}+new URL(details.url).pathname})));
require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,bootstrap,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url,awaitPromise=true){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}

try {
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const initialPid=child.pid
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 debugPage=main
 await until(()=>main.eval('!!window.__store && !!window.api?.plugins'))
 check(JSON.parse(fs.readFileSync(homeProof)).home===home,'主进程插件 homedir 适配至临时目录，正式凭证目录仍受 OS 沙箱拒绝')
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.cframe[data-fid]')"))
 await main.eval("document.querySelector('.wk-edge-guide').click()")
 await until(()=>main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))"))
 await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")

 await until(()=>main.eval("[...document.querySelectorAll('.mk-card-open')].some(e=>e.textContent.includes('看板')||e.textContent.includes('番茄'))"))
 const board=await main.eval("[...document.querySelectorAll('.mk-card-open')].find(e=>e.textContent.includes('看板')||e.textContent.includes('番茄'))?.getAttribute('aria-label')")
 check(!!board,'已安装带面板插件卡片提供独立点击面')
 await main.eval("[...document.querySelectorAll('.mk-card')].find(e=>e.querySelector('.mk-card-open')&&(e.textContent.includes('看板')||e.textContent.includes('番茄'))).dispatchEvent(new MouseEvent('click',{bubbles:true}))")
 await until(()=>main.eval("!!document.querySelector('.mk-popup .plg-frame')"))
 check(true,'卡片非按钮留白也能打开面板')
 const session=await main.eval("new URL(document.querySelector('.mk-popup .plg-frame').src).hostname")
 check(!!session,'popup使用真实插件面板会话和沙箱iframe')
 const denied=await main.eval(`window.api.plugins.panelRpc(${JSON.stringify(session)},'eas/canvas.call',{tool:'canvas_add_note',args:{text:'no'}})`)
 check(!denied.ok&&denied.error.includes('弹窗面板没有画布节点权限'),'popup宿主强制拒绝canvas.call')
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'popup.png'),Buffer.from(shot.data,'base64'))
 await main.send('Emulation.setDeviceMetricsOverride',{width:900,height:680,deviceScaleFactor:1,mobile:false})
 await main.eval("document.documentElement.setAttribute('data-theme','light')")
 check(await main.eval("document.querySelector('.mk-popup').scrollWidth<=document.querySelector('.mk-popup').clientWidth+1"),'亮色窄屏popup没有横向溢出')
 const narrowShot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'popup-narrow-light.png'),Buffer.from(narrowShot.data,'base64'))
 await main.eval("document.documentElement.setAttribute('data-theme','dark')")
 await main.send('Emulation.clearDeviceMetricsOverride')
 await main.eval("document.querySelector('.mk-popup-close').click()")
 await until(()=>main.eval("!document.querySelector('.mk-popup')"))
 check(!(await main.eval(`window.api.plugins.panelRpc(${JSON.stringify(session)},'ping',{})`)).ok,'关闭按钮释放面板会话')
 await main.eval("[...document.querySelectorAll('.mk-card-open')].find(e=>e.textContent.includes('看板')||e.textContent.includes('番茄')).click()")
 await until(()=>main.eval("!!document.querySelector('.mk-popup .plg-frame')"))
 await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await until(()=>main.eval("!document.querySelector('.mk-popup')"))
 check(true,'Esc关闭popup')
 await main.eval("[...document.querySelectorAll('.mk-card-open')].find(e=>e.textContent.includes('看板')||e.textContent.includes('番茄')).click()")
 await until(()=>main.eval("!!document.querySelector('.mk-popup .plg-frame')"))
 await main.eval("document.querySelector('.mk-popup').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:0,clientY:0}))")
 await until(()=>main.eval("!document.querySelector('.mk-popup')"))
 check(true,'遮罩点击关闭popup')
 await until(()=>main.eval("[...document.querySelectorAll('.mk-card')].some(e=>e.textContent.includes('Jev 智能辅助')&&e.querySelector('.mk-install'))"))
 const installed=path.join(home,'.eas/plugins/jev/plugin.json')
 await main.eval("[...document.querySelectorAll('.mk-card')].find(e=>e.textContent.includes('Jev 智能辅助')&&e.querySelector('.mk-install')).querySelector('.mk-install').click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
 check(!fs.existsSync(installed),'确认安装前Jev未落盘')
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
 await until(()=>fs.existsSync(installed))
 await until(()=>main.eval("!!document.querySelector('.pm-settings input[type=password]')"))
 check(await main.eval("document.querySelector('.pm-settings input[type=password]').value===''"),'Jev安装后缺API Key自动打开安全配置且密钥不回显')
 const keyshot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'required-key.png'),Buffer.from(keyshot.data,'base64'))
 await main.eval("document.querySelector('.pm-settings-close').click()")
 await until(()=>main.eval("!document.querySelector('.pm-settings')"))
 check(!await main.eval("!!document.querySelector('.mk-popup')"),'取消配置不启动面板')
 await main.eval("[...document.querySelectorAll('.mk-card-open')].find(e=>e.textContent.includes('Jev 智能辅助')).click()")
 await until(()=>main.eval("!!document.querySelector('.pm-settings input[type=password]')"))
 check(!await main.eval("!!document.querySelector('.mk-popup')"),'再次点击未配置Jev先开配置而非空面板')
 await main.eval("document.querySelector('.pm-settings-close').click()")
 await until(()=>main.eval("!document.querySelector('.pm-settings')"))
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,requests,scope:'Isolated Electron popup and missing-key setup. No real key or online Jev request.'},null,2))
 console.log(JSON.stringify({passed:true,checks},null,2))
} catch(e) {console.error(e);process.exitCode=1;fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e),requests,ui:await debugPage?.eval('document.body.innerText').catch(()=>null)},null,2))}
finally {
 for(const ws of sockets)ws.close()
 child.kill('SIGTERM')
 await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)])
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close()
 fs.writeFileSync(path.join(output,'app.log'),logs)
 await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})
 await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
