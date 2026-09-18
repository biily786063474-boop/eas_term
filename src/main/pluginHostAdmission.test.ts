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
 const hosted={kind:'plugin',name,info:{root:'/fixture/'+name},ready:Promise.resolve(),client:{alive:true,exited:new Promise<void>(r=>{exit=r})}}
 const acquire=runInNewContext(code+'\nacquire',{
  registry,startManagedSession,manualStops:{stamp:()=>null},
  spawnHosted:()=>{spawns++;return hosted},Error,Promise,Map
 }) as (info:{name:string;displayName:string},ref:string)=>Promise<unknown>
 return {m,registry,acquire,hosted,spawns:()=>spawns,exit:()=>exit(),tick:(t:number)=>{now=t;m.invalidateMetrics()},admit:()=>m.update({at:++now,cpu:10,memoryUsedBytes:1024**3,totalMemoryBytes:16*1024**3,critical:false}),pressure:()=>m.update({at:++now,cpu:10,memoryUsedBytes:1024**3,totalMemoryBytes:16*1024**3,critical:true}),info:{name,displayName:'演示插件',root:'/fixture/'+name}}
}

test('插件服务器启动先准入：排队时不 spawn、并发请求合并、全窗口可见不可取消、预算等真实退出',async()=>{
 const s=setup('demo'),info=s.info
 s.pressure() // 2026-09-14：插件启动是交互型，只在严重压力下排队
 const a=s.acquire(info,'panel:a'),b=s.acquire(info,'panel:b')
 await new Promise(r=>setImmediate(r))
 assert.equal(s.spawns(),0,'没准入之前不能起进程')
 const seen=queuedSessionStarts(42)
 assert.equal(seen.length,1);assert.equal(seen[0].scope,'app');assert.match(seen[0].name,/演示插件/)
 assert.equal(cancelSessionStart(seen[0].id,42),false)
 s.admit()
 assert.equal(await a,s.hosted);assert.equal(await b,s.hosted)
 assert.equal(s.spawns(),1,'两个并发请求只起一个进程');assert.equal(s.registry.refs('demo'),2)
 assert.equal(await s.acquire(info,'shim:c'),s.hosted);assert.equal(s.spawns(),1,'已有进程直接复用，不再准入')
 assert.ok(s.m.snapshot().reserved.memoryBytes>0,'进程活着预算就在')
 s.exit();await new Promise(r=>setImmediate(r))
 assert.equal(s.m.snapshot().reserved.memoryBytes,0,'真实退出才释放')
})

test('排队超时翻译成资源紧张文案，不暴露调度器内部字样',async()=>{
 const s=setup('demo-timeout'),info=s.info
 s.pressure()
 const p=s.acquire(info,'panel:x')
 await new Promise(r=>setImmediate(r))
 s.tick(1000)
 await assert.rejects(p,e=>/资源紧张/.test((e as Error).message)&&!/wait timeout/.test((e as Error).message))
 assert.equal(s.spawns(),0)
 s.m.dispose()
})
