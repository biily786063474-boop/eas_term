import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createOwnedSessions} from '../runtime/ownedSessions.ts'
import {registerOwnedCliProcess} from './ownedProcess.ts'

class FakeProc extends EventEmitter { pid: number|undefined = 4242; exitCode: number|null = null }

// 用户 2026-09-13 定：安装/登录进程登记为可停止的自有服务，停止走一次确认。
// 不排队（登录是交互、安装不可任意中断），但运行中心要看得见、能停、真实退出才消失。
test('登记后当前窗口可见，其他窗口不可见；真实 close 后消失',async()=>{
 const sessions=createOwnedSessions(()=>0)
 const proc=new FakeProc()
 const {completed}=registerOwnedCliProcess({sessions,id:'cli-install:codex:1',name:'CLI 安装（codex）',windowId:7,proc,stop(){}})
 assert.equal(sessions.list(7).length,1);assert.equal(sessions.list(7)[0].kind,'cli');assert.equal(sessions.list(8).length,0)
 proc.exitCode=0;proc.emit('close',0,null)
 await completed;await new Promise(r=>setImmediate(r))
 assert.equal(sessions.list(7).length,0)
})

test('停止经过确认回调，确认后才调用提供的 stop；拒绝则不动',async()=>{
 const sessions=createOwnedSessions(()=>0)
 const proc=new FakeProc();let stops=0
 registerOwnedCliProcess({sessions,id:'cli-login:claude:1',name:'CLI 登录（claude）',windowId:7,proc,stop(){stops++}})
 assert.equal((await sessions.stop('cli-login:claude:1',7,async()=>false)).ok,false);assert.equal(stops,0)
 assert.equal((await sessions.stop('cli-login:claude:1',8,async()=>true)).ok,false,'别的窗口无权停')
 assert.equal((await sessions.stop('cli-login:claude:1',7,async()=>true)).ok,true);assert.equal(stops,1)
})

test('进程起不来（error 且无 pid）同样落定并移除',async()=>{
 const sessions=createOwnedSessions(()=>0)
 const proc=new FakeProc();proc.pid=undefined
 const {completed}=registerOwnedCliProcess({sessions,id:'cli-install:claude:2',name:'CLI 安装（claude）',windowId:3,proc,stop(){}})
 proc.emit('error',Error('ENOENT'))
 await completed;await new Promise(r=>setImmediate(r))
 assert.equal(sessions.list(3).length,0)
})
