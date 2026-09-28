import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-z-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'project')
for(const d of [profile,home,cwd])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'z',name:'层级验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'zf',projectId:'z',name:'层级验收',x:20,y:20,w:1100,h:740,collapsed:false,nodes:[{id:'zn',x:20,y:50,w:1000,h:640,pane:{kind:'agent',cwd,cli:'claude'}}]}],shapes:[],freeNodes:[],todos:[]}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const t=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page'&&x.title==='Eas-Term')}catch{}})
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const ev=async x=>{const m=await new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method:'Runtime.evaluate',params:{expression:x,returnByValue:true,awaitPromise:true}}))});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}
 await until(()=>ev('!!window.__store'))
 for(let i=0;i<30;i++){if(await ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'))||document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 await wait(600)
 const leaf=await ev("window.__store.getState().addTerminalNode('zf')")
 const pty=await until(()=>ev("(()=>{const s=window.__store.getState();const walk=r=>r.pane?.kind==='terminal'&&r.pane.ptyId?r.pane.ptyId:(r.children||[]).map(walk).find(Boolean);for(const t of s.tabs){const p=walk(t.root);if(p)return p}return null})()"))
 await ev(`window.__store.getState().setPtyRunning(${JSON.stringify(pty)},true);true`)
 await until(()=>ev("!!document.querySelector('.crm, .crm-mini')"))
 // Quota bar: real class on its real parent (tab-stack is where <QuotaBar/> renders next to CanvasStage)
 await ev("(()=>{const host=document.querySelector('.canvas-viewport').parentElement;const q=document.createElement('div');q.className='qb qb-float';q.style.pointerEvents='auto';q.textContent='Codex 100% | Claude Code 44% 10%';host.appendChild(q);return true})()")
 await wait(300)
 const test=async z=>ev(`(()=>{const out={};for(const [name,sel] of [['monitor','.crm, .crm-mini'],['quota','.qb-float']]){const t=document.querySelector(sel);const r=t.getBoundingClientRect();const d=document.createElement('div');d.className='ac-plan-card-shell ac-plan-dock is-collapsed probe-dock';d.style.cssText='position:fixed;left:'+(r.left+10)+'px;top:'+(r.top-10)+'px;width:32px;z-index:${z}';d.innerHTML='<div class=\"ac-plan-dock-marker\" style=\"opacity:1;height:120px\"></div>';document.body.appendChild(d);const hit=document.elementFromPoint(r.left+26,r.top+Math.min(10,r.height/2));out[name]={appliedZ:getComputedStyle(d).zIndex,rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],topmost:hit?.closest('.probe-dock')?'plan-dock':hit?.closest(sel)?name:(hit?.className||hit?.tagName)}}return out})()`)
 const before=await test(42)
 await ev("document.querySelectorAll('.probe-dock').forEach(e=>e.remove());true")
 const after=await test(18)
 const overContent=await ev(`(()=>{const res={};for(const [name,sel] of [['aiPane','.pane-layer .pane'],['frameHeader','.cframe-head, .cframe-header, .cframe']]){const t=document.querySelector(sel);if(!t){res[name]='missing';continue}const r=t.getBoundingClientRect();const x=r.left+Math.min(r.width/2,200),y=r.top+Math.min(r.height/2,20);const d=document.createElement('div');d.className='ac-plan-card-shell ac-plan-dock is-collapsed probe-dock2';d.style.cssText='position:fixed;left:'+(x-16)+'px;top:'+(y-30)+'px;width:32px;z-index:18';d.innerHTML='<div class=\"ac-plan-dock-marker\" style=\"opacity:1;height:80px\"></div>';document.body.appendChild(d);const hit=document.elementFromPoint(x,y);res[name]=hit?.closest('.probe-dock2')?'plan-dock':(typeof hit?.className==='string'?hit.className.split(' ')[0]:hit?.tagName)}return res})()`)
 const shot=await new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method:'Page.captureScreenshot',params:{format:'png'}}))});fs.writeFileSync(process.argv[2]||'/tmp/z-after.png',Buffer.from(shot.result.data,'base64'))
 const r={before_z42:before,after_z18:after,dockOverContent_z18:overContent}
 console.log(JSON.stringify(r,null,1));ws.close()
}finally{app.kill('SIGTERM');await wait(1500);fs.rmSync(temp,{recursive:true,force:true})}
