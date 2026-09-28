import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-hint-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'project'),out=process.argv[2]
for(const d of [profile,home,cwd,out,path.join(profile,'agent-history')])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'h',name:'提示层级验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
const turns=[{role:'user',text:'较早的提问',execs:[]},{role:'assistant',text:'之前的回答',execs:[]},{role:'user',text:'最近的提问',execs:[]},{role:'assistant',text:'好的。',execs:[]}]
fs.writeFileSync(path.join(profile,'agent-history','hint-chat.json'),JSON.stringify({turns,cwd,resumeId:'fixture',resumeCli:'claude'}))
fs.writeFileSync(path.join(profile,'canvas.json'),JSON.stringify({version:1,viewMode:'canvas',viewModePicked:true,viewport:{x:0,y:0,scale:1},frames:[{id:'hf',projectId:'h',name:'提示层级验收',x:20,y:20,w:1100,h:740,collapsed:false,nodes:[{id:'hint-chat',x:20,y:50,w:1000,h:640,pane:{kind:'agent',cwd,cli:'claude',resumeId:'fixture',resumeCli:'claude'}}]}],shapes:[],freeNodes:[],todos:[]}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const t=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page'&&x.title==='Eas-Term')}catch{}})
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))})
 const ev=async x=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}
 await send('Emulation.setFocusEmulationEnabled',{enabled:true})
 await until(()=>ev('!!window.__store'))
 for(let i=0;i<40;i++){const hit=await ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'));if(b){b.click();return true}document.querySelector('.onb-ghost')?.click();return false})()");if(hit)break;await wait(100)}
 await wait(500)
 await ev("window.__store.getState().setMaximizedNode({frameId:'hf',nodeId:'hint-chat'});true")
 await until(()=>ev("!!document.querySelector('.ac-composer-recall-hint')"))
 const measure=`(()=>{const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};const eff=(el)=>{let o=1,e=el;while(e){o*=+getComputedStyle(e).opacity;e=e.parentElement}return o};const h=document.querySelector('.ac-composer-recall-hint');const ph=document.querySelector('.ac-rich-input .cm-placeholder')||document.querySelector('.cm-placeholder');let bg=h,bgc;while(bg){bgc=getComputedStyle(bg).backgroundColor;const a=bgc.match(/[\\d.]+/g);if(a&&(a.length<4||+a[3]>.5))break;bg=bg.parentElement}const mix=(el)=>{const c=getComputedStyle(el).color.match(/[\\d.]+/g).map(Number),b=bgc.match(/[\\d.]+/g).map(Number),o=eff(el)*(c[3]??1);return 'rgb('+[0,1,2].map(i=>Math.round(c[i]*o+b[i]*(1-o))).join(',')+')'};const con=(a,b)=>{const x=lum(a),y=lum(b);return +((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};return {hint:{shown:mix(h),contrast:con(mix(h),bgc)},placeholder:ph?{shown:mix(ph),contrast:con(mix(ph),bgc)}:null,bg:bgc}})()`
 const res={}
 for(const theme of ['dark','light']){
  await ev(`window.__store.getState().setTheme(${JSON.stringify(theme)});true`);await wait(400)
  await ev("(document.querySelector('.ac-rich-input .cm-content')).focus();true");await wait(400)
  res[theme]=await ev(measure)
  const box=await ev("(()=>{const r=document.querySelector('.ac-rich-input').closest('.ac-composer-bar, .ac-input-bar, form, .ac-composer-wrap')?.getBoundingClientRect()||document.querySelector('.ac-rich-input').getBoundingClientRect();return {x:Math.max(0,r.left-20),y:Math.max(0,r.top-20),width:r.width+40,height:r.height+60,scale:1}})()")
  const s=await send('Page.captureScreenshot',{format:'png',clip:box});fs.writeFileSync(path.join(out,theme+'.png'),Buffer.from(s.result.data,'base64'))
 }
 console.log(JSON.stringify(res,null,1));ws.close()
}finally{app.kill('SIGTERM');await wait(1500);fs.rmSync(temp,{recursive:true,force:true})}
