import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('./DictHookBar.tsx',import.meta.url),'utf8')
test('invitation keeps disclosure collapsed and preserves explicit installation confirmation',()=>{
 assert.ok(source.includes('自动记录项目概念'))
 assert.ok(source.includes('aria-expanded={infoOpen}'))
 assert.ok(source.includes('infoOpen &&'))
 assert.ok(source.includes('知道了，开启'))
 assert.ok(source.includes('setConfirming(true)'))
 assert.ok(!source.includes('记下这个项目用过哪些概念'))
})
