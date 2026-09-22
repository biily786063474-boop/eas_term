// Local privacy page only; isolated profile, all HTTP(S) blocked.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const require=createRequire(import.meta.url)
const root=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-privacy-'))
const out=path.join(root,'docs/verification/plugin-marketplace/privacy')
fs.mkdirSync(out,{recursive:true})
const boot=path.join(tmp,'verify.cjs')
fs.writeFileSync(boot,`const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});
app.whenReady().then(async()=>{try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
 const win=new BrowserWindow({width:1200,height:920,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await win.loadFile(${JSON.stringify(path.join(root,'site/privacy.html'))});
 const checks=[];
 for(const width of [1200,390]){
  win.setContentSize(width,920);await new Promise(r=>setTimeout(r,150));
  const state=await win.webContents.executeJavaScript("(()=>{const s=document.querySelector('#stdio-plugins');window.scrollTo({top:s.getBoundingClientRect().top+scrollY-64,behavior:'instant'});return {text:s.innerText,width:innerWidth,scroll:document.documentElement.scrollWidth,sectionHeight:s.getBoundingClientRect().height,overflowElements:[...document.querySelectorAll('body *')].filter(e=>!e.closest('table')&&e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right,text:e.innerText?.slice(0,80)})).slice(0,20)}})()");
  if(state.scroll>state.width){fs.writeFileSync(${JSON.stringify(out)}+'/overflow.json',JSON.stringify(state,null,2));throw Error('horizontal overflow: see overflow.json');}
  if(!state.text.includes('EAS_PLUGIN_CONFIG')||!state.text.includes('尚未接系统PAC/代理'))throw Error('Missing disclosure');
  await new Promise(r=>setTimeout(r,150));fs.writeFileSync(${JSON.stringify(out)}+'/privacy-'+width+'.png',(await win.webContents.capturePage()).toPNG());
  checks.push({width,overflow:false,disclosure:true,sectionHeight:state.sectionHeight});
 }
 fs.writeFileSync(${JSON.stringify(out)}+'/result.json',JSON.stringify({passed:true,checks,network:'blocked',productionPublished:false},null,2)+'\\n');win.close();app.exit(0);
}catch(e){console.error(e);app.exit(1)}});`)
try{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const p=spawn(require('electron'),[boot],{env,stdio:'inherit'})
 const timeout=setTimeout(()=>p.kill('SIGTERM'),30000)
 const code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('exit',resolve)})
 clearTimeout(timeout);if(code!==0)throw Error('Privacy verification exit '+code)
 console.log('Privacy page verified: desktop/mobile, network blocked, no horizontal overflow')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
