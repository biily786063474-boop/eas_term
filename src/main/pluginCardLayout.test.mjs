import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const css=fs.readFileSync('src/renderer/src/features/canvas/canvas.css','utf8')
const ui=fs.readFileSync('src/renderer/src/features/canvas/PluginMarketModal.tsx','utf8')
test('market cards share a fixed border-box height instead of content height',()=>{
 const rule=css.match(/\.pm-card\s*\{([^}]+)\}/)[1]
 assert.match(rule,/height:\s*96px/)
 assert.match(rule,/box-sizing:\s*border-box/)
})
test('long descriptions and migration/source warnings remain in keyboard accessible details',()=>{
 assert.match(ui,/<details className="pm-card-details">/)
 assert.match(ui,/<summary[^>]*>详情<\/summary>/)
 assert.match(ui,/className="pm-card-notes"/)
 assert.match(css,/\.pm-card-notes\s*\{[^}]*position:\s*absolute/s)
})
