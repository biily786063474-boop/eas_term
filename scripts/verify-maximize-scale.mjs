// 验收：画布缩放 50% / 100% / 200% 下最大化同一个模块，标题栏、右上角按钮、网页排版宽度都必须一致（1:1）。
// 用法：node scripts/verify-maximize-scale.mjs web   （网页模块）  |  agent（AI 对话模块，默认）
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {spawn} from 'node:child_process'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-maxs-')),profile=path.join(temp,'profile'),home=path.join(temp,'home'),cwd=path.join(temp,'project')
const out=path.join(root,'docs/verification/maximize-scale');for(const d of [profile,home,cwd,out])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
const env={...process.env,HOME:home,EAS_VERIFY:'1'};for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
const app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--use-mock-keychain','--user-data-dir='+profile],{env,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f,n=300){for(let i=0;i<n;i++){const v=await f();if(v)return v;await wait(100)}throw Error('timeout')}
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);P.get(m.id)?.(m);P.delete(m.id)}
 const send=(method,params={})=>new Promise(r=>{const k=++id;P.set(k,r);ws.send(JSON.stringify({id:k,method,params}))})
 return {ws,send,ev:async x=>{const m=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value}}}
const MODE=process.argv[2]||'agent'
try{
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return 0}})
 const page=await connect((await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page'&&x.title==='Eas-Term')}catch{return null}})).webSocketDebuggerUrl)
 await until(()=>page.ev('!!window.__store'))
 for(let i=0;i<30;i++){if(await page.ev("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('先跳过，我自己来'))||document.querySelector('.onb-ghost');if(b){b.click();return true}return false})()"))break;await wait(100)}
 const tab={id:'tab-0',title:'对话',projectId:'p',cwd,activeLeafId:'leaf-0',root:{type:'leaf',id:'leaf-0',pane:{kind:'agent',cli:'claude',resumeCli:'claude',cwd}}}
 await page.ev(`(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',projects:[{id:'p',name:'最大化比例',path:${JSON.stringify(cwd)},addedAt:1}],tabs:[${JSON.stringify(tab)}],activeTabId:'tab-0',canvas:{...s.canvas,viewport:{x:0,y:0,scale:1},frames:[{id:'f',projectId:'p',name:'最大化比例',x:40,y:40,w:900,h:700,nodes:[{id:'n0',leafId:'leaf-0',name:'AI 模块',x:20,y:50,w:640,h:520}]}]}});return true})()`)
 await wait(1500)
 fs.writeFileSync(path.join(cwd,'page.html'),'<!doctype html><html><body style="margin:0;font:16px -apple-system"><div id="t" style="width:200px;height:100px;background:#6ee7b7">200×100 CSS px</div></body></html>')
 if(MODE.startsWith('web')){await page.ev(`(()=>{const s=window.__store.getState();s.addWebNode('f','file://'+${JSON.stringify(cwd)}+'/page.html');return true})()`);await wait(2500)}
 const nodeId=MODE.startsWith('web')?await page.ev("window.__store.getState().canvas.frames[0].nodes.find(n=>n.id!=='n0')?.id"):'n0'
 const res={nodeId}
 const measure=`(()=>{const q=s=>document.querySelector(s);const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,x:Math.round(r.left),y:Math.round(r.top)}};
  const node=[...document.querySelectorAll('.is-max, [data-max=\"1\"]')][0]||null;
  const head=node&&(node.querySelector('[class*=\"head\"],[class*=\"bar\"],[class*=\"title\"]'));
  const btns=node?[...node.querySelectorAll('button')].slice(0,6).map(b=>({cls:b.className.slice(0,40),...box(b)})):[];
  return {maxNode:node&&node.className.slice(0,80),node:box(node),head:head&&{cls:head.className.slice(0,60),...box(head)},btns,fontSize:head&&getComputedStyle(head).fontSize,win:{w:innerWidth,h:innerHeight},scale:window.__store.getState().canvas.viewport.scale}})()`
 for(const sc of [0.5,1,2]){
  await page.ev(`(()=>{const s=window.__store.getState();s.setMaximizedNode(null);window.__store.setState({canvas:{...s.canvas,viewport:{x:0,y:0,scale:${sc}}}});return true})()`)
  await wait(600)
  await page.ev(`window.__store.getState().setMaximizedNode({frameId:'f',nodeId:'${nodeId}'});true`)
  await wait(1500)
  res['scale'+sc]=await page.ev(measure)
  res['scale'+sc].webZoom=await page.ev("(async()=>{const w=document.querySelector('.is-max webview');if(!w)return null;try{return {zoom:w.getZoomFactor(),inner:await w.executeJavaScript('JSON.stringify({w:innerWidth,dpr:devicePixelRatio,box:document.getElementById(\\'t\\').getBoundingClientRect().width})')}}catch(e){return String(e)}})()")
  fs.writeFileSync(path.join(out,`${MODE}-scale-${sc}.png`),Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).result.data,'base64'))
 }
 const ks=['scale0.5','scale1','scale2']
 if(MODE.startsWith('web')){
  const same=(f)=>new Set(ks.map(k=>JSON.stringify(f(res[k])))).size===1
  if(!same(r=>r.head&&r.head.h))throw Error('标题栏高度随画布缩放变化：'+ks.map(k=>res[k].head?.h))
  if(!same(r=>r.btns.map(b=>b.w)))throw Error('右上角按钮尺寸随画布缩放变化')
  const ws=ks.map(k=>JSON.parse(res[k].webZoom.inner).w)
  if(Math.max(...ws)-Math.min(...ws)>2)throw Error('网页排版宽度随画布缩放变化：'+ks.map(k=>res[k].webZoom.inner))
  res.passed=true
 }
 fs.writeFileSync(path.join(out,`${MODE}.json`),JSON.stringify(res,null,2));console.log(JSON.stringify(res,null,1))
}finally{app.kill('SIGTERM');await wait(1500);fs.rmSync(temp,{recursive:true,force:true})}
