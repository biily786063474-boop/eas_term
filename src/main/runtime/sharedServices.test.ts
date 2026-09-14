import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSharedServices} from './sharedServices.ts'
test('shared service keeps other windows alive and tracks actual exit',async()=>{
 let exit!:()=>void,stops=0
 const r=createSharedServices(()=>100)
 r.add({id:'lsp:1',name:'clangd',kind:'language-server',completed:new Promise<void>(resolve=>exit=resolve),stop:()=>stops++})
 r.retain('lsp:1',1,'p');r.retain('lsp:1',2,'p')
 assert.equal(r.list(1)[0].canStop,false);assert.equal(r.list(3).length,0)
 r.releaseWindow(1);assert.equal(stops,0);assert.equal(r.list(2)[0].canStop,true)
 assert.equal((await r.stop('lsp:1',3,async()=>true)).ok,false)
 assert.equal((await r.stop('lsp:1',2,async()=>true)).ok,true);assert.equal(stops,1)
 assert.equal(r.list(2)[0].state,'stopping');exit();await Promise.resolve();assert.equal(r.list(2).length,0)
})
test('new shared reference during confirmation prevents stop',async()=>{
 let stops=0;const r=createSharedServices(()=>0)
 r.add({id:'lsp:1',name:'clangd',kind:'language-server',completed:new Promise(()=>{}),stop:()=>stops++});r.retain('lsp:1',1,'p')
 const result=await r.stop('lsp:1',1,async()=>{r.retain('lsp:1',2,'p');return true})
 assert.equal(result.ok,false);assert.equal(stops,0)
 r.releaseWindow(1);r.releaseWindow(2);assert.equal(stops,1)
})
test('application shutdown only stops registered handles once',()=>{
 let stops=0;const r=createSharedServices(()=>0)
 r.add({id:'lsp:1',name:'clangd',kind:'language-server',completed:new Promise(()=>{}),stop:()=>stops++});r.retain('lsp:1',1,'p')
 r.shutdown();r.shutdown();assert.equal(stops,1);assert.equal(r.list(1)[0].state,'stopping')
})

// 2026-09-14：共享服务真实退出后，对退出时每个持有引用的窗口各记一条「最近结束」（不标应用级）。
test('shared service exit is recorded for each referencing window',async()=>{
 const {recentActivity}=await import('./recentActivity.ts')
 const services=createSharedServices(()=>0)
 let exit!:()=>void
 services.add({id:'lsp:9',name:'TypeScript 语言服务器',kind:'language-server',completed:new Promise<void>(r=>{exit=r}),stop(){}})
 services.retain('lsp:9',81,'p1');services.retain('lsp:9',82,null)
 exit();await new Promise(r=>setImmediate(r))
 assert.deepEqual(recentActivity.list(81).map(x=>[x.id,x.kind,x.outcome,x.projectId,x.scope]),[['lsp:9','service','exited','p1',undefined]])
 assert.equal(recentActivity.list(82).length,1);assert.equal(recentActivity.list(83).length,0)
})

// 2026-09-14 P3「共享服务按项目释放」：移除项目时释放该项目的引用；只有引用清零才停，
// 别的项目仍持有的服务不受影响；已停的服务算作 stopped 落「最近结束」由退出路径负责。
test('releaseProject drops only that project\'s references and stops a service nobody else holds',async()=>{
 const services=createSharedServices(()=>0)
 let stopsA=0,stopsB=0
 services.add({id:'lsp:a',name:'A 的 LSP',kind:'language-server',completed:new Promise<void>(()=>{}),stop(){stopsA++}})
 services.add({id:'lsp:b',name:'B 与 A 共享',kind:'language-server',completed:new Promise<void>(()=>{}),stop(){stopsB++}})
 services.retain('lsp:a',1,'proj-a');services.retain('lsp:b',1,'proj-a');services.retain('lsp:b',2,'proj-b')
 const released=services.releaseProject('proj-a')
 assert.deepEqual(released,['lsp:a'],'返回真正被停掉的服务 id')
 assert.equal(stopsA,1);assert.equal(stopsB,0,'proj-b 还持有，不能停')
 assert.equal(services.list(1).length,0,'窗口 1 对 proj-a 的引用都没了');assert.equal(services.list(2).length,1)
 assert.deepEqual(services.releaseProject('proj-a'),[],'重复释放幂等')
})
