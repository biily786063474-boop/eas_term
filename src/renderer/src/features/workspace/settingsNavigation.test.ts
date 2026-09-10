import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_PAGES, findSettingsPages, settingsPage } from './settingsNavigation.ts'
test('all existing settings stay in three groups, MCP has its own page',()=>{
 assert.equal(SETTINGS_PAGES.length,10)
 assert.equal(new Set(SETTINGS_PAGES.map(x=>x.group)).size,3)
 for(const key of ['theme','ai','sound','update','board','phone','perf','privacy','keys','mcp'])assert.equal(settingsPage(key).key,key)
})
test('keyword search supports moved sections and normalized input',()=>{
 assert.deepEqual(findSettingsPages('  黑匣子 ').map(x=>x.key),['perf'])
 assert.ok(findSettingsPages('statusline').some(x=>x.key==='ai'))
 assert.deepEqual(findSettingsPages('MCP').map(x=>x.key),['mcp'])
 assert.equal(findSettingsPages('not-a-setting').length,0)
 assert.equal(findSettingsPages(' ').length,10)
})
test('invalid route falls back safely',()=>assert.equal(settingsPage('invalid').key,'theme'))
