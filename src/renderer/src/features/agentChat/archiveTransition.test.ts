import test from 'node:test'
import assert from 'node:assert/strict'
import { createArchiveTransition } from './archiveTransition.ts'

test('保存确认前不停止、不切换；停止后补存最终快照', async () => {
 const calls:string[]=[]
 const gate=createArchiveTransition()
 assert.equal(await gate.run({save:async()=>{calls.push('save');return true},stop:async()=>{calls.push('stop')},commit:()=>{calls.push('commit')}}),'switched')
 assert.deepEqual(calls,['save','stop','save','commit'])
})
test('保存返回 false 或抛错，均不得清空当前对话',async()=>{
 for(const mode of ['false','throw']){
 let stopped=false,committed=false
 const result=await createArchiveTransition().run({save:async()=>{if(mode==='throw')throw Error('disk');return false},stop:async()=>{stopped=true},commit:()=>{committed=true}})
 assert.equal(result,'save-failed');assert.equal(stopped,false);assert.equal(committed,false)
 }
})
test('最后补存失败保留 UI；停止失败也不切换',async()=>{
 let saves=0,commits=0
 assert.equal(await createArchiveTransition().run({save:async()=>++saves===1,stop:async()=>{},commit:()=>{commits++}}),'save-failed')
 assert.equal(await createArchiveTransition().run({save:async()=>true,stop:async()=>{throw Error('stop')},commit:()=>{commits++}}),'stop-failed')
 assert.equal(commits,0)
})
test('重复点击不产生双重切换，结束后允许重试',async()=>{
 const gate=createArchiveTransition();let release!:()=>void;const wait=new Promise<void>(r=>release=r)
 const opts={save:async()=>{await wait;return true},stop:async()=>{},commit:()=>{}}
 const first=gate.run(opts)
 assert.equal(await gate.run(opts),'busy');release();assert.equal(await first,'switched');assert.equal(await gate.run(opts),'switched')
})
test('保存期间节点已经改变：禁止停止或提交过期节点',async()=>{
 let valid=true,committed=false,stopped=false
 assert.equal(await createArchiveTransition().run({save:async()=>{valid=false;return true},stop:async()=>{stopped=true},commit:()=>{committed=true},isCurrent:()=>valid}),'stale')
 assert.equal(committed,false);assert.equal(stopped,false)
})
