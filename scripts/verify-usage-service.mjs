// Real Electron IPC + fixed temporary ledger. Save dialog alone is stubbed; guardPath is real.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {buildSync} from 'esbuild'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-usage-service-'))
try {
 const project=path.join(dir,'project');fs.mkdirSync(project)
 fs.writeFileSync(path.join(dir,'projects.json'),JSON.stringify([{id:'test',name:'Fixture',path:project}]))
 buildSync({entryPoints:['src/main/usage/index.ts'],outfile:path.join(dir,'service.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']})
 fs.writeFileSync(path.join(dir,'preload.cjs'),`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('testUsage',{query:q=>ipcRenderer.invoke('usage:query',q),stage:(id,s)=>ipcRenderer.invoke('usage:stage',id,s),export:q=>ipcRenderer.invoke('usage:export',q)});`)
 fs.writeFileSync(path.join(dir,'test.cjs'),`
 const {app,BrowserWindow,dialog}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 app.setPath('userData',__dirname);
 app.whenReady().then(async()=>{try{
  const u=require('./service.cjs');u.registerUsageHandlers();
  const w=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true}});await w.loadURL('data:text/html,<h1>usage fixture</h1>');
  const rec={id:'session',cli:'claude',cwd:path.join(__dirname,'project'),model:'old',pending:{model:'new'},alive:true,lastActiveAt:Date.now()};
  u.captureUsage(rec,{k:'turn.start'});u.captureUsage(rec,{k:'turn.start'});
  u.captureUsage(rec,{k:'turn.done',usage:{inputTokens:1,outputTokens:2},meter:{input:1,output:2},costUsd:1});
  u.captureUsage(rec,{k:'turn.done',usage:{inputTokens:3,outputTokens:4},meter:{input:3,output:4},costUsd:2});
  u.captureUsage(rec,{k:'turn.start'});u.markUsageInterrupted(rec);u.captureUsage(rec,{k:'turn.done',usage:{inputTokens:5,outputTokens:6},meter:{input:5,output:6},costUsd:3});
  const q={from:Date.now()-60000,to:Date.now()+1000};
  let d=await w.webContents.executeJavaScript('window.testUsage.query('+JSON.stringify(q)+')');
  assert.equal(d.summary.rounds,3);assert.equal(d.summary.tokens,21);assert.equal(d.summary.costUsd,2);assert.equal(d.summary.interrupted,1);assert.equal(d.rows[0].model,'new');
  await w.webContents.executeJavaScript('window.testUsage.stage('+JSON.stringify(d.rows[0].id)+',"回归测试")');
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname,'usage-ledger.json'),'utf8')).rows.some(r=>r.stage==='回归测试'));
  dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(__dirname,'project','usage.csv')});
  const result=await w.webContents.executeJavaScript('window.testUsage.export('+JSON.stringify(q)+')');assert.equal(result.ok,true);assert.ok(fs.readFileSync(result.path,'utf8').includes('回归测试'));
  dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(__dirname,'outside.csv')});
  const denied=await w.webContents.executeJavaScript('window.testUsage.export('+JSON.stringify(q)+')');assert.equal(denied.ok,false);assert.equal(fs.existsSync(path.join(__dirname,'outside.csv')),false);
  fs.mkdirSync(path.join(__dirname,'usage-ledger.json.tmp'));
  u.captureUsage(rec,{k:'turn.start'});u.captureUsage(rec,{k:'turn.done',usage:{inputTokens:0,outputTokens:0}});
  await new Promise(r=>setTimeout(r,600));
  const failed=await w.webContents.executeJavaScript('window.testUsage.query('+JSON.stringify({...q,to:Date.now()+1000})+')');assert.ok(failed.error.includes('保存失败'));assert.equal(failed.summary.rounds,4);
  fs.rmdirSync(path.join(__dirname,'usage-ledger.json.tmp'));
  await w.webContents.executeJavaScript('window.testUsage.stage('+JSON.stringify(failed.rows[0].id)+',"恢复写入")');
  const recovered=await w.webContents.executeJavaScript('window.testUsage.query('+JSON.stringify({...q,to:Date.now()+1000})+')');assert.equal(recovered.error,undefined);
  console.log('PASS real Electron IPC: queue/model/cancel/totals/stage/persistence/export/guard/write-failure/recovery');app.quit();
 }catch(e){console.error(e);app.exit(1)}});
 `)
 const r=spawnSync(path.join(process.cwd(),'node_modules/.bin/electron'),[path.join(dir,'test.cjs'),'--user-data-dir='+dir],{encoding:'utf8',timeout:30000})
 process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');if(r.error)console.error(r.error)
 process.exitCode=r.status??1
} finally {fs.rmSync(dir,{recursive:true,force:true})}
