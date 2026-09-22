import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {PluginInfo} from '../shared/types.ts'
test('user copy stays selected but shadowing a bundled copy is never silent',async()=>{
 const {mergePluginCopies}=await import('./pluginCopies.ts')
 const user={name:'timeline',cli:'eas',root:'/user',version:'1.0.0'} as PluginInfo
 const builtin={...user,root:'/builtin',builtin:true,version:'2.0.0'}
 const merged=mergePluginCopies([user],[builtin,{...builtin,name:'other'}])
 assert.equal(merged.length,2)
 assert.equal(merged[0].root,'/user')
 assert.match(merged[0].shadowedBuiltin??'',/2.0.0/)
 assert.equal(user.shadowedBuiltin,undefined)
 assert.match(mergePluginCopies([user],[{...builtin,version:undefined}])[0].shadowedBuiltin??'',/版本未知/)
})
