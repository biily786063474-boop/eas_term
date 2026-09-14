import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_PAGES, findSettingsPages, settingsPage } from './settingsNavigation.ts'
test('all existing settings stay in three groups, MCP and runtime have their own pages',()=>{
 assert.equal(SETTINGS_PAGES.length,11)
 assert.equal(new Set(SETTINGS_PAGES.map(x=>x.group)).size,3)
 for(const key of ['theme','ai','sound','update','board','phone','perf','privacy','keys','mcp','runtime'])assert.equal(settingsPage(key).key,key)
 // 运行与资源排在更新之后、性能与诊断之前
 const keys=SETTINGS_PAGES.map(x=>x.key)
 assert.ok(keys.indexOf('update')<keys.indexOf('runtime')&&keys.indexOf('runtime')<keys.indexOf('perf'))
})
test('keyword search supports moved sections and normalized input',()=>{
 assert.deepEqual(findSettingsPages('  黑匣子 ').map(x=>x.key),['perf'])
 assert.ok(findSettingsPages('statusline').some(x=>x.key==='ai'))
 assert.deepEqual(findSettingsPages('MCP').map(x=>x.key),['mcp'])
 assert.equal(findSettingsPages('not-a-setting').length,0)
 assert.equal(findSettingsPages(' ').length,11)
 assert.deepEqual(findSettingsPages('排队').map(x=>x.key),['runtime'])
})
test('invalid route falls back safely',()=>assert.equal(settingsPage('invalid').key,'theme'))
