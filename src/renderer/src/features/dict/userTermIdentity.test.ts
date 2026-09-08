import { test } from 'node:test'
import assert from 'node:assert/strict'
import { userTermIdentity } from './userTermIdentity.ts'
import { dictCandidates, insertCandidate, triggerAt } from '../agentChat/composerCandidates.ts'
import { addChip, expandChips } from '../agentChat/chips.ts'

test('raw user IDs cannot collide with builtin IDs or duplicate existing dictionary preloads', () => {
  const raw = {id:'debounce',zh:'我的防抖',en:'My debounce',keywords:[],logic:'user logic',prompt:'user prompt'}
  const user = {...raw,...userTermIdentity(raw)}
  const preload = {id:'user:debounce',label:'我的防抖',text:'preloaded version'}
  const rows = dictCandidates([preload], [{...raw,zh:'防抖',prompt:'builtin prompt'},user])
  assert.equal(rows.length,2)
  assert.equal(rows.filter(c=>c.chip?.id==='user:debounce').length,1)
  assert.equal(rows.find(c=>c.chip?.id==='debounce')?.chip?.text,'builtin prompt')
  assert.equal(rows.find(c=>c.chip?.id==='user:debounce')?.chip?.text,'preloaded version')
})
test('legacy empty zh falls back to en, and cannot expand an unrelated file reference', () => {
  const raw={id:'legacy',zh:'',en:'Legacy term',keywords:[],logic:'explanation',prompt:'specific prompt'}
  const row=dictCandidates([],[{...raw,...userTermIdentity(raw)}])[0]
  assert.equal(row.chip?.label,'Legacy term')
  const text=insertCandidate('@',triggerAt('@',1)!,row).text+'参考 @src/file.ts'
  const expanded=expandChips(text,addChip([],row.chip!))
  assert.equal(expanded.text,'specific prompt 参考 @src/file.ts')
  assert.deepEqual(expanded.usedIds,['user:legacy'])
})
