import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canMountHistory} from './historyMount.ts'
const frames=[{id:'f',nodes:[{id:'a',chatId:'chat-a'},{id:'b',chatId:'chat-b'}]}]
test('history mounting preserves identity and rejects another live mount',()=>{
 assert.equal(canMountHistory(frames,'f','a','older-chat'),true)
 assert.equal(canMountHistory(frames,'f','a','chat-b'),false)
 assert.equal(canMountHistory(frames,'f','missing','older-chat'),false)
 assert.equal(canMountHistory(frames,'f','a','../bad'),false)
 assert.equal(canMountHistory(frames,'f','a','chat-a'),true)
})
