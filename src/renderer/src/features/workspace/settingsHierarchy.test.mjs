import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync(new URL('./SettingsPanel.tsx',import.meta.url),'utf8')
test('titlebar alert opens MCP page; MCP body stays in settings; no permanent MCP/runtime titlebar entries',()=>{
 const alert=fs.readFileSync(new URL('./TitlebarAlert.tsx',import.meta.url),'utf8')
 assert.ok(alert.includes("tab: 'mcp'"))
 assert.ok(alert.includes("tab: 'runtime'"))
 assert.match(source,/tab === 'mcp'[\s\S]*?<McpBody/)
 const app=fs.readFileSync(new URL('../../App.tsx',import.meta.url),'utf8')
 assert.ok(!app.includes('<McpIndicator'))
 assert.ok(!app.includes('<RuntimeCenter'))
 assert.ok(app.includes('<TitlebarAlert'))
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
test('runtime page lives in settings and perf no longer embeds the old monitor panel',()=>{
 assert.match(source,/tab === 'runtime' && <RuntimeSettingsPage/)
 assert.ok(!source.includes('RuntimeMonitorPanel'))
 const page=fs.readFileSync(new URL('./RuntimeSettingsPage.tsx',import.meta.url),'utf8')
 // 三段准入范围说明一字不删：抽样各取一句
 for(const s of ['不包含 AI 会话内部工具','跨窗口共享服务不可关闭','重启即清'])assert.ok(page.includes(s),s)
 // 折叠是组件 state，不持久化
 assert.ok(!page.includes('localStorage'))
})
