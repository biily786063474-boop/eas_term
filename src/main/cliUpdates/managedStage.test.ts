import {test} from 'node:test'
import assert from 'node:assert/strict'
import {managedStage} from './managedStage.ts'

// 下载+解包+校验整段作为一个应用级托管任务提交；外部取消信号与任务信号合并，
// 排队被取消时根本不发起下载；完成只认 stage 本身结束。
test('managedStage 经应用级任务提交，排队取消不发起下载，成功后完成落定',async()=>{
 const calls:{id:string;name:string;cost:{cpu:number;memoryBytes:number}}[]=[]
 let stageCalls=0
 const stage=async(_root:string,_id:'codex'|'claude',_v:string,signal:AbortSignal)=>{stageCalls++;signal.throwIfAborted()}
 const runner=async<T>(opts:{id:string;name:string;cost:{cpu:number;memoryBytes:number};start:(signal:AbortSignal)=>Promise<{result:Promise<T>;completed:Promise<void>}>}):Promise<T>=>{
  calls.push({id:opts.id,name:opts.name,cost:opts.cost})
  if(opts.id.endsWith('claude'))throw Error('cancelled') // 模拟排队阶段被取消：start 根本不会被调用
  const work=await opts.start(new AbortController().signal)
  await work.completed
  return work.result
 }
 await managedStage('/root','codex','1.2.3',new AbortController().signal,{stage,run:runner})
 assert.equal(stageCalls,1)
 assert.equal(calls[0].id,'cli-update:codex');assert.ok(calls[0].cost.cpu>0&&calls[0].cost.memoryBytes>0)
 await assert.rejects(managedStage('/root','claude','1.2.3',new AbortController().signal,{stage,run:runner}),/cancelled/)
 assert.equal(stageCalls,1,'排队取消不得发起下载')
})

// 资源队列 60 秒没放行时，调度器抛 'wait timeout'。更新管理器只认 /abort|timeout/ 就会说成
// "网络恢复后可重试"——那是错的：网络没问题，是机器忙。这里要翻译成资源文案，且不能再含 timeout 字样。
test('资源排队超时翻译成资源紧张文案，不冒充网络超时',async()=>{
 const runner=async<T>(_opts:{id:string;name:string;cost:{cpu:number;memoryBytes:number};start:(signal:AbortSignal)=>Promise<{result:Promise<T>;completed:Promise<void>}>}):Promise<T>=>{throw Error('wait timeout')}
 await assert.rejects(managedStage('/root','codex','1.2.3',new AbortController().signal,{stage:async()=>{},run:runner}),e=>{
  const msg=(e as Error).message
  return /资源紧张/.test(msg)&&!/timeout|abort|网络/i.test(msg)
 })
})
