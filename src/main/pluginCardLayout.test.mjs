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
test('card content opens full detail without turning install into a nested action',()=>{
 assert.match(ui,/className="pm-card-open"/)
 assert.match(ui,/className="pm-body pm-detail"/)
 assert.doesNotMatch(ui,/<details className="pm-card-details">/)
 assert.match(ui,/className="pm-cact"/)
})
