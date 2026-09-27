#!/usr/bin/env node
// Minimal engine reproduction: no Eas-Term renderer/store/plugin code, same installed Electron.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1]};
const tag=arg('--tag','minimal-widget');if(!/^[a-z0-9-]+$/.test(tag))throw Error('invalid tag');
const engine=path.resolve(arg('--engine','node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
const out=path.resolve(arg('--out','docs/verification/memory-attribution'));fs.mkdirSync(out,{recursive:true});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-widget-minimal-'))
const versionEnv={...process.env};delete versionEnv.ELECTRON_RUN_AS_NODE;
const version=execFileSync(engine,['--version'],{encoding:'utf8',env:versionEnv,timeout:15000}).trim();
const cycles=40,started=Date.now(),result={engine:version,cycles,passed:false,events:[],errors:[],crashes:[]}
const file=n=>path.join(dir,n)
fs.writeFileSync(file('plain.html'),'<!doctype html><html><body style="background:#16191d;color:#ddd">Local HTML guest</body></html>')
fs.writeFileSync(file('gl.html'),'<!doctype html><html><body><canvas width="600" height="400"></canvas><script>const gl=document.querySelector("canvas").getContext("webgl");function draw(){if(gl){gl.clearColor(.08,.22,.30,1);gl.clear(gl.COLOR_BUFFER_BIT)}requestAnimationFrame(draw)}draw()</script></body></html>')
const guestUrls=[pathToFileURL(file('plain.html')).href,pathToFileURL(file('gl.html')).href]
fs.writeFileSync(file('host.html'),'<!doctype html><html><head><style>body{background:#101316;color:#ddd}#host{display:flex;gap:16px}webview{width:500px;height:500px}</style></head><body><h2>Minimal Electron widget lifecycle</h2><div id="host"></div></body></html>')
const main=`const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(file('profile'))});
let win;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const emit=x=>console.log('EVIDENCE '+JSON.stringify(x));
app.on('web-contents-created',(_,wc)=>{wc.on('render-process-gone',(_,d)=>emit({crash:d}));});
app.whenReady().then(async()=>{try{
 win=new BrowserWindow({width:1100,height:740,show:true,webPreferences:{webviewTag:true,nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await win.loadFile(${JSON.stringify(file('host.html'))});
 for(let i=1;i<=${cycles};i++){
 emit({phase:'open',cycle:i});
 await win.webContents.executeJavaScript('(async()=>{const urls='+${JSON.stringify(JSON.stringify(guestUrls))}+'; await Promise.all(urls.map((url,i)=>new Promise((resolve,reject)=>{const w=document.createElement("webview");const timer=setTimeout(()=>reject(Error("load timeout")),8000);w.addEventListener("did-finish-load",()=>{clearTimeout(timer);resolve()},{once:true});w.addEventListener("did-fail-load",e=>{if(e.errorCode!==-3){clearTimeout(timer);reject(Error(String(e.errorCode)))}});if(i===0)w.setAttribute("partition","persist:browser");w.src=url;document.querySelector("#host").appendChild(w)})));return true})()');
 await sleep(250);emit({phase:'close',cycle:i});
 await win.webContents.executeJavaScript('document.querySelectorAll("webview").forEach(w=>w.remove());true');await sleep(250);
 }
 emit({complete:true});win.destroy();app.quit();
 }catch(e){emit({failure:String(e)});app.exit(1)}});`
fs.writeFileSync(file('main.cjs'),main)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
let child,timer,interrupted=false
const owned=new Set(),log=fs.createWriteStream(path.join(out,tag+'.local.log'));let buffer='',phase='launch'
function remember(){if(!child?.pid)return;owned.add(child.pid);const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));for(let i=0;i<8;i++)for(const [pid,parent]of rows)if(owned.has(parent))owned.add(pid)}
const interrupt=()=>{interrupted=true;result.failure='interrupted';if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM')}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
try{
 child=spawn(engine,[file('main.cjs')],{env,stdio:['ignore','pipe','pipe']});remember()
 const onData=b=>{log.write(b);buffer+=b.toString();const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(line.startsWith('EVIDENCE ')){const e=JSON.parse(line.slice(9));result.events.push(e);if(e.phase){phase=e.phase+'-'+e.cycle;remember()}if(e.crash)result.crashes.push(e.crash);if(e.failure)result.failure=e.failure;if(e.complete)result.completed=true;console.log(line)}if(line.includes(':ERROR:'))result.errors.push({phase,message:line.replace(/^\[[^\]]+\]\s*/,'').slice(0,600)})}}
 child.stdout.on('data',onData);child.stderr.on('data',onData)
 timer=setTimeout(()=>{result.failure='180s timeout';child.kill('SIGTERM')},180000)
 result.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
}catch(e){result.failure=String(e)}finally{
 clearTimeout(timer);remember()
 if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([ended,new Promise(r=>setTimeout(r,6000))])}
 let remaining=[];for(let i=0;i<20;i++){const alive=new Set(execFileSync('/bin/ps',['-axo','pid='],{encoding:'utf8'}).trim().split(/\s+/).map(Number));remaining=[...owned].filter(p=>alive.has(p));if(!remaining.length)break;await new Promise(r=>setTimeout(r,250))}
 result.remainingOwnedCount=remaining.length;result.passed=!interrupted&&!result.failure&&result.exitCode===0&&result.completed&&result.crashes.length===0&&remaining.length===0;result.elapsedSeconds=(Date.now()-started)/1000
 log.end();if(!remaining.length)fs.rmSync(dir,{recursive:true,force:true});else result.retainedProfile=dir;fs.writeFileSync(path.join(out,tag+'.json'),JSON.stringify(result,null,2))
 process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt)
 console.log(JSON.stringify({passed:result.passed,errors:result.errors,crashes:result.crashes}));if(!result.passed)process.exitCode=1
}
