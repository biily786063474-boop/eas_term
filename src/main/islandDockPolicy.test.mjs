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
 const create=source.slice(source.indexOf('function createElectronIsland()'),source.indexOf('function reconcile()'))
 assert.ok(create.length>100)
 assert.match(create,/show: false/)
 assert.match(create,/focusable: false/)
 assert.match(create,/type: 'panel'/)
 assert.match(create,/win\.showInactive\(\)/)
 assert.doesNotMatch(source,/app\.dock\??\.hide\(/)
})
test('Electron renderer crash recreates at once: reconcile throttles only native host failures',()=>{
 // 2026-10-01 审查发现：两条路共用 lastCrashRecreateAt 时，崩溃处理刚写下 now 就调 reconcile，
 // 守卫当场拦下 → Electron 灵动岛崩溃后永不自愈（正式版回归）
 const body=source.slice(source.indexOf('function reconcile()'),source.indexOf('function reconcile()')+4000)
 const guard=body.slice(body.indexOf('if (!islandWin || islandWin.isDestroyed())'),body.indexOf('islandWin = createIsland()'))
 const code=guard.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n')
 assert.doesNotMatch(code,/lastCrashRecreateAt/)
 assert.match(guard,/useNativeIsland\(\)/)
})
test('packaged builds ignore EAS_ISLAND_NATIVE; only Lab or unpacked dev may use the native host',()=>{
 const fn=source.slice(source.indexOf('function useNativeIsland()'),source.indexOf('function createIsland()'))
 assert.match(fn,/!app\.isPackaged && process\.env\.EAS_ISLAND_NATIVE === '1'/)
})
