import test from 'node:test'
import assert from 'node:assert/strict'
import {codexTaskFailure} from '../../mcp/codex-task-error.mjs'
test('managed Codex errors are actionable without echoing arbitrary provider text',()=>{
 assert.match(codexTaskFailure(Error('Codex RPC timeout: thread/goal/get')),/状态查询超时/)
 assert.match(codexTaskFailure(Error('Codex requires unsupported interactive request: item/tool/requestUserInput')),/交互请求/)
 assert.match(codexTaskFailure(Error('Codex app-server exited before task completion')),/意外关闭/)
 assert.match(codexTaskFailure(Error('Codex RPC failed')),/协议/)
 assert.match(codexTaskFailure(Error('Codex authentication_error')),/登录/)
 const secret='sk-test-private-secret'
 assert.equal(codexTaskFailure(Error('provider said '+secret)).includes(secret),false)
})
test('failure categories are stable and never contain the native message',async()=>{
 const {codexTaskFailureKind}=await import('../../mcp/codex-task-error.mjs')
 assert.equal(codexTaskFailureKind(Error('Codex RPC timeout: thread/goal/get')),'goal-read-timeout')
 assert.equal(codexTaskFailureKind(Error('Codex RPC timeout: turn/start')),'rpc-timeout')
 assert.equal(codexTaskFailureKind(Error('Codex output closed')),'channel-closed')
 assert.equal(codexTaskFailureKind(Error('Codex authentication_error')),'authentication')
 assert.equal(codexTaskFailureKind(Error('secret=sk-do-not-log')),'unknown')
})
test('routing timeout has a fixed user-facing category with the actual paid retry count',async()=>{
 const {codexTaskFailureKind}=await import('../../mcp/codex-task-error.mjs')
 for(const n of [0,1,2,3,4,5]){
  const error=Error('Codex workspace-routing-timeout:'+n)
  assert.equal(codexTaskFailureKind(error),'workspace-routing-timeout')
  const message=codexTaskFailure(error)
  assert.match(message,/工作区路由持续超时/)
  assert.match(message,new RegExp('恢复 '+n+' 次'))
  assert.equal(message.includes('https://'),false)
 }
 assert.equal(codexTaskFailureKind(Error('Codex workspace-routing-timeout:2 https://secret.example')),'unknown')
})
