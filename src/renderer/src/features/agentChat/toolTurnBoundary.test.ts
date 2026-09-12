import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatReducer } from './reduce.ts'
import { mergeUserMessages, turnCursor } from './userMessages.ts'
test('新用户消息之后首事件是工具调用，必须放在新消息下面',()=>{
 const r=createChatReducer()
 r.push({k:'text.done',text:'上一轮回答'})
 r.push({k:'turn.done',usage:{inputTokens:1,outputTokens:1}})
 const message={text:'新问题',beforeTurnCount:turnCursor(r.view())}
 r.push({k:'turn.start'})
 r.push({k:'exec.start',execId:'new',label:'Skill',detail:'测试技能'})
 const turns=mergeUserMessages(r.view(),[message]).turns
 assert.equal(turns.length,3)
 assert.equal(turns[0].execs.length,0)
 assert.equal(turns[1].text,'新问题')
 assert.equal(turns[2].execs[0].execId,'new')
 r.push({k:'exec.done',execId:'new',ok:true,output:'done'})
 assert.equal(turns[2].execs[0].state,'ok')
})
test('手机用户消息不能承载 assistant 工具；同轮多个工具仍合组',()=>{
 const r=createChatReducer();r.push({k:'user.message',text:'手机问题'})
 r.push({k:'exec.start',execId:'a',label:'读取',detail:''})
 r.push({k:'exec.start',execId:'b',label:'执行',detail:''})
 assert.equal(r.view().turns[0].execs.length,0)
 assert.equal(r.view().turns[1].execs.length,2)
})
