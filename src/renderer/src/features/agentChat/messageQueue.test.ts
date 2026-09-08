import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMessageQueue } from './messageQueue.ts'
const tick = () => new Promise<void>(r => setImmediate(r))
function fixture() {
  let busy = true, fail = false, interrupts = 0
  const sent: string[] = []
  const q = createMessageQueue({ busy: () => busy, send: async item => { sent.push(item.text); busy = !fail; return !fail }, interrupt: () => { interrupts++ }, changed() {} })
  return { q, sent, end: () => { busy = false; q.event('turn.done') }, fail: (v: boolean) => { fail = v }, interrupts: () => interrupts }
}
test('忙时默认 FIFO，只有真实结束事件才投递下一条', async () => {
  const f=fixture();await f.q.submit({text:'one'});await f.q.submit({text:'two'})
  assert.deepEqual(f.sent,[]);assert.equal(f.q.snapshot().items.length,2)
  f.end();await tick();assert.deepEqual(f.sent,['one'])
  f.end();await tick();assert.deepEqual(f.sent,['one','two'])
})
test('调整方向优先发送新消息，停止确认前不发送，保留旧队列', async () => {
  const f=fixture();await f.q.submit({text:'later'});await f.q.submit({text:'redirect'},'redirect')
  assert.equal(f.interrupts(),1);assert.deepEqual(f.sent,[])
  f.end();await tick();assert.deepEqual(f.sent,['redirect'])
  f.end();await tick();assert.deepEqual(f.sent,['redirect','later'])
})
test('排队失败不丢消息、不自动跳过；明确重试后继续', async () => {
  const f=fixture();await f.q.submit({text:'keep'});f.fail(true);f.end();await tick()
  assert.equal(f.q.snapshot().items[0].text,'keep');assert.equal(f.q.snapshot().paused,true)
  f.fail(false);f.q.retry();await tick();assert.deepEqual(f.sent,['keep','keep'])
})
test('取消排队不发送；销毁后结束事件不能再投递', async () => {
  const f=fixture();await f.q.submit({text:'remove'});f.q.remove(f.q.snapshot().items[0].id)
  await f.q.submit({text:'dispose'});f.q.dispose();f.end();await tick();assert.deepEqual(f.sent,[])
})
test('IPC 未返回时追加只排队，迟到成功不能越过 turn.done', async () => {
  let done!: (v:boolean)=>void
  const sent:string[]=[]
  const q=createMessageQueue({busy:()=>false,send:item=>{sent.push(item.text);return new Promise(r=>{done=r})},interrupt(){},changed(){}})
  const first=q.submit({text:'first'});await q.submit({text:'second'})
  assert.deepEqual(sent,['first']);done(true);await first;await tick();assert.deepEqual(sent,['first'])
  q.event('turn.done');await tick();assert.deepEqual(sent,['first','second']);q.dispose();done(true)
})
test('结束早于 IPC 返回也不会漏掉队列唤醒', async () => {
  let resolve!: (v:boolean)=>void
  const sent:string[]=[]
  const q=createMessageQueue({busy:()=>false,send:item=>{sent.push(item.text);return sent.length===1?new Promise(r=>{resolve=r}):Promise.resolve(true)},interrupt(){},changed(){}})
  const first=q.submit({text:'first'});await q.submit({text:'second'});q.event('turn.done');resolve(true);await first;await tick()
  assert.deepEqual(sent,['first','second'])
})
test('手动停止暂停队列，结束事件不能继续发送，重试才恢复', async () => {
  const f=fixture();await f.q.submit({text:'keep'});f.q.pause();f.end();await tick()
  assert.deepEqual(f.sent,[]);assert.equal(f.q.snapshot().paused,true)
  f.q.retry();await tick();assert.deepEqual(f.sent,['keep'])
})
test('已排队消息调整方向可优先，fatal 保留其余队列', async () => {
  const f=fixture();await f.q.submit({text:'one'});await f.q.submit({text:'two'})
  f.q.steer(f.q.snapshot().items[1].id);await tick();assert.equal(f.interrupts(),1)
  f.end();await tick();assert.deepEqual(f.sent,['two']);f.q.event('fatal');f.end();await tick()
  assert.deepEqual(f.sent,['two']);assert.equal(f.q.snapshot().items[0].text,'one')
})
