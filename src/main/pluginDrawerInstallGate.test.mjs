import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const ui=fs.readFileSync('src/renderer/src/features/canvas/CanvasMarketPanel.tsx','utf8')
test('post-install drawer checks required secret configuration before offering panel',()=>{
 assert.match(ui,/missingRequiredSecrets/)
 assert.match(ui,/configuration\('status'/)
 assert.match(ui,/setupPlugin/)
})
