// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {packPlugin} from './pack-plugin.mjs'
import {catalogSource} from '../src/main/pluginCatalogSource.ts'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/plugin-marketplace/hot-update');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'插入菜单验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
// Controlled package server; production URL validation remains unchanged.
const home=path.join(fixture,'home');fs.mkdirSync(home)
const source=path.join(fixture,'hot-fixture');fs.mkdirSync(source)
let version='1.0.0',broken=false,offline=false,debugPage
const archives=new Map(),entries=new Map(),requests=[]
for(const v of ['1.0.0','1.1.0','1.2.0']){
 fs.writeFileSync(path.join(source,'plugin.json'),JSON.stringify({name:'hot-fixture',version:v,displayName:'独立热更新验收插件',description:'受控隔离包 '+v,category:'Development',permissions:{canvas:v==='1.0.0'?['canvas_open_url']:['canvas_open_file']},mcp:{command:'node',args:['./server.mjs']}}))
 fs.writeFileSync(path.join(source,'server.mjs'),'// inert fixture '+v+'\n')
 const packed=packPlugin(source,{outRoot:path.join(fixture,'packages'),baseUrl:'https://eas.biily.top/plugins'})
 entries.set(v,packed.entry);archives.set(new URL(packed.entry.url).pathname,fs.readFileSync(packed.zipPath))
}
const server=http.createServer((req,res)=>{
 requests.push(req.url)
 if(offline){res.statusCode=503;res.end('offline fixture');return}
 if(req.url==='/plugins/v2/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[entries.get(version)],unavailable:[]}));return}
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
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://eas.biily.top/plugins/hot-fixture/*']},(details,callback)=>callback({redirectURL:${JSON.stringify('http://127.0.0.1:'+server.address().port)}+new URL(details.url).pathname})));
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
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))"))
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('.pm-card')].some(e=>e.textContent.includes('独立热更新验收插件'))"))
 const installed=path.join(home,'.eas/plugins/hot-fixture/plugin.json')
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('独立热更新验收插件')).querySelector('button').click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
 check(!fs.existsSync(installed),'安装权限确认前没有落入插件目录')
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
 await until(()=>fs.existsSync(installed))
 check(JSON.parse(fs.readFileSync(installed)).version==='1.0.0','真实市场UI两段式安装1.0.0到临时HOME')
 await until(()=>main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('独立热更新验收插件'))?.querySelector('.pm-done') != null"))
 check(await main.eval("[...document.querySelectorAll('.pm-card')].every(e=>e.getBoundingClientRect().right<=document.querySelector('.pm-body').getBoundingClientRect().right+1)"),'市场卡片不横向溢出内容区')
 let shot=await main.send('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(path.join(output,'installed.png'),Buffer.from(shot.data,'base64'))
 version='1.1.0'
 check(await main.eval("!!document.querySelector('button[title=\"刷新目录\"]')"),'市场提供显式刷新目录入口')
 await main.eval("document.querySelector('button[title=\"刷新目录\"]').click()")
 await until(()=>main.eval("!!document.querySelector('button[title=\"更新到 1.1.0\"]')"))
 const refreshed=await main.eval('window.api.plugins.registry()')
 check(refreshed.ok&&!refreshed.stale&&refreshed.entries[0].version==='1.1.0','同一应用进程重新读取目录即获得1.1.0，无宿主构建或重启')
 await main.eval("document.querySelector('button[title=\"更新到 1.1.0\"]').click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent==='确认更新')"))
 check(await main.eval("document.querySelector('.cpk-modal-sub').textContent.includes('1.1.0')"),'更新按钮展示新版和权限确认，不静默覆盖')
 check(JSON.parse(fs.readFileSync(installed)).version==='1.0.0','更新确认前旧版本保持可用')
 check(await main.eval("(()=>{const p=document.querySelector('[aria-label=\"更新权限变更\"]');return p?.innerText.includes('新增：')&&p.innerText.includes('移除：')})()"),'update confirmation shows added and removed permissions')
 const consentShot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'permission-changes.png'),Buffer.from(consentShot.data,'base64'))
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent==='确认更新').click()")
 await until(()=>JSON.parse(fs.readFileSync(installed)).version==='1.1.0')
 await until(()=>main.eval("document.body.innerText.includes('已安装 v1.1.0')"))
 check(true,'真实市场UI确认后替换为1.1.0并显示已安装版本')
 shot=await main.send('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(path.join(output,'updated.png'),Buffer.from(shot.data,'base64'))
 version='1.2.0';broken=true
 await main.eval("document.querySelector('button[title=\"刷新目录\"]').click()")
 await until(()=>main.eval("!!document.querySelector('button[title=\"更新到 1.2.0\"]')"))
 await main.eval("document.querySelector('button[title=\"更新到 1.2.0\"]').click()")
 await until(()=>main.eval("document.body.innerText.includes('哈希校验不通过')"))
 check(true,'真实更新按钮下载损坏的1.2.0后明确显示哈希拒绝')
 check(JSON.parse(fs.readFileSync(installed)).version==='1.1.0','失败更新保留1.1.0文件')
 version='1.3.0';broken=false;entries.set(version,{...entries.get('1.2.0'),version})
 await main.eval("document.querySelector('button[title=\"刷新目录\"]').click()")
 await until(()=>main.eval("!!document.querySelector('button[title=\"更新到 1.3.0\"]')"))
 await main.eval("document.querySelector('button[title=\"更新到 1.3.0\"]').click()")
 await until(()=>main.eval("document.body.innerText.includes('包内版本与目录声明不一致')"))
 check(JSON.parse(fs.readFileSync(installed)).version==='1.1.0','有效hash但版本谎报的更新被真实UI拒绝，旧版保持')
 offline=true
 await main.eval("document.querySelector('button[title=\"刷新目录\"]').click()")
 await until(()=>main.eval("document.body.innerText.includes('目录离线，正在显示缓存')"))
 check(true,'离线刷新展示缓存提示而不是空市场')
 shot=await main.send('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(path.join(output,'failed-update.png'),Buffer.from(shot.data,'base64'))
 const sourceCache=path.join(profile,catalogSource(env.EAS_PLUGIN_REGISTRY_URL).cacheFile)
 check(fs.existsSync(sourceCache),'source-specific catalog cache was written by real app')
 const legacyCache=path.join(profile,'plugin-registry-v2.json'),legacyBytes=JSON.stringify({schema:2,plugins:[entries.get('1.0.0')],unavailable:[]})
 fs.writeFileSync(legacyCache,legacyBytes)
 fs.unlinkSync(sourceCache)
 const withoutSourceCache=await main.eval('window.api.plugins.registry()')
 check(!withoutSourceCache.ok,'offline client refuses source-less old cache instead of showing wrong catalog')
 check(fs.readFileSync(legacyCache,'utf8')===legacyBytes,'old cache left unchanged for older clients')
 check(child.pid===initialPid&&child.exitCode===null,'全程同一应用PID，无宿主重启')
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,requests,scope:'Same-process UI install, refresh, update, failure preservation and offline cache. Controlled network + home adapters; NOT production HTTPS/CDN or plugin business tool validation.'},null,2))
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
