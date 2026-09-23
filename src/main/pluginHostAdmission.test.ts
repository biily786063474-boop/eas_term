import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {HostRegistry} from './hostRegistry.ts'
import {createRuntimeManager} from './runtime/manager.ts'
import {installSessionStartup,startManagedSession,queuedSessionStarts,cancelSessionStart} from './runtime/sessionStartup.ts'

// pluginHost.ts 顶层 import electron，node --test 进不来；照 processHandoff.test.ts 的做法把
// acquire 与它依赖的两个顶层声明按名字抽出来，在 VM 里配真 HostRegistry + 真调度器跑。
const source=ts.createSourceFile('pluginHost.ts',readFileSync(new URL('./pluginHost.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
function pick(name:string):string{
 const node=source.statements.find(n=>(ts.isFunctionDeclaration(n)&&n.name?.text===name)||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name)))
 assert.ok(node,'pluginHost.ts 里找不到 '+name)
 return node.getText(source)
}
const code=ts.transpileModule([pick('PLUGIN_START_COST'),pick('startingPlugins'),pick('acquire')].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText

// sessionStartup 的管理器是模块级单例、只能装一次：两条测试共用它（虚拟时钟不走就不会排队超时），
// registry / acquire / 假 spawn 每条测试各自一套，插件名也各不相同。最后一条测试负责 dispose。
let now=0
const m=createRuntimeManager({now:()=>now,maxRunning:1,waitTimeoutMs:50});installSessionStartup(m)
function setup(name:string){
 const registry=new HostRegistry<unknown>({graceMs:1,setTimer:()=>0,clearTimer(){},onIdle(){}})
 let spawns=0,exit!:()=>void
 const hosted={kind:'plugin',name,info:{root:'/fixture/'+name},ready:Promise.resolve(),stopped:new Promise<void>(r=>{exit=r}),client:{alive:true}}
 const acquire=runInNewContext(code+'\nacquire',{
  registry,startManagedSession,manualStops:{stamp:()=>null},
  spawnHosted:()=>{spawns++;return hosted},Error,Promise,Map
 }) as (info:{name:string;displayName:string},ref:string)=>Promise<unknown>
 return {m,registry,acquire,hosted,spawns:()=>spawns,exit:()=>exit(),tick:(t:number)=>{now=t;m.invalidateMetrics()},admit:()=>m.update({at:++now,cpu:10,memoryUsedBytes:1024**3,totalMemoryBytes:16*1024**3,critical:false}),pressure:()=>m.update({at:++now,cpu:10,memoryUsedBytes:1024**3,totalMemoryBytes:16*1024**3,critical:true}),info:{name,displayName:'演示插件',root:'/fixture/'+name}}
}

test('插件服务器直接启动：严重压力不排队、并发合并、预算等真实退出',async()=>{
 const s=setup('demo'),info=s.info
 s.pressure() // 即使严重资源压力也不进全局等待队列
 const a=s.acquire(info,'panel:a'),b=s.acquire(info,'panel:b')
 await new Promise(r=>setImmediate(r))
 assert.equal(s.spawns(),1,'严重压力下插件也必须直接启动')
 const seen=queuedSessionStarts(42)
 assert.equal(seen.length,0,'插件不得进入等待队列')
 s.admit()
 assert.equal(await a,s.hosted);assert.equal(await b,s.hosted)
 assert.equal(s.spawns(),1,'两个并发请求只起一个进程');assert.equal(s.registry.refs('demo'),2)
 assert.equal(await s.acquire(info,'shim:c'),s.hosted);assert.equal(s.spawns(),1,'已有进程直接复用，不再准入')
 assert.ok(s.m.snapshot().reserved.memoryBytes>0,'进程活着预算就在')
 s.exit();await new Promise(r=>setImmediate(r))
 assert.equal(s.m.snapshot().reserved.memoryBytes,0,'真实退出才释放')
})

test('远程配置注入未接通前，手动安装的远程配置插件不能静默启动',async()=>{
 const s=setup('configured-manual');s.admit()
 const info={...s.info,remote:{auth:'none'},config:{fields:[{id:'root',type:'directory',label:'目录',purpose:'读取文件',required:true,access:'read'}]}}
 await assert.rejects(s.acquire(info,'shim:configured'),/配置/)
 assert.equal(s.spawns(),0)
 assert.equal(s.registry.refs(info.name),0)
})

test('严重压力持续超过等待超时也不影响插件启动',async()=>{
 const s=setup('demo-timeout');s.pressure()
 const p=s.acquire(s.info,'panel:x')
 await new Promise(r=>setImmediate(r));s.tick(1000)
 assert.equal(await p,s.hosted);assert.equal(s.spawns(),1)
 assert.equal(queuedSessionStarts(42).length,0)
 s.exit();await new Promise(r=>setImmediate(r));s.m.dispose()
})
