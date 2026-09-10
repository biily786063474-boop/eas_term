import test from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeTranslator } from '../agentChat/claudeEvents.ts'
import { createCodexTranslator } from '../agentChat/codexEvents.ts'
import { turnDoneOf } from '../agentChat/ompEvents.ts'
test('each translator only marks real provider usage, not synthetic completion',()=>{
 const claude=createClaudeTranslator().push(JSON.stringify({type:'result'})).find(e=>e.k==='turn.done')
 const codex=createCodexTranslator().push(JSON.stringify({type:'turn.completed'})).find(e=>e.k==='turn.done')
 assert.equal(claude?.meter,undefined);assert.equal(codex?.meter,undefined);assert.equal(turnDoneOf({}).meter,undefined)
 const omp=turnDoneOf({stopReason:'cancelled',usage:{inputTokens:10,outputTokens:5,totalTokens:100,cachedReadTokens:85}})
 assert.equal(omp.interrupted,true);assert.deepEqual(omp.meter,{input:95,output:5,cacheRead:85})
})
