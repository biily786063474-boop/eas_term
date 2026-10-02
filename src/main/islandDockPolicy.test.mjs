import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const source=readFileSync(new URL('./island.ts',import.meta.url),'utf8')
test('island workspace configuration preserves foreground app type and Dock',()=>{
 const call=source.match(/win\.setVisibleOnAllWorkspaces\(true,\s*(\{[^}]+\})\)/)
 assert.ok(call)
 const options=runInNewContext('('+call[1]+')')
 assert.equal(options.visibleOnFullScreen,true)
 assert.equal(options.skipTransformProcessType,true)
})
test('notification panel stays nonactivating and uses showInactive',()=>{
 const create=source.slice(source.indexOf('function createIsland()'),source.indexOf('function createIsland()')+8500)
 assert.match(create,/show: false/)
 assert.match(create,/focusable: false/)
 assert.match(create,/type: 'panel'/)
 assert.match(create,/win\.showInactive\(\)/)
 assert.doesNotMatch(source,/app\.dock\??\.hide\(/)
})
