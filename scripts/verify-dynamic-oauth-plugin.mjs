// Isolated real Electron/vault/shared-host verification. Owned fixture only.
// DNS, HTTPS dialing and native confirmation are boundary adapters, not upstream proof.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {McpClient} from '../src/main/mcpClient.ts'
const root=process.cwd(),out=path.join(root,'docs/verification/plugin-marketplace/dynamic-oauth')
fs.mkdirSync(out,{recursive:true})
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-dcr-')),profile=path.join(tmp,'profile'),home=path.join(tmp,'home')
for(const p of [profile,home])fs.mkdirSync(p)
const name='dcr-fixture-'+process.pid,plugin=path.join(root,'resources/plugins',name),token='owned-fixture-bearer-only'
fs.mkdirSync(plugin)
fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify({name,version:'1.0.0',displayName:'动态OAuth连接验收',category:'开发工具',description:'自有隔离验收，不是上游可用证明',requirements:{capabilities:['mcp.remote','auth.oauth','auth.oauth.dcr']},mcp:{transport:'streamable-http',url:'https://fixture.example.com/mcp',approvedOrigins:['https://fixture.example.com'],auth:'oauth',oauth:{issuer:'https://fixture.example.com',authorizationEndpoint:'https://fixture.example.com/authorize',tokenEndpoint:'https://fixture.example.com/token',registrationEndpoint:'https://fixture.example.com/register'}},permissions:{canvas:[]}}))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'Bearer验收',path:tmp}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
let initialized=0,calls=0,rejected=0,registrations=0,exchanges=0;let registration,authorization
const server=http.createServer(async(req,res)=>{
 if(req.url==='/registry.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,plugins:[],unavailable:[]}));return}
 const url=new URL(req.url,'https://fixture.example.com')
 const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))}
 if(url.pathname.startsWith('/.well-known/oauth-protected-resource'))return json({resource:'https://fixture.example.com/mcp',authorization_servers:['https://fixture.example.com']})
 if(url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:'https://fixture.example.com',authorization_endpoint:'https://fixture.example.com/authorize',token_endpoint:'https://fixture.example.com/token',registration_endpoint:'https://fixture.example.com/register',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']})
 if(url.pathname==='/register'){
  let body='';for await(const b of req)body+=b;registration=JSON.parse(body);registrations++
  if(req.method!=='POST'||registration.token_endpoint_auth_method!=='none'||registration.redirect_uris.length!==1){res.writeHead(400);res.end();return}
  res.statusCode=201;return json({...registration,client_id:'owned-public-client'})
 }
 if(url.pathname==='/authorize'){
  authorization=url.searchParams
  if(authorization.get('client_id')!=='owned-public-client'||authorization.get('redirect_uri')!==registration.redirect_uris[0]||authorization.get('code_challenge_method')!=='S256'||authorization.get('resource')!=='https://fixture.example.com/mcp'){res.writeHead(400);res.end();return}
  const callback=new URL(authorization.get('redirect_uri'));callback.searchParams.set('code','owned-code');callback.searchParams.set('state',authorization.get('state'));callback.searchParams.set('iss','https://fixture.example.com')
  const reply=await fetch(callback);res.statusCode=reply.status;res.end('fixture browser callback');return
 }
 if(url.pathname==='/token'){
  let body='';for await(const b of req)body+=b;const q=new URLSearchParams(body)
  if(q.get('client_id')!=='owned-public-client'||q.get('redirect_uri')!==registration.redirect_uris[0]||q.get('code')!=='owned-code'||q.get('resource')!=='https://fixture.example.com/mcp'||createHash('sha256').update(q.get('code_verifier')||'').digest('base64url')!==authorization.get('code_challenge')){res.writeHead(400);res.end();return}
  exchanges++;return json({access_token:token,refresh_token:'owned-refresh-only',token_type:'Bearer',expires_in:3600})
 }
 if(req.url!=='/mcp'){res.writeHead(404);res.end();return}
 if(req.headers.authorization!=='Bearer '+token){rejected++;res.writeHead(401);res.end();return}
 if(req.method!=='POST'){res.writeHead(405);res.end();return}
 let body='';for await(const b of req)body+=b
 const m=JSON.parse(body)
 if(m.id===undefined){res.writeHead(202);res.end();return}
 let result={}
 if(m.method==='initialize'){initialized++;result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'owned-fixture',version:'1'}}}
 if(m.method==='tools/list')result={tools:[{name:'echo',description:'Owned echo',inputSchema:{type:'object',properties:{label:{type:'string'}}}}]}
 if(m.method==='tools/call'){calls++;result={content:[{type:'text',text:'owned-echo-'+m.params.arguments.label}]}}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port,bootstrap=path.join(tmp,'launch.cjs')
fs.writeFileSync(bootstrap,`require('os').homedir=()=>${JSON.stringify(home)};
const {app,dialog,session,shell}=require('electron');app.setAppPath(${JSON.stringify(root)});
const dns=require('node:dns/promises'),lookup=dns.lookup;dns.lookup=async(h,o)=>h==='fixture.example.com'?(o?.all?[{address:'93.184.216.34',family:4}]:{address:'93.184.216.34',family:4}):lookup(h,o);
const https=require('node:https'),request=https.request;https.request=(o,cb)=>o.servername==='fixture.example.com'&&o.hostname==='93.184.216.34'?require('node:http').request({...o,hostname:'127.0.0.1',port:${port},agent:false},cb):request(o,cb);
app.whenReady().then(()=>{const s=session.defaultSession,original=s.resolveProxy.bind(s);s.resolveProxy=u=>new URL(u).hostname==='fixture.example.com'?Promise.resolve('DIRECT'):original(u)});
dialog.showMessageBox=async(_w,o)=>{if(!['连接插件账号','断开插件账号'].includes(o.title))throw Error('Unexpected dialog');return {response:1}};
shell.openExternal=async u=>{const v=new URL(u);if(v.origin!=='https://fixture.example.com'||v.pathname!=='/authorize')throw Error('Unexpected browser target');await new Promise((resolve,reject)=>require('node:http').get('http://127.0.0.1:${port}'+v.pathname+v.search,r=>{r.resume();r.on('end',()=>r.statusCode===200?resolve():reject(Error('callback failed')))}).on('error',reject))};
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
 const selector='[data-plugin-account="eas:'+name+'"]',card='document.querySelector('+JSON.stringify(selector)+')'
 await until(()=>main.eval("!!document.querySelector('[data-plugin-account-trigger]')"));await main.eval("document.querySelector('[data-plugin-account-trigger]').click()")
 await until(()=>main.eval('!!'+card))
 const click=async text=>main.eval('[...'+card+'.querySelectorAll("button")].find(e=>e.textContent==='+JSON.stringify(text)+').click()')
 await until(()=>main.eval('[...'+card+'.querySelectorAll("button")].some(e=>e.textContent==="连接账号"&&!e.disabled)'));await click('连接账号')
 await until(async()=>{const state=await main.eval('window.api.plugins.authorization("status",'+JSON.stringify('eas:'+name)+')');return state.status==='authorized'})
 check(registrations===1&&exchanges===1,'动态发现、注册、同一loopback回调和S256校验通过')
 const files=fs.readdirSync(path.join(profile,'plugin-credentials'))
 check(files.length===1&&files.every(f=>{const data=fs.readFileSync(path.join(profile,'plugin-credentials',f),'utf8');return !data.includes(token)&&!data.includes('owned-public-client')&&!data.includes('owned-refresh-only')}),'clientId与token经真实safeStorage原子加密落盘')
 const state=await main.eval('window.api.plugins.authorization("status",'+JSON.stringify('eas:'+name)+')')
 check(Object.keys(state).sort().join(',')==='ok,status','实际IPC仅返回状态，不泄露动态身份或token')
 await until(()=>main.eval('[...'+card+'.querySelectorAll("button")].some(e=>e.textContent==="测试连接"&&!e.disabled)'));await click('测试连接');await until(()=>main.eval(card+'.innerText.includes("已连通 · 1 个工具")'))
 check(initialized===1&&calls===0&&rejected===0,'测试连接仅握手列工具，不调用业务工具')
 check(await main.eval(card+'.innerText.includes("凭证已保存") && !'+card+'.innerText.includes("尚未测试连接")'),'连接通过后不再同时显示尚未测试')
 const endpoint=JSON.parse(fs.readFileSync(path.join(profile,'mcp-endpoint.json')))
 for(const label of ['claude','codex','omp']){
  const c=new McpClient({name:'verify-'+label,command:process.execPath,args:[path.join(root,'mcp/eas-plugin-shim.mjs')],cwd:tmp,env:{PATH:process.env.PATH||'',EAS_PLUGIN:name,EAS_TERM_PORT:String(endpoint.port),EAS_TERM_TOKEN:endpoint.token}});clients.push(c)
  await c.initialize('0.4.102');const r=await c.request('tools/call',{name:'echo',arguments:{label}})
  check(r.content?.[0]?.text==='owned-echo-'+label,label+'真实shim调用自有远程业务工具')
 }
 check(initialized===1&&calls===3,'三个shim共享同一远程宿主')
 await main.eval(card+'.scrollIntoView({block:"center"})')
 const shot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'connected.png'),Buffer.from(shot.data,'base64'))
 await main.eval('window.api.secrets.lock()')
 let locked=false;try{locked=!!(await clients[0].request('tools/call',{name:'echo',arguments:{label:'locked'}})).isError}catch{locked=true}
 check(locked&&calls===3,'密钥柜锁定阻断全部远程OAuth调用')
 check(registrations===1&&exchanges===1,'三shim共享登录，不隐式重复注册或交换')
 check(!logs.includes(token),'应用日志不包含测试令牌')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,scope:'Real isolated Electron UI, safeStorage, shared host and three shim subprocesses. Owned HTTP endpoint with exact DNS/HTTPS-dial/PAC adapters; native confirmations adapted. Dynamic registration/discovery, PKCE callback and safeStorage are real; browser opener and owned HTTP boundary adapted. Not real TLS, upstream account, model CLI or production.'},null,2));console.log(JSON.stringify({passed:true,checks}))
}catch(e){process.exitCode=1;console.error(e);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))}
finally{
 for(const c of clients){c.close();await c.exited}for(const s of sockets)s.close()
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close();fs.writeFileSync(path.join(out,'app.log'),logs)
 await fs.promises.rm(plugin,{recursive:true,force:true});await fs.promises.rm(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
