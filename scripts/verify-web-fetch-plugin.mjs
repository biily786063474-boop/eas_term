// Isolated real Electron market/shared-host verification. Owned fixture only.
// Package download and exact fixture DNS/HTTPS dialing are boundary adapters, not Internet proof.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {packPlugin} from './pack-plugin.mjs'
import {McpClient} from '../src/main/mcpClient.ts'
const root=process.cwd(),out=path.join(root,'docs/verification/plugin-marketplace/web-fetch')
fs.mkdirSync(out,{recursive:true})
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-web-fetch-')),profile=path.join(tmp,'profile'),home=path.join(tmp,'home')
for(const p of [profile,home])fs.mkdirSync(p)
const name='web-fetch-fixture-'+process.pid,plugin=path.join(tmp,name)
fs.cpSync(path.join(root,'plugins-store/web-fetch'),plugin,{recursive:true})
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8'));manifest.name=name;manifest.displayName='网页抓取隔离验收';fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify(manifest))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'网页抓取验收',path:tmp}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
let calls=0,packed,archive
const server=http.createServer((req,res)=>{
 if(req.url==='/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[packed.entry],unavailable:[]}));return}
 if(req.url===new URL(packed.entry.url).pathname){res.end(archive);return}
 calls++;res.setHeader('content-type','text/html; charset=utf-8');res.end('<title>自有网页</title><h1>网页抓取已连接</h1><p>你好 &amp; hello</p><script>secret()</script>')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port,bootstrap=path.join(tmp,'launch.cjs')
fs.writeFileSync(path.join(plugin,'owned-network-adapter.mjs'),`import dns from 'node:dns/promises';import https from 'node:https';import http from 'node:http';
 const lookup=dns.lookup;dns.lookup=(h,o)=>h==='owned.example.com'?Promise.resolve([{address:'8.8.8.8',family:4}]):lookup(h,o);
 const request=https.request;https.request=(o,cb)=>o.servername==='owned.example.com'&&o.hostname==='8.8.8.8'?http.request({...o,hostname:'127.0.0.1',port:${port}},cb):request(o,cb);`)
fs.writeFileSync(path.join(plugin,'server.mjs'),"import './owned-network-adapter.mjs'\n"+fs.readFileSync(path.join(plugin,'server.mjs'),'utf8'))
packed=packPlugin(plugin,{outRoot:path.join(tmp,'packages'),registrySchema:2});archive=fs.readFileSync(packed.zipPath)
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};const {app,session}=require('electron');app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:[${JSON.stringify(packed.entry.url)}]},(d,cb)=>cb({redirectURL:'http://127.0.0.1:${port}'+new URL(d.url).pathname})));app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
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
 await until(()=>main.eval('!!window.api?.plugins && !!window.__store'))

 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.wk-edge-guide')"));await main.eval("document.querySelector('.wk-edge-guide').click()")
 await until(()=>main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))"));await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))"));await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('.pm-card')].some(e=>e.textContent.includes('网页抓取隔离验收'))"))
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('网页抓取隔离验收')).querySelector('.pm-add').click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('确认安装'))"))
 check(!fs.existsSync(path.join(home,'.eas/plugins',name,'plugin.json')),'市场安装先确认，不静默落包')
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确认安装')).click()")
 await until(()=>fs.existsSync(path.join(home,'.eas/plugins',name,'plugin.json')))
 check(true,'实际市场下载安装网页抓取包，无登录或密钥配置前置')
 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-endpoint.json')))
 for(const label of ['claude','codex','omp']){
  const c=new McpClient({name:'verify-'+label,command:process.execPath,args:[path.join(root,'mcp/eas-plugin-shim.mjs')],cwd:tmp,env:{PATH:process.env.PATH||'',EAS_PLUGIN:name,EAS_TERM_PORT:String(endpoint.port),EAS_TERM_TOKEN:endpoint.token}});clients.push(c)
  await c.initialize('0.4.102');const r=await c.request('tools/call',{name:'web_fetch',arguments:{url:'https://owned.example.com/'+label}})
  check(!r.isError&&JSON.parse(r.content[0].text).text.includes('你好 & hello'),label+'真实shim抓取自有网页并解码正文')
 }
 check(calls===3,'三个shim经共享stdio插件实际抓取三次')
 const bad=await clients[0].request('tools/call',{name:'web_fetch',arguments:{url:'https://127.0.0.1/'}})
 check(bad.isError&&calls===3,'实际宿主调用拒绝内网，不发额外请求')
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('网页抓取隔离验收')).scrollIntoView({block:'center'})")
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'connected.png'),Buffer.from(shot.data,'base64'))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,scope:'Real isolated Electron market download/hash/extraction/install confirmation, shared stdio host and three shim subprocesses; no account required. Exact DNS/HTTPS-dial adapter only in disposable fixture plugin. Not real TLS, public Internet or model CLI. Actual package installation, not a built-in fixture.'},null,2));console.log(JSON.stringify({passed:true,checks}))
}catch(e){process.exitCode=1;console.error(e);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))}
finally{
 for(const c of clients){c.close();await c.exited}for(const s of sockets)s.close()
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close();fs.writeFileSync(path.join(out,'app.log'),logs)
 await fs.promises.rm(plugin,{recursive:true,force:true});await fs.promises.rm(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
