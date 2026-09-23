import test from 'node:test'
import assert from 'node:assert/strict'
import {boardMoveMenu} from './moveMenu.ts'
test('custom columns retain order; current destination is disabled and never toggles to unclassified',()=>{
 const calls:Array<string|null>=[]
 const m=boardMoveMenu([{id:'a',name:'准备'},{id:'b',name:'验收'}],'a',v=>calls.push(v))
 assert.equal(m.label,'移动到看板区');assert.equal(m.sub?.[0].disabled,true)
 m.sub![0].onClick();assert.deepEqual(calls,[])
 m.sub![1].onClick();assert.deepEqual(calls,['b'])
 m.sub!.at(-1)!.onClick();assert.deepEqual(calls,['b',null])
})
test('deleted status belongs to unclassified; destination names are not hardcoded',()=>{
 const m=boardMoveMenu([{id:'custom',name:'等待客户'}],'removed',()=>{})
 assert.equal(m.sub![0].label,'等待客户');assert.equal(m.sub!.at(-1)!.disabled,true)
})
