// Isolated real Electron market/shared-host verification. Owned fixture only.
// Package download and exact fixture DNS/HTTPS dialing are boundary adapters, not Internet proof.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {packPlugin} from './pack-plugin.mjs'
import {McpClient} from '../src/main/mcpClient.ts'
const root=process.cwd(),out=path.join(root,'docs/verification/plugin-marketplace/amap')
fs.mkdirSync(out,{recursive:true})
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-amap-')),profile=path.join(tmp,'profile'),home=path.join(tmp,'home')
for(const p of [profile,home])fs.mkdirSync(p)
const name='amap-fixture-'+process.pid,plugin=path.join(tmp,name)
fs.cpSync(path.join(root,'plugins-store/amap'),plugin,{recursive:true})
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8'));manifest.name=name;manifest.displayName='高德地图隔离验收';fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify(manifest))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'高德地图验收',path:tmp}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
let calls=0,packed,archive
const server=http.createServer((req,res)=>{
 if(req.url==='/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[packed.entry],unavailable:[]}));return}
 if(req.url===new URL(packed.entry.url).pathname){res.end(archive);return}
 calls++;const u=new URL(req.url,'http://fixture');if(u.searchParams.get('key')!=='fixture-amap-key'){res.writeHead(403);res.end();return}res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'1',geocodes:[{adcode:'110101',formatted_address:'fixture-address',location:'116.4,39.9'}],pois:[{id:'fixture-poi',name:'fixture-cafe',location:'116.4,39.9'}],route:{origin:'116.4,39.9',destination:'116.5,39.8',paths:[{distance:'100',duration:'60',steps:[{instruction:'fixture-step'}]}]}}))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port,bootstrap=path.join(tmp,'launch.cjs')
fs.writeFileSync(path.join(plugin,'owned-network-adapter.mjs'),`import dns from 'node:dns/promises';import https from 'node:https';import http from 'node:http';
 const lookup=dns.lookup;dns.lookup=(h,o)=>h==='restapi.amap.com'?Promise.resolve([{address:'8.8.8.8',family:4}]):lookup(h,o);
 const request=https.request;https.request=(o,cb)=>o.servername==='restapi.amap.com'&&o.hostname==='8.8.8.8'?http.request({...o,hostname:'127.0.0.1',port:${port}},cb):request(o,cb);`)
fs.writeFileSync(path.join(plugin,'server.mjs'),"import './owned-network-adapter.mjs'\n"+fs.readFileSync(path.join(plugin,'server.mjs'),'utf8').replace(/^#![^\n]*\n/,''))
packed=packPlugin(plugin,{outRoot:path.join(tmp,'packages'),registrySchema:2});archive=fs.readFileSync(packed.zipPath)
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};const {app,session,dialog}=require('electron');dialog.showMessageBox=async(_w,o)=>{if(!['保存插件配置','断开并清除插件配置'].includes(o.title))throw Error('Unexpected dialog');return {response:1}};app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:[${JSON.stringify(packed.entry.url)}]},(d,cb)=>cb({redirectURL:'http://127.0.0.1:${port}'+new URL(d.url).pathname})));app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
const env={...process.env,EAS_VERIFY:'1',EAS_PLUGIN_REGISTRY_URL:'http://127.0.0.1:'+port+'/registry.json'}
for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|API_KEY|SECRET|PASSWORD/.test(k))delete env[k]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),bootstrap,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b)
const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],clients=[],sockets=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function until(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await wait(100)}throw Error('Timed out')}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout'))},15000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
try{
 const debug=await until(()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const target=await until(async()=>(await(await fetch('http://127.0.0.1:'+debug+'/json/list')).json()).find(x=>x.type==='page'&&x.title==='Eas-Term'))
 const main=await connect(target.webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.api?.plugins && !!window.__store'));check((await main.eval('window.api.secrets.setup("837194")')).ok,'真实隔离密钥柜解锁')

 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.wk-edge-guide')"));await main.eval("document.querySelector('.wk-edge-guide').click()")
 await until(()=>main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))"));await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))"));await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('.pm-card')].some(e=>e.textContent.includes('高德地图隔离验收'))"))
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('高德地图隔离验收')).querySelector('.pm-add').click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
 check(!fs.existsSync(path.join(home,'.eas/plugins',name,'plugin.json')),'市场安装先确认，不静默落包')
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
 await until(()=>fs.existsSync(path.join(home,'.eas/plugins',name,'plugin.json')))
 check(true,'实际市场下载安装高德地图包，安装不自动授权')
 const card="document.querySelector('[data-plugin-config=\"eas:"+name+"\"]')"
 await until(()=>main.eval('!!'+card));await main.eval(card+'.querySelector("button").click()')
 await until(()=>main.eval('!!'+card+'.querySelector("input")'))
 await main.eval('(()=>{const e='+card+'.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"fixture-amap-key");e.dispatchEvent(new Event("input",{bubbles:true}))})()')
 const click=label=>main.eval('[...'+card+'.querySelectorAll("button")].find(e=>e.textContent==='+JSON.stringify(label)+').click()')
 await until(()=>main.eval('[...'+card+'.querySelectorAll("button")].some(e=>e.textContent==="保存配置"&&!e.disabled)'))
 await click('保存配置');await until(()=>main.eval(card+'.innerText.includes("配置已保存")'))
 const encrypted=fs.readdirSync(path.join(profile,'plugin-credentials'));check(encrypted.length===1&&!fs.readFileSync(path.join(profile,'plugin-credentials',encrypted[0]),'utf8').includes('fixture-amap-key'),'配置真实加密保存')
 check(await main.eval(card+'.querySelector("input").value===""'),'配置保存后不回显Key')
 await click('测试连接');await until(()=>main.eval(card+'.innerText.includes("连接测试通过")'));check(calls===0,'连接测试不消耗高德地图查询额度')
 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-endpoint.json')))
 for(const label of ['claude','codex','omp']){
  const c=new McpClient({name:'verify-'+label,command:process.execPath,args:[path.join(root,'mcp/eas-plugin-shim.mjs')],cwd:tmp,env:{PATH:process.env.PATH||'',EAS_PLUGIN:name,EAS_TERM_PORT:String(endpoint.port),EAS_TERM_TOKEN:endpoint.token}});clients.push(c)
  await c.initialize('0.4.102');const r=await c.request('tools/call',{name:'amap_geocode',arguments:{address:'测试地址'}})
  check(!r.isError&&JSON.parse(r.content[0].text).data[0].formatted_address==='fixture-address',label+'真实shim查询地理编码')
 }
 for(const [i,label] of ['claude','codex','omp'].entries()){
  const nearby=await clients[i].request('tools/call',{name:'amap_nearby',arguments:{location:'116.4,39.9',keywords:'咖啡'}})
  check(!nearby.isError&&JSON.parse(nearby.content[0].text).data[0].id==='fixture-poi',label+'真实shim查询周边POI')
  for(const mode of ['walking','driving']){
   const r=await clients[i].request('tools/call',{name:'amap_route',arguments:{origin:'116.4,39.9',destination:'116.5,39.8',mode}})
   check(!r.isError&&JSON.parse(r.content[0].text).data.paths[0].steps[0].instruction==='fixture-step',label+'真实shim查询'+mode+'路线')
  }
 }
 check(calls===12,'三个shim各完成地理编码、周边和两类路线')
 const bad=await clients[0].request('tools/call',{name:'amap_nearby',arguments:{location:'https://127.0.0.1/',keywords:'x'}})
 check(bad.isError&&calls===12,'实际宿主拒绝非法坐标，不发额外请求')
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('高德地图隔离验收')).scrollIntoView({block:'center'})")
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'connected.png'),Buffer.from(shot.data,'base64'))
 await click('断开并清除配置');await until(()=>main.eval(card+'.innerText.includes("本地配置已清除")'))
 let revoked=false;try{revoked=!!(await clients[0].request('tools/call',{name:'amap_geocode',arguments:{address:'测试地址'}})).isError}catch{revoked=true}
 check(revoked&&calls===12,'清除配置使旧shim失效，不再携Key查询')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,scope:'Real isolated Electron market download/hash/extraction/install confirmation, shared stdio host and three shim subprocesses; encrypted fixture credential with real safeStorage. Exact DNS/HTTPS-dial adapter only in disposable fixture plugin. Not real TLS, public Internet or model CLI. Actual package installation, not a built-in fixture.'},null,2));console.log(JSON.stringify({passed:true,checks}))
}catch(e){process.exitCode=1;console.error(e);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))}
finally{
 for(const c of clients){c.close();await c.exited}for(const s of sockets)s.close()
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close();fs.writeFileSync(path.join(out,'app.log'),logs)
 await fs.promises.rm(plugin,{recursive:true,force:true});await fs.promises.rm(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
