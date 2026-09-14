import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {createRuntimeManager} from './runtime/manager.ts'
import {installSessionStartup,startManagedSession,cancelSessionStartsForWindow} from './runtime/sessionStartup.ts'
import {createSharedServices} from './runtime/sharedServices.ts'
const source=fs.readFileSync(new URL('./lspProvider.ts',import.meta.url),'utf8')
function harness(admit:any=async (opts:any)=>(await opts.start(new AbortController().signal)).value){
 const created:any[]=[],registry=createSharedServices(()=>0)
 class Client{exit!:()=>void;completed=new Promise<void>(r=>this.exit=r);lastError=null;stops=0;starts=0;resolve!:()=>void;start(){this.starts++;return new Promise<void>(r=>this.resolve=r)}stop(){this.stops++}constructor(){created.push(this)}}
 const block=source.slice(source.indexOf('const clients ='),source.indexOf('/** LSP 的 `CallHierarchyItem`'))
 const js=ts.transpileModule(block.replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 return {...new Function('LspClient','sharedServices','startManagedSession',js+';return {clientFor,dropLspClients}')(Client,registry,admit),created,registry}
}
test('concurrent LSP startup shares one handshake',async()=>{
 const h=harness(),s={bin:'test'};const a=h.clientFor('/p',s),b=h.clientFor('/p',s)
 assert.equal(h.created.length,1);h.created[0].resolve();assert.equal(await a,await b)
})
test('invalidated pending LSP cannot repopulate cache',async()=>{
 const h=harness(),s={bin:'test'};const a=h.clientFor('/p',s);const rejected=assert.rejects(a,/失效/)
 h.dropLspClients('/p');const b=h.clientFor('/p',s)
 h.created[0].resolve();await rejected
 h.created[1].resolve();assert.equal(await b,h.created[1]);assert.ok(h.created[0].stops>0)
 assert.equal(await h.clientFor('/p',s),h.created[1])
})

test('actual LSP cache registers both window references on shared startup',async()=>{
 const h=harness(),s={bin:'test',label:'Test LSP'}
 const a=h.clientFor('/p',s,{windowId:1,projectId:'p'}),b=h.clientFor('/p',s,{windowId:2,projectId:'p'})
 assert.equal(h.created.length,1);assert.equal(h.registry.list(1)[0].canStop,false)
 h.created[0].resolve();await Promise.all([a,b]);h.registry.releaseWindow(1)
 assert.equal(h.created[0].stops,0);h.registry.releaseWindow(2);assert.equal(h.created[0].stops,1)
 const next=h.clientFor('/p',s,{windowId:3,projectId:'p'});assert.equal(h.created.length,2);h.created[1].resolve();await next
})
test('reparse cannot stop a language server still referenced by another window',async()=>{
 const h=harness(),s={bin:'test',label:'Test'}
 const a=h.clientFor('/p',s,{windowId:1,projectId:'p'}),b=h.clientFor('/p',s,{windowId:2,projectId:'p'});h.created[0].resolve();await Promise.all([a,b])
 assert.throws(()=>h.dropLspClients('/p',1),/其他窗口/);assert.equal(h.created[0].stops,0)
 h.registry.releaseWindow(2);h.dropLspClients('/p',1);assert.equal(h.created[0].stops,1)
})

test('LSP admission waits without spawn, preserves shared waiter, and holds budget to exit',async()=>{
 const m=createRuntimeManager({now:()=>0});installSessionStartup(m)
 const h=harness(startManagedSession),s={bin:'test',label:'Test'}
 const a=h.clientFor('/p',s,{windowId:41,projectId:'p'}),b=h.clientFor('/p',s,{windowId:42,projectId:'p'})
 assert.equal(h.created[0].starts,0);assert.equal(h.registry.list(41).length,0)
 cancelSessionStartsForWindow(41);m.update({at:0,cpu:1,memoryUsedBytes:1,totalMemoryBytes:4*1024**3,critical:false})
 await new Promise(r=>setImmediate(r));assert.equal(h.created[0].starts,1)
 assert.equal(h.registry.list(41).length,0);assert.equal(h.registry.list(42).length,1)
 h.created[0].resolve();await Promise.all([a,b]);assert.equal(m.snapshot().reserved.memoryBytes,512*1024**2)
 h.registry.releaseWindow(42);assert.equal(h.created[0].stops,1);assert.equal(m.snapshot().reserved.memoryBytes,512*1024**2)
 h.created[0].exit();await new Promise(r=>setImmediate(r));assert.equal(m.snapshot().reserved.memoryBytes,0);m.dispose()
})
