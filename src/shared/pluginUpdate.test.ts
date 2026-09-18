import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canUpdatePlugin} from './pluginUpdate.ts'
test('updates compare numeric versions and exclude builtins, other ecosystems and unknown versions',()=>{
 for(const [current,next,want] of [['1.9.0','1.10.0',true],['2.0.0','1.99.0',false],['1.0.0','1.0.0',false],['bad','2.0.0',false],[undefined,'2.0.0',false]] as const){
  assert.equal(canUpdatePlugin({cli:'eas',version:current},next),want)
 }
 assert.equal(canUpdatePlugin({cli:'codex',version:'1.0.0'},'2.0.0'),false)
 assert.equal(canUpdatePlugin({cli:'eas',builtin:true,version:'1.0.0'},'2.0.0'),false)
})
