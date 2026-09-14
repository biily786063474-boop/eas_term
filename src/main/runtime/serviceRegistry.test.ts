import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServiceRegistry } from './serviceRegistry.ts'
test('归属/时长快照不可修改，重复ID拒绝', () => {
 let now=100;const r=createServiceRegistry(()=>now)
 const owners=['project-a'];r.register({id:'a',name:'MCP',kind:'plugin',projects:owners})
 owners.push('forged');now=5100
 assert.deepEqual(r.list()[0].projects,['project-a']);assert.equal(r.list()[0].uptimeMs,5000)
 assert.ok(Object.isFrozen(r.list()[0].projects))
 assert.throws(()=>r.register({id:'a',name:'x',kind:'x',projects:[]}),/duplicate/)
})
test('未注册停止能力的服务不可关闭', async () => {
 const r=createServiceRegistry(()=>0);r.register({id:'external',name:'External',kind:'external',projects:[]})
 await assert.rejects(r.stop('external'),/read-only/)
})
test('停止只是stopping，必须显式退出确认才能stopped', async () => {
 const r=createServiceRegistry(()=>0);let requests=0
 const h=r.register({id:'a',name:'Agent',kind:'agent',projects:['p'],requestStop:async()=>{requests++}})
 await r.stop('a');await r.stop('a');assert.equal(requests,1)
 assert.equal(r.list()[0].state,'stopping');h.exited();assert.equal(r.list()[0].state,'stopped')
})
test('停止失败可见且允许重试，退出之后不再调用停止', async () => {
 const r=createServiceRegistry(()=>0);let fail=true
 const h=r.register({id:'a',name:'Agent',kind:'agent',projects:['p'],requestStop:async()=>{if(fail)throw Error('secret detail')}})
 await assert.rejects(r.stop('a'),/^Error: stop failed$/);assert.equal(r.list()[0].state,'stop-failed')
 fail=false;await r.stop('a');h.exited();await r.stop('a');assert.equal(r.list()[0].state,'stopped')
})
test('共享服务不默认跨项目停止', async () => {
 const r=createServiceRegistry(()=>0);let calls=0
 r.register({id:'a',name:'MCP',kind:'plugin',projects:['a','b'],requestStop:async()=>{calls++}})
 await assert.rejects(r.stop('a'),/shared/);assert.equal(calls,0)
 await r.stop('a',r.prepareStop('a'));assert.equal(calls,1)
})
test('停止等待期间退出，迟到失败不把已停止服务复活', async () => {
 let reject!: (e:Error)=>void
 const r=createServiceRegistry(()=>0);const h=r.register({id:'a',name:'a',kind:'agent',projects:['p'],requestStop:()=>new Promise((_r,j)=>{reject=j})})
 const pending=r.stop('a');await Promise.resolve();h.exited();reject(Error('late'))
 await pending;assert.equal(r.list()[0].state,'stopped')
})
test('登记容量有界，移除已退出记录后可继续登记', () => {
 const r=createServiceRegistry(()=>0,1);const spec={id:'a',name:'a',kind:'agent',projects:[]}
 const h=r.register(spec);assert.throws(()=>r.register({...spec,id:'b'}),/full/)
 assert.equal(r.removeEnded('a'),false);h.exited();assert.equal(r.removeEnded('a'),true)
 r.register({...spec,id:'b'});assert.equal(r.list().length,1)
})
test('发出stop后归属变化，执行前必须拒绝，不能跨项目误停', async () => {
 const r=createServiceRegistry(()=>0);let calls=0
 const h=r.register({id:'a',name:'a',kind:'plugin',projects:['a'],requestStop:async()=>{calls++}})
 const pending=r.stop('a');h.setProjects(['a','b'])
 await assert.rejects(pending,/ownership changed/);assert.equal(calls,0)
})
test('共享确认绑定版本；新增归属后旧确认失效', async () => {
 const r=createServiceRegistry(()=>0);let calls=0
 const h=r.register({id:'a',name:'a',kind:'plugin',projects:['a','b'],requestStop:async()=>{calls++}})
 const confirmation=r.prepareStop('a');h.setProjects(['a','b','c'])
 await assert.rejects(r.stop('a',confirmation),/ownership changed/);assert.equal(calls,0)
})
test('同ID重建后，旧实例确认不允许停止新服务', async () => {
 const r=createServiceRegistry(()=>0);const spec={id:'a',name:'a',kind:'plugin',projects:['a','b'],requestStop:async()=>{}}
 const h=r.register(spec);const confirmation=r.prepareStop('a');h.exited();r.removeEnded('a');r.register(spec)
 await assert.rejects(r.stop('a',confirmation),/instance changed/)
})
test('确认过期/伪造/执行前到期全部拒绝', async () => {
 let now=0,calls=0;const r=createServiceRegistry(()=>now)
 r.register({id:'a',name:'a',kind:'plugin',projects:['a','b'],requestStop:async()=>{calls++}})
 const token=r.prepareStop('a')
 await assert.rejects(r.stop('a',{...token}),/invalid confirmation/)
 const pending=r.stop('a',token);now=31000
 await assert.rejects(pending,/confirmation expired/);assert.equal(calls,0)
})
