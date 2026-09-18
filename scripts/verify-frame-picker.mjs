// Isolated real-app verification. Never touches release app or real credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=process.cwd(),output=path.join(root,'docs/verification/frame-picker');fs.mkdirSync(output,{recursive:true})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-ui-')),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-timeline-data-'))
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'picker-fixture',name:'插入菜单验收',path:fixture}]))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
const executable=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env,EAS_VERIFY:'1'}
for(const n of Object.keys(env))if(n.startsWith('EAS_TERM_')||n.startsWith('EAS_CAPABILITY_'))delete env[n]
const policy='(version 1) (allow default) '+['.codex','.claude','.claude.json','.eas','.dsh'].map(n=>'(deny file-read* file-write* (subpath '+JSON.stringify(path.join(os.homedir(),n))+'))').join(' ')
const child=spawn('/usr/bin/sandbox-exec',['-p',policy,executable,root,'--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[],checks=[]
const check=(v,n)=>{if(!v)throw Error(n);checks.push(n)}
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}}}
async function until(fn){for(let i=0;i<120;i++){const x=await fn();if(x)return x;await wait(100)}throw Error('Timed out')}

for (const n of ['模型.GLB','scene.gltf','mesh.obj','mesh.fbx','mesh.stl','note.txt','photo.png']) fs.writeFileSync(path.join(fixture,n),'fixture')
fs.mkdirSync(path.join(fixture,'子目录'))
try {
 const port=await until(async()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{if(child.exitCode!==null)throw Error(logs.slice(-1500))}})
 const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
 const main=await connect((await until(async()=>(await targets()).find(x=>x.type==='page'&&x.title==='Eas-Term'))).webSocketDebuggerUrl)
 await until(()=>main.eval('!!window.__store && !!window.api?.plugins'))
 await main.eval("(async()=>{const s=window.__store.getState();s.setViewMode('canvas');await s.addProjectFrame('picker-fixture',30,30);s.setViewport({x:0,y:0,scale:1})})()")
 await until(()=>main.eval("!!document.querySelector('.cframe[data-fid]')"))
 const open=async(type='dblclick')=>{
   await main.eval("(()=>{const e=document.querySelector('.cframe[data-fid]'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent("+JSON.stringify(type)+",{bubbles:true,clientX:r.left+100,clientY:r.top+100}))})()")
   await wait(300)
 }
 const click=async label=>{await main.eval("document.querySelector('.canvas-picker [aria-label='+CSS.escape("+JSON.stringify(label)+")+']').click()");await wait(250)}
 const close=async()=>{await main.eval("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await until(()=>main.eval("!document.querySelector('.canvas-picker')"))}
 const shot=async name=>{await wait(400);const r=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'))}
 await open()
 check(await main.eval("JSON.stringify([...document.querySelectorAll('.cpk-tabs button')].map(x=>x.getAttribute('aria-label')))===JSON.stringify(['文件夹','最近'])"),'双击仅显示文件夹与最近')
 check(await main.eval("JSON.stringify([...document.querySelectorAll('.cpk-filters button')].map(x=>x.getAttribute('aria-label')))===JSON.stringify(['全部','文档','多媒体','3D'])"),'3D 位于多媒体后')
 await click('3D')
 await until(()=>main.eval("document.querySelectorAll('.cpk-row:not(.dir)').length===5"))
 check(await main.eval("document.querySelectorAll('.cpk-row.dir').length===1"),'3D 筛选保留目录')
 await shot('3d-folder')
 await click('最近')
 await until(()=>main.eval("document.querySelectorAll('.cpk-row').length===5"))
 await shot('3d-recent')
 await close();await open()
 check(await main.eval("document.querySelector('.cpk-tabs .on').getAttribute('aria-label')==='最近'"),'再次双击恢复最近')
 await close()
 // 固定临时空 Frame fixture；此用例验证视图偏好，不依赖启动时保存订阅的挂载时机。
 await main.eval("window.api.canvas.save({...window.__store.getState().canvas,viewMode:'canvas',viewModePicked:true})")
 await main.eval('location.reload()')
 await until(()=>main.eval("!!document.querySelector('.cframe[data-fid]')")).catch(async e=>{
   console.log('reload diagnostic',await main.eval("({view:window.__store?.getState().viewMode,frames:window.__store?.getState().canvas.frames,body:document.body.innerText.slice(0,500)})"))
   throw e
 })
 await open()
 check(await main.eval("document.querySelector('.cpk-tabs .on').getAttribute('aria-label')==='最近'"),'渲染重载保留最近偏好')
 await close();await open('contextmenu')
 check(await main.eval("[...document.querySelectorAll('.canvas-ctxmenu button')].some(e=>e.textContent.includes('插件'))"),'Frame 右键有插件入口')
 await shot('context-menu')
 await main.eval("[...document.querySelectorAll('.canvas-ctxmenu button')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("document.querySelector('.cpk-title')?.textContent==='插件' && document.querySelectorAll('.cpk-row').length>0"))
 check(await main.eval("!document.querySelector('.cpk-tabs') && !document.querySelector('.cpk-filters')"),'插件独立视图不含文件分类')
 await shot('plugins')
 await close();await open()
 check(await main.eval("document.querySelector('.cpk-tabs .on').getAttribute('aria-label')==='最近'"),'打开插件不覆盖最近偏好')
 await close();await open('contextmenu')
 await main.eval("[...document.querySelectorAll('.canvas-ctxmenu button')].find(e=>e.textContent.includes('插件')).click()")
 await until(()=>main.eval("[...document.querySelectorAll('.cpk-row')].some(e=>e.textContent.includes('时间线'))"))
 await main.eval("[...document.querySelectorAll('.cpk-row')].find(e=>e.textContent.includes('时间线')).click()")
 await until(()=>main.eval("window.__store.getState().canvas.frames.some(f=>f.nodes.some(n=>n.component?.type==='plugin-panel' && n.component.props?.pluginId==='eas:timeline'))"))
 check(true,'新入口可实际创建时间线插件面板')
 await shot('plugin-opened')
 await open()
 await click('文件夹');await close();await open()
 check(await main.eval("document.querySelector('.cpk-tabs .on').getAttribute('aria-label')==='文件夹'"),'切回文件夹也被记住')
 console.log(JSON.stringify({passed:true,checks},null,2))
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks},null,2))
} catch(e) {
 console.error(e);process.exitCode=1
 fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,error:String(e)},null,2))
} finally {
 for(const ws of sockets)ws.close()
 child.kill('SIGTERM')
 await Promise.race([new Promise(r=>child.once('exit',r)),wait(2000)])
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 fs.writeFileSync(path.join(output,'app.log'),logs)
 await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})
 await fs.promises.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
