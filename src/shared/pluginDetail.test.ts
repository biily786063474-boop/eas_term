import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePluginDetail } from './pluginDetail.ts'

const valid={summary:'把任务整理成可检查的结果',scenarios:['想快速整理反馈时'],steps:['安装插件','在 AI 对话中提出任务'],capabilities:[{title:'分类',description:'给出分类建议',kind:'tool',tool:'classify'}],dataUse:'只处理授权的材料',changelog:'本版修复连接问题'}
test('detail accepts bounded structured text and preserves tool kind',()=>{
 assert.deepEqual(parsePluginDetail(valid),valid)
})
test('detail rejects arbitrary keys, overlong text, unsafe link and too many items',()=>{
 for(const value of [{...valid,html:'<script>'},{...valid,summary:'x'.repeat(1001)},{...valid,scenarios:Array(21).fill('x')},{...valid,supportUrl:'javascript:alert(1)'}])assert.throws(()=>parsePluginDetail(value))
})
test('detail missing is optional; incomplete fields do not become invented facts',()=>{
 assert.equal(parsePluginDetail(undefined),undefined)
 assert.deepEqual(parsePluginDetail({summary:'实际用途'}),{summary:'实际用途'})
})
