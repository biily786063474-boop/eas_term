import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runtimeProjectLabels} from './runtimeProjectLabels.ts'
test('project labels retain IDs and unknown ownership',()=>{
 assert.deepEqual(runtimeProjectLabels(['a','b','gone'],[{id:'a',name:'设计'},{id:'b',name:'设计'}]),['设计（a）','设计（b）','未找到项目（gone）'])
 assert.deepEqual(runtimeProjectLabels(['a'],[{id:'a',name:''}]),['未命名项目（a）'])
 assert.deepEqual(runtimeProjectLabels([],[]),[])
 assert.deepEqual(runtimeProjectLabels(['a'],[{id:'a',name:null as unknown as string}]),['未命名项目（a）'])
})
