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

test('explicit migration is separate from version comparison and never crosses ecosystems or downgrades', async()=>{
 const {pluginUpdateAction}=await import('./pluginUpdate.ts')
 assert.equal(pluginUpdateAction({cli:'eas'},'1.0.0'),'migrate')
 assert.equal(pluginUpdateAction({cli:'eas',builtin:true},'1.0.0'),'migrate')
 assert.equal(pluginUpdateAction({cli:'eas',version:'2.0.0',builtin:true},'1.0.0'),null)
 assert.equal(pluginUpdateAction({cli:'eas',version:'1.0.0'},'1.1.0'),'update')
 assert.equal(pluginUpdateAction({cli:'eas',version:'1.0.0'},'1.0.0'),null)
 assert.equal(pluginUpdateAction({cli:'codex'},'1.0.0'),null)
 assert.equal(pluginUpdateAction({cli:'eas'},'bad'),null)
})
