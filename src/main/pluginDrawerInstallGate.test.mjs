import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const ui=fs.readFileSync('src/renderer/src/features/canvas/CanvasMarketPanel.tsx','utf8')
const full=fs.readFileSync('src/renderer/src/features/canvas/PluginMarketModal.tsx','utf8')
test('post-install drawer checks required secret configuration before offering panel',()=>{
 assert.match(ui,/missingRequiredSecrets/)
 assert.match(ui,/configuration\('status'/)
 assert.match(ui,/setupPlugin/)
})
test('full market installation also prompts for missing required secrets',()=>{
 assert.match(full,/missingRequiredSecrets/)
 assert.match(full,/setupPlugin/)
})
