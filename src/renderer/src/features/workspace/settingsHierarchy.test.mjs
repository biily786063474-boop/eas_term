import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync(new URL('./SettingsPanel.tsx',import.meta.url),'utf8')
test('MCP entry and body use same dedicated page',()=>{
 const indicator=fs.readFileSync(new URL('./McpIndicator.tsx',import.meta.url),'utf8')
 assert.ok(indicator.includes("tab: 'mcp'"))
 assert.match(source,/tab === 'mcp'[\s\S]*?<McpBody/)
})
test('diagnostics move to performance without losing extensions',()=>{
 assert.match(source,/tab === 'perf' && \([\s\S]*?title="诊断日志"/)
 assert.match(source,/tab === 'privacy' && \([\s\S]*?<FootprintPanel mode="inline"/)
 for(const handler of ['toggleStatusline(e.target.checked)','setApproval(mode.value)','toggleApprovalHook(e.target.checked)','setPref(\'clearShapesAfterSnapshot\'']) {
  if(handler.includes('clearShapes')) assert.ok(source.includes("'clearShapesAfterSnapshot'"))
  else assert.ok(source.includes(handler))
 }
})
test('settings styles do not redefine shared update modal material',()=>{
 const css=fs.readFileSync(new URL('./settingsHierarchy.css',import.meta.url),'utf8')
 assert.ok(!/\.cset-box\s*\{/.test(css))
 assert.ok(!css.includes('var(--fg-muted)'))
 assert.ok(source.includes('role="dialog"'))
})
