import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const market=fs.readFileSync('src/renderer/src/features/canvas/CanvasMarketPanel.tsx','utf8')
const popup=fs.existsSync('src/renderer/src/features/canvas/PluginDrawerPopup.tsx')?fs.readFileSync('src/renderer/src/features/canvas/PluginDrawerPopup.tsx','utf8'):''
test('eligible card content is an independent button, not wrapping switch and uninstall',()=>{
 assert.match(market,/className="mk-card-open"/)
 assert.match(market,/className="mk-act"/)
 assert.match(market,/panelEligible\(p\)/)
})
test('popup has close control, backdrop cancellation, panel selector and sandbox host reuse',()=>{
 assert.match(popup,/showModal\(\)/)
 assert.match(popup,/onClose/)
 assert.match(popup,/PluginPanel/)
 assert.match(popup,/panel\.id/)
})
