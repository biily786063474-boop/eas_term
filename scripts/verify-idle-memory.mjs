import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {build} from 'esbuild'
import {spawnSync} from 'node:child_process'
const root=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-idle-native-'))
const out=path.join(root,'docs/verification/idle-memory');fs.mkdirSync(out,{recursive:true})
let source=`import {app,BrowserWindow} from 'electron';import fs from 'node:fs';import {installIdleMemoryRecovery} from MODULE;
app.whenReady().then(async()=>{let idle=false;const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await w.loadURL('data:text/html,<html><body style="background:%23151b26;color:white;padding:40px"><h1>Idle recovery fixture</h1><textarea id="draft">UNSAVED DRAFT</textarea></body></html>');const r=installIdleMemoryRecovery({idle:()=>idle,generation:()=>0,enabled:()=>true});const wait=ms=>new Promise(r=>setTimeout(r,ms));try{await wait(220);if(r.status().lastRunAt!==null)throw Error('busy was not vetoed');idle=true;await wait(450);if(!r.status().lastRunAt||r.status().lastError)throw Error('native GC did not complete');if(await w.webContents.executeJavaScript('document.querySelector("#draft").value')!=='UNSAVED DRAFT')throw Error('draft lost');if(w.webContents.debugger.isAttached())throw Error('debugger leaked');fs.writeFileSync(SCREENSHOT,(await w.webContents.capturePage()).toPNG());fs.writeFileSync(RESULT,JSON.stringify({passed:true,checks:['busy veto','native Chromium collection','unsaved DOM preserved','debugger detached'],accelerated:true}));}catch(e){console.error(e);process.exitCode=1}finally{r.dispose();w.destroy();app.quit()}})`
source=source.replace('MODULE',JSON.stringify(path.join(root,'src/main/runtime/idleMemoryRecovery.ts'))).replace('SCREENSHOT',JSON.stringify(path.join(out,'native.png'))).replace('RESULT',JSON.stringify(path.join(out,'result.json')))
await build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(dir,'main.cjs'),plugins:[{name:'accelerated-test-clock',setup(b){b.onLoad({filter:/idleMemoryRecovery\.ts$/},async args=>({contents:fs.readFileSync(args.path,'utf8').replace('createIdleRecoveryPolicy()','createIdleRecoveryPolicy({idleMs:150,maxSampleGapMs:1000})').replace('tick(),30000','tick(),30'),loader:'ts'}))}}]})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const result=spawnSync(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(dir,'main.cjs'),'--user-data-dir='+path.join(dir,'profile')],{env,encoding:'utf8',timeout:20000})
console.log(result.stdout,result.stderr);process.exitCode=result.status??1
fs.rmSync(dir,{recursive:true,force:true})
