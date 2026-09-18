import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {watchPluginFiles} from './pluginLifecycle.ts'
test('nested plugin update invalidates exactly once; closing watcher prevents later invalidation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-watch-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.mkdirSync(path.join(root,'lib'));const file=path.join(root,'lib/store.mjs');fs.writeFileSync(file,'v1')
 let n=0;const close=watchPluginFiles(root,()=>n++);t.after(close)
 fs.writeFileSync(file,'v2')
 for(let i=0;i<100&&!n;i++)await new Promise(r=>setTimeout(r,20))
 assert.equal(n,1);fs.writeFileSync(file,'v3');await new Promise(r=>setTimeout(r,60));assert.equal(n,1)
 const close2=watchPluginFiles(root,()=>n++);close2();fs.writeFileSync(file,'v4');await new Promise(r=>setTimeout(r,60));assert.equal(n,1)
})
test('reattaching after reinstall ignores buffered filesystem notifications for unchanged files',async t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-reinstall-')),root=path.join(parent,'plugin'),away=path.join(parent,'away')
 t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));fs.mkdirSync(root);fs.writeFileSync(path.join(root,'server.mjs'),'v1')
 const closeOld=watchPluginFiles(root,()=>{});fs.renameSync(root,away);closeOld();fs.renameSync(away,root)
 let n=0;const close=watchPluginFiles(root,()=>n++);t.after(close)
 await new Promise(r=>setTimeout(r,500));assert.equal(n,0)
})
