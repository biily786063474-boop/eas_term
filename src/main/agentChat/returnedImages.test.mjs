import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeToolContent } from './toolResult.ts'
import { createCodexTranslator } from './codexEvents.ts'
import { createClaudeTranslator } from './claudeEvents.ts'
import { createOmpTranslator } from './ompEvents.ts'
import { createChatReducer } from '../../renderer/src/features/agentChat/reduce.ts'
import { trimForSave, settleOnLoad } from '../../renderer/src/features/agentChat/history.ts'
const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xQAAAAASUVORK5CYII='
const block = { type:'image', mimeType:'image/png', data }
test('图片工具结果提取像素且不把 base64 写进文本', () => {
 const r=normalizeToolContent([block], 'raw')
 assert.equal(r.images?.[0].url,'data:image/png;base64,'+data)
 assert.ok(!r.output.includes(data))
})
test('坏格式和过大图片明确降级，不泄漏原始数据', () => {
 for(const b of [{...block,mimeType:'image/svg+xml'},{...block,data:'bad'},{...block,data:'A'.repeat(3_000_000)},{type:'image',source:{type:'url',url:'file:///etc/passwd'}}]){
  const r=normalizeToolContent([b],'raw')
  assert.equal(r.images?.length??0,0)
  assert.match(r.output,/图片/)
  assert.ok(r.output.length<300)
 }
})
test('Claude/Codex/OMP 工具图片经过归约与历史恢复仍然存在', () => {
 const events=[
  createCodexTranslator().push(JSON.stringify({type:'item.completed',item:{id:'im',type:'mcp_tool_call',status:'completed',result:{content:[block]}}})),
  createClaudeTranslator().push(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'im',content:[block]}]}})),
  createOmpTranslator(async()=> 'allow').push(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'tool_call_update',toolCallId:'im',status:'completed',content:[{type:'content',content:block}]}}})).events
 ]
 for(const es of events){
  const e=es.find(e=>e.k==='exec.done')
  assert.ok(e)
  assert.equal(e.images?.length,1)
  const r=createChatReducer()
  r.push({k:'exec.start',execId:e.execId,label:'图片',detail:''});r.push(e)
  const restored=settleOnLoad(JSON.parse(JSON.stringify(trimForSave(r.view().turns))))
  assert.equal(restored[0].execs[0].images?.[0].url,'data:image/png;base64,'+data)
 }
})
test('Claude 与 OMP 的回答图片块也产出通用图片事件', () => {
 const claude=createClaudeTranslator().push(JSON.stringify({type:'assistant',message:{content:[{type:'image',source:{type:'base64',media_type:'image/png',data}}]}}))
 const omp=createOmpTranslator(async()=> 'allow').push(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:block}}})).events
 for(const events of [claude,omp]){
  const r=createChatReducer();for(const e of events)r.push(e)
  assert.equal(r.view().turns[0].returnedImages[0].url,'data:image/png;base64,'+data)
 }
})
test('历史保留图片而不保留危险外链，超过总预算时留下提示', () => {
 const big='iVBORw0KGgo'+ 'A'.repeat(2_000_000-11)
 const im={mimeType:'image/png',url:'data:image/png;base64,'+big}
 const turns=Array.from({length:6},(_,i)=>({role:'assistant',text:String(i),execs:[{execId:String(i),label:'image',detail:'',state:'ok',images:[im]}]}))
 const saved=trimForSave(turns)
 assert.ok(saved.some(t=>t.execs[0].imageNotice?.includes('8 MiB')))
 assert.ok(JSON.stringify(saved).length<8*1024*1024+10000)
 const dangerous=settleOnLoad([{role:'assistant',text:'',execs:[],returnedImages:[{mimeType:'image/png',url:'https://example.com/tracker.png'}]}])
 assert.equal(dangerous[0].returnedImages.length,0)
})
