import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spliceVoice } from './voiceTarget.ts'
test('语音按光标插入中文，不强塞空格', () => {
 assert.deepEqual(spliceVoice('你好世界',2,2,'美丽的'),{value:'你好美丽的世界',caret:5})
})
test('替换选区并保留前后内容', () => {
 assert.deepEqual(spliceVoice('hello old world',6,9,'new'),{value:'hello new world',caret:9})
})
test('过期选区拒绝插入而不是追加末尾', () => {
 assert.equal(spliceVoice('短',8,8,'错误'),null)
})
