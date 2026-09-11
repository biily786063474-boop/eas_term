import test from 'node:test'
import assert from 'node:assert/strict'
import { secretNavigation } from './secretNavigation.ts'
const items=[{id:'a',name:'模型',note:'开发',vars:[{varName:'MODEL_KEY'}]},{id:'b',name:'文件',vars:[{varName:'SSH_PRIVATE_KEY'}]}]
test('search uses metadata and preserves selection when possible',()=>{
 assert.equal(secretNavigation(items,'model_key','b').selected?.id,'a')
 assert.equal(secretNavigation(items,'','b').selected?.id,'b')
 assert.equal(secretNavigation(items,'开发',null).selected?.id,'a')
})
test('deleted selections fall back; missing searches and empty lists stay empty',()=>{
 assert.equal(secretNavigation(items,'','gone').selected?.id,'a')
 assert.equal(secretNavigation(items,'not-found','a').selected,undefined)
 assert.equal(secretNavigation([],'',null).selected,undefined)
})
test('values never participate in metadata search',()=>{
 const withValue=[{id:'x',name:'name',vars:[{varName:'KEY',value:'hidden-demo-value'}]}]
 assert.equal(secretNavigation(withValue,'hidden-demo-value',null).filtered.length,0)
})
