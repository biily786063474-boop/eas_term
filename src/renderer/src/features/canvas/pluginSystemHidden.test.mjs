import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { zhKeys } from '../../../../shared/i18n/testKeys.ts'
const read=f=>fs.readFileSync(new URL(f,import.meta.url),'utf8')
const panel=read('./CanvasMarketPanel.tsx'), modal=read('./PluginMarketModal.tsx')
const settings=read('../workspace/SettingsPanel.tsx'), builtin=read('../workspace/BuiltinCapabilitiesSettings.tsx')

test('drawer installed section groups by source (system excluded by the shared function)',()=>{
 assert.match(panel,/from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/pluginSourceGroups'/)
 assert.match(panel,/groupPluginsBySource\(/)
 assert.match(panel,/g\.title/)
 assert.equal(/installed\.map\(/.test(panel),false)
})
test('drawer counts and empty state ignore system plugins',()=>{
 assert.match(panel,/!p\.system/)
})
test('market modal installed page groups by source and hides system; sidebar count matches',()=>{
 assert.match(modal,/groupPluginsBySource\(/)
 assert.match(modal,/excludeSystem\(allItems/)
})
test('other list surfaces are NOT filtered by system (picker, @ refs, panelEligible keep working)',()=>{
 for(const f of ['../agentChat/composerSources.ts','./pluginDrawerGate.ts','./CanvasFilePicker.tsx']){
  assert.equal(/\.system\b/.test(read(f)),false,f)
 }
})
test('settings MCP page hosts 内置能力 group; it lists system plugins and uses the same setEnabled IPC',()=>{
 assert.match(settings,/BuiltinCapabilitiesSettings/)
 // 标题走词典：包住 <BuiltinCapabilitiesSettings /> 的 SettingGroup 的键，中文必须是「内置能力」
 const m=settings.match(/<SettingGroup title=\{tr\('([\w.]+)'\)\}>\s*<BuiltinCapabilitiesSettings \/>/)
 assert.ok(m,'内置能力 SettingGroup wraps BuiltinCapabilitiesSettings')
 assert.ok(zhKeys('内置能力',true).includes(m[1]),m[1])
 assert.match(builtin,/systemPlugins\(/)
 assert.match(builtin,/window\.api\.plugins\.setEnabled\(p\.id, p\.enabled === false\)/)
 assert.match(builtin,/type="checkbox"/)
 assert.match(builtin,/displayName/)
 assert.match(builtin,/description/)
})
