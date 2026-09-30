import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
 assert.match(settings,/title="内置能力"/)
 assert.match(builtin,/systemPlugins\(/)
 assert.match(builtin,/window\.api\.plugins\.setEnabled\(p\.id, p\.enabled === false\)/)
 assert.match(builtin,/type="checkbox"/)
 assert.match(builtin,/displayName/)
 assert.match(builtin,/description/)
})
