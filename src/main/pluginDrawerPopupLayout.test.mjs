import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const market=fs.readFileSync('src/renderer/src/features/canvas/CanvasMarketPanel.tsx','utf8')
const popup=fs.existsSync('src/renderer/src/features/canvas/PluginDrawerPopup.tsx')?fs.readFileSync('src/renderer/src/features/canvas/PluginDrawerPopup.tsx','utf8'):''
test('eligible card content is an independent button, not wrapping switch and uninstall',()=>{
 assert.match(market,/className="mk-card-open"/)
 assert.match(market,/className="mk-act"/)
 assert.match(market,/panelEligible\(p\)/)
 assert.match(market,/e\.target\.closest\('button, \.mk-act'\)/)
})
test('popup has close control, backdrop cancellation, panel selector and sandbox host reuse',()=>{
 assert.match(popup,/showModal\(\)/)
 assert.match(popup,/onClose/)
 assert.match(popup,/PluginPanel/)
 assert.match(popup,/panel\.id/)
})
test('drawer card text stays inside the card and the panel never scrolls sideways',()=>{
 const css=fs.readFileSync('src/renderer/src/features/canvas/canvas.css','utf8')
 // 已装卡片的描述是 span，ellipsis 只对块级生效（2026-10-02 用户截图：Codex/Claude 插件描述冲出卡片）
 assert.match(market,/<span className="mk-desc">/)
 assert.match(css,/\.mk-body \.mk-desc \{ display:block; \}/)
 assert.match(css,/\.mk-panel \{[^}]*overflow-x: hidden;/)
 assert.match(css,/\.mk-name \{[^}]*min-width: 0;/)
})
