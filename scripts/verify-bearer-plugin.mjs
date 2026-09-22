// Isolated real Electron/vault/shared-host verification. Owned fixture only.
// DNS, HTTPS dialing and native confirmation are boundary adapters, not upstream proof.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {McpClient} from '../src/main/mcpClient.ts'
const root=process.cwd(),out=path.join(root,'docs/verification/plugin-marketplace/bearer')
fs.mkdirSync(out,{recursive:true})
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-bearer-')),profile=path.join(tmp,'profile'),home=path.join(tmp,'home')
for(const p of [profile,home])fs.mkdirSync(p)
const name='bearer-fixture-'+process.pid,plugin=path.join(root,'resources/plugins',name),token='owned-fixture-bearer-only'
fs.mkdirSync(plugin)
fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify({name,version:'1.0.0',displayName:'Bearer连接验收',category:'开发工具',description:'自有隔离验收，不是上游可用证明',requirements:{capabilities:['mcp.remote','auth.bearer','config.fields']},config:{fields:[{id:'token',type:'secret',label:'测试令牌',purpose:'仅自有fixture',required:true}]},mcp:{transport:'streamable-http',url:'https://fixture.example.com/mcp',approvedOrigins:['https://fixture.example.com'],auth:'bearer',bearer:{field:'token'}},permissions:{canvas:[]}}))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'Bearer验收',path:tmp}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
let initialized=0,calls=0,rejected=0
const server=http.createServer(async(req,res)=>{
 if(req.url==='/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[],unavailable:[]}));return}
 if(req.url!=='/mcp'){res.writeHead(404);res.end();return}
 if(req.headers.authorization!=='Bearer '+token){rejected++;res.writeHead(401);res.end();return}
 if(req.method!=='POST'){res.writeHead(405);res.end();return}
 let body='';for await(const b of req)body+=b
 const m=JSON.parse(body)
 if(m.id===undefined){res.writeHead(202);res.end();return}
 let result={}
 if(m.method==='initialize'){initialized++;result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'owned-fixture',version:'1'}}}
 if(m.method==='tools/list')result={tools:[{name:'echo',description:'Owned echo',inputSchema:{type:'object',properties:{label:{type:'string'}}}}]}
 if(m.method==='tools/call'){calls++;await new Promise(r=>setTimeout(r,250));result={content:[{type:'text',text:'owned-echo-'+m.params.arguments.label}]}}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port,bootstrap=path.join(tmp,'launch.cjs')
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};
const {app,dialog,session}=require('electron');app.setAppPath(${JSON.stringify(root)});
const dns=require('node:dns/promises'),lookup=dns.lookup;dns.lookup=async(h,o)=>h==='fixture.example.com'?(o?.all?[{address:'93.184.216.34',family:4}]:{address:'93.184.216.34',family:4}):lookup(h,o);
const https=require('node:https'),request=https.request;https.request=(o,cb)=>o.servername==='fixture.example.com'&&o.hostname==='93.184.216.34'?require('node:http').request({...o,hostname:'127.0.0.1',port:${port},agent:false},cb):request(o,cb);
app.whenReady().then(()=>{const s=session.defaultSession,original=s.resolveProxy.bind(s);s.resolveProxy=u=>u==='https://fixture.example.com/mcp'?Promise.resolve('DIRECT'):original(u)});
dialog.showMessageBox=async(_w,o)=>{if(!['保存插件配置','断开并清除插件配置'].includes(o.title))throw Error('Unexpected dialog');return {response:1}};
require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
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
 check((await main.eval('window.api.secrets.setup("837194")')).ok,'真实隔离密钥柜解锁')
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.wk-edge-guide')"));await main.eval("document.querySelector('.wk-edge-guide').click()")
 await until(()=>main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))"));await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))"));await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
 const selector='[data-plugin-config="eas:'+name+'"]',card='document.querySelector('+JSON.stringify(selector)+')'
 await until(()=>main.eval('!!'+card));await main.eval(card+".querySelector('button').click()")
 await until(()=>main.eval(card+".innerText.includes('未配置')"))
 await main.eval('(()=>{const e='+card+`.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(token)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 const click=async text=>main.eval('[...'+card+'.querySelectorAll("button")].find(e=>e.textContent==='+JSON.stringify(text)+').click()')
 await until(()=>main.eval('[...'+card+'.querySelectorAll("button")].some(e=>e.textContent==="保存配置"&&!e.disabled)'))
 await click('保存配置');await until(()=>main.eval(card+'.innerText.includes("配置已保存")'))
 const files=fs.readdirSync(path.join(profile,'plugin-credentials'))
 check(files.length>0&&files.every(f=>!fs.readFileSync(path.join(profile,'plugin-credentials',f),'utf8').includes(token)),'密码输入经真实safeStorage加密落盘')
 check(await main.eval(card+'.querySelector("input").value===""'),'保存后不回显令牌')
 await click('测试连接');await until(()=>main.eval(card+'.innerText.includes("连接测试通过")'))
 check(initialized===1&&calls===0&&rejected===0,'测试连接发送Bearer且仅列工具')
 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-endpoint.json')))
 for(const label of ['claude','codex','omp']){
  const c=new McpClient({name:'verify-'+label,command:process.execPath,args:[path.join(root,'mcp/eas-plugin-shim.mjs')],cwd:tmp,env:{PATH:process.env.PATH||'',EAS_PLUGIN:name,EAS_TERM_PORT:String(endpoint.port),EAS_TERM_TOKEN:endpoint.token}});clients.push(c)
  await c.initialize('0.4.102')
  const pending=c.request('tools/call',{name:'echo',arguments:{label}})
  await wait(50)
  check((await main.eval('window.api.runtimeWaiting()')).queued===0,label+'插件调用进行中全局等待数为0')
  const r=await pending
  check(r.content?.[0]?.text==='owned-echo-'+label,label+'真实shim调用自有远程业务工具')
 }
 check(initialized===1&&calls===3,'三个shim共享同一远程宿主')
 await main.eval(card+'.closest(".pm-card").scrollIntoView({block:"center"})')
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'connected.png'),Buffer.from(shot.data,'base64'))
 await click('断开并清除配置');await until(()=>main.eval(card+'.innerText.includes("本地配置已清除")'))
 let blocked=false;try{blocked=!!(await clients[0].request('tools/call',{name:'echo',arguments:{label:'forbidden'}})).isError}catch{blocked=true}
 check(blocked&&calls===3,'清除配置阻止旧shim继续远程调用')
 const state=await main.eval('window.api.plugins.configuration("status",'+JSON.stringify('eas:'+name)+')')
 check(state.ok&&state.configured.length===0,'配置状态已清空')
 await main.eval('(()=>{const e='+card+`.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(token)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await until(()=>main.eval('[...'+card+'.querySelectorAll("button")].some(e=>e.textContent==="保存配置"&&!e.disabled)'))
 await click('保存配置');await until(()=>main.eval(card+'.innerText.includes("配置已保存")'))
 await clients[0].initialize('0.4.102')
 const restored=await clients[0].request('tools/call',{name:'echo',arguments:{label:'restored'}})
 check(restored.content?.[0]?.text==='owned-echo-restored'&&initialized===2,'重新配置产生新连接且旧撤销代次不复活')
 await main.eval('window.api.secrets.lock()')
 let locked=false;try{locked=!!(await clients[0].request('tools/call',{name:'echo',arguments:{label:'locked'}})).isError}catch{locked=true}
 check(locked&&calls===4,'密钥柜锁定阻断远程Bearer业务调用')
 check(!logs.includes(token),'应用日志不包含测试令牌')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,scope:'Real isolated Electron UI, safeStorage, shared host and three shim subprocesses. Owned HTTP endpoint with exact DNS/HTTPS-dial/PAC adapters; native confirmations adapted. Not real TLS, GitHub, model CLI or production.'},null,2));console.log(JSON.stringify({passed:true,checks}))
}catch(e){process.exitCode=1;console.error(e);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))}
finally{
 for(const c of clients){c.close();await c.exited}for(const s of sockets)s.close()
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close();fs.writeFileSync(path.join(out,'app.log'),logs)
 await fs.promises.rm(plugin,{recursive:true,force:true});await fs.promises.rm(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
