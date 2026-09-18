// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=process.env.EAS_VERIFY_OUTPUT||path.join(root,'docs/verification/plugin-marketplace/ui');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'插入菜单验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
// A disposable built-in fixture in the isolated worktree; never a user/global install.
const authFixtureName='auth-ui-fixture-'+process.pid,authFixture=path.join(root,'resources/plugins',authFixtureName)
fs.mkdirSync(authFixture)
fs.writeFileSync(path.join(authFixture,'plugin.json'),JSON.stringify({name:authFixtureName,displayName:'账号连接验收插件',category:'Development',requirements:{capabilities:['mcp.remote','auth.oauth','config.fields']},config:{fields:[{id:'api-key',type:'secret',label:'API Key',purpose:'连接验收服务',required:true},{id:'root',type:'directory',label:'目录',purpose:'限定访问目录',required:false,access:'read'}]},mcp:{transport:'streamable-http',url:'https://fixture.example.com/mcp',approvedOrigins:['https://fixture.example.com'],auth:'oauth',oauth:{issuer:'https://fixture.example.com',authorizationEndpoint:'https://fixture.example.com/auth',tokenEndpoint:'https://fixture.example.com/token',clientId:'isolated-ui-fixture'}}}))
const requests=[]
const server=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:2,unavailable:[{name:'pending-fixture',displayName:'待授权审核验收插件',reason:'等待服务商回调审核',category:'Design'}],plugins:[{name:'compat-fixture',displayName:'兼容性验收插件',description:'隔离测试，不会安装',category:'Development',version:'1.0.0',url:'https://eas.biily.top/plugins/compat-fixture/1.0.0.zip',sha256:'a'.repeat(64),size:123,requirements:{minHostVersion:'999.0.0'}}]}))})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const executable=process.env.EAS_VERIFY_EXECUTABLE||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1',EAS_PLUGIN_REGISTRY_URL:'http://127.0.0.1:'+server.address().port+'/registry.json'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,...(process.env.EAS_VERIFY_EXECUTABLE?[]:[root]),'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}

try {
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.__store && !!window.api?.plugins'))
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.cframe[data-fid]')"))
 await main.eval("document.querySelector('.wk-edge-guide').click()")
 await until(()=>main.eval("[...document.querySelectorAll('.wk-seg-btn')].some(e=>e.textContent.includes('插件'))"))
 await main.eval("[...document.querySelectorAll('.wk-seg-btn')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('查看完整插件市场'))"))
 await main.eval("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('查看完整插件市场')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('.pm-card')].some(e=>e.textContent.includes('兼容性验收插件'))"))
 check(true,'市场展示隔离目录条目')
 await until(()=>main.eval("!!document.querySelector('[data-plugin-account-trigger]')"))
 await main.eval("document.querySelector('[data-plugin-account-trigger]').click()")
 await until(()=>main.eval("!!document.querySelector('[data-plugin-account]') && document.querySelector('[data-plugin-account]').innerText.includes('解锁密钥柜')"))
 check(await main.eval("[...document.querySelectorAll('[data-plugin-account] button')].map(x=>x.textContent).join(',')==='连接账号,刷新状态,测试连接,断开'"),'OAuth账号控制显示连接/刷新/测试/断开与真实锁定状态')
 await main.eval("[...document.querySelectorAll('[data-plugin-account] button')].find(x=>x.textContent==='刷新状态').click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-account]').innerText.includes('解锁密钥柜')"))
 const accountResult=await main.eval('window.api.plugins.authorization("status",'+JSON.stringify('eas:'+authFixtureName)+')')
 check(accountResult.ok&&accountResult.status==='locked-or-unavailable'&&Object.keys(accountResult).length===2,'实际IPC只返回状态，不返回凭证')
 await main.eval("[...document.querySelectorAll('[data-plugin-account] button')].find(x=>x.textContent==='测试连接').click()")
 await until(()=>main.eval("document.querySelector('[data-plugin-account]').innerText.includes('请先解锁密钥柜并连接账号')"))
 check(true,'未授权测试连接明确拒绝，不打开登录或发出服务调用')
 await main.eval("document.querySelector('.pm-settings-close').click()")
 check(await main.eval("!!document.querySelector('[data-plugin-config]')"),'配置插件提供软件内配置入口')
 await main.eval("document.querySelector('[data-plugin-config] button').click()")
 await until(()=>main.eval("!!document.querySelector('[data-plugin-config] input[type=password]')"))
 check(await main.eval("document.querySelector('[data-plugin-config]').innerText.includes('选择目录（只读授权）')"),'目录不允许文本路径冒充授权')
 const configState=await main.eval('window.api.plugins.configuration("status",'+JSON.stringify('eas:'+authFixtureName)+')')
 check(!configState.ok&&!('values' in configState),'锁定密钥柜拒绝配置读取且不返回值')
 check(await main.eval("document.querySelector('[data-plugin-config]').innerText.includes('状态未知')"),'锁定读取失败不误报未配置')
 await main.eval("document.querySelector('[data-plugin-config]').closest('.pm-card').scrollIntoView({block:'center'})")
 await wait(150)
 const accountShot=await main.send('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(path.join(output,'account-controls.png'),Buffer.from(accountShot.data,'base64'))
 await main.eval("document.querySelector('.pm-settings-close').click()")
 check(await main.eval("(()=>{const card=[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('待授权审核验收插件'));return !!card&&card.textContent.includes('等待服务商回调审核')&&!card.querySelector('button')})()"),'v2待接入条目展示原因且无安装按钮')
 await main.eval("[...document.querySelectorAll('.pm-card')].find(e=>e.textContent.includes('兼容性验收插件')).querySelector('button').click()")
 await until(()=>main.eval("document.body.innerText.includes('需要软件 999.0.0 或更高版本')"))
 check(true,'点击接入后显示明确宿主版本错误')
 check(requests.length>=2 && requests.every(x=>x==='/registry.json'),'请求仅为目录，未下载插件包')
 const shot=await main.send('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(path.join(output,'compatibility-rejected.png'),Buffer.from(shot.data,'base64'))
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,requests},null,2))
 console.log(JSON.stringify({passed:true,checks},null,2))
} catch(e) {console.error(e);process.exitCode=1;fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))}
finally {
 fs.rmSync(authFixture,{recursive:true,force:true})
 for(const ws of sockets)ws.close()
 child.kill('SIGTERM')
 await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)])
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 server.closeAllConnections();server.close()
 fs.writeFileSync(path.join(output,'app.log'),logs)
 await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})
 await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
