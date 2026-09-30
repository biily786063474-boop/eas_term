import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { usesZh } from '../../../../shared/i18n/testKeys.ts'
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
 { const perf=source.slice(source.indexOf("tab === 'perf' && ("));assert.ok(usesZh(perf.slice(0,400),'诊断日志',true),'诊断页分组标题仍是「诊断日志」') }
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
 for(const s of ['不包含 AI 会话内部工具','跨窗口共享服务不可关闭','重启即清'])assert.ok(usesZh(page,s),s)
 // 折叠是组件 state，不持久化
 assert.ok(!page.includes('localStorage'))
})
// 2026-09-30：「内置能力」两处合一 —— MCP 接入页是唯一开关入口（上「核心连接」下「内置插件」），
// 隐私页只留读写足迹 + 一个跳过去的链接，不留第二个开关入口。
test('MCP page is the single entry: core connections above built-in plugins; privacy keeps footprint + jump link only',()=>{
 const mcp=source.slice(source.indexOf("{tab === 'mcp' && ("),source.indexOf("{tab === 'sound' && ("))
 const core=mcp.indexOf('<BuiltinCapabilitiesCard />'),plugins=mcp.indexOf('<BuiltinCapabilitiesSettings />')
 assert.ok(core>0,'MCP 页挂着核心连接（BuiltinCapabilitiesCard）')
 assert.ok(plugins>core,'「核心连接」在「内置插件」之上')
 const coreGroup=[...mcp.slice(0,core).matchAll(/<SettingGroup title=\{tr\('([\w.]+)'\)\}>/g)].pop()
 assert.ok(coreGroup&&usesZh(`'${coreGroup[1]}'`,'核心连接',true),'核心连接节标题走词典')
 assert.ok(/<BuiltinCapabilitiesCard \/>/.test(mcp)&&usesZh(mcp,'随应用内置的连接',false),'核心连接有说明文案（词典）')
 const privacy=source.slice(source.indexOf("{tab === 'privacy' && ("),source.indexOf("{tab === 'runtime' &&"))
 assert.ok(!privacy.includes('BuiltinCapabilitiesCard'),'隐私页不再挂开关卡片')
 assert.match(privacy,/<FootprintPanel mode="inline"/)
 assert.match(privacy,/setTab\('mcp'\)/,'隐私页有跳到 MCP 接入的页内链接')
 const fp=fs.readFileSync(new URL('./FootprintPanel.tsx',import.meta.url),'utf8')
 assert.ok(!fp.includes('<BuiltinCapabilitiesCard')&&!/import[^\n]*BuiltinCapabilitiesCard/.test(fp),'FootprintPanel 不再内嵌开关卡片（否则隐私页还有第二个入口）')
 assert.equal((source.match(/<BuiltinCapabilitiesCard \/>/g)||[]).length,1,'全设置页只挂一处')
})
