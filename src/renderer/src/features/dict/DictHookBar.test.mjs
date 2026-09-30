import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {usesZh} from '../../../../shared/i18n/testKeys.ts'
const source=readFileSync(new URL('./DictHookBar.tsx',import.meta.url),'utf8')
test('invitation keeps disclosure collapsed and preserves explicit installation confirmation',()=>{
 assert.ok(usesZh(source,'自动记录项目概念',true))
 assert.ok(source.includes('aria-expanded={infoOpen}'))
 assert.ok(source.includes('infoOpen &&'))
 assert.ok(usesZh(source,'知道了，开启',true))
 assert.ok(source.includes('setConfirming(true)'))
 assert.ok(!usesZh(source,'记下这个项目用过哪些概念'))
})
