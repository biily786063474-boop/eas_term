import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const css=fs.readFileSync(new URL('./canvas.css',import.meta.url),'utf8')
const stage=fs.readFileSync(new URL('./CanvasStage.tsx',import.meta.url),'utf8')
const node=fs.readFileSync(new URL('./CanvasComponentNode.tsx',import.meta.url),'utf8')
const panel=fs.readFileSync(new URL('../plugins/PluginPanel.tsx',import.meta.url),'utf8')
test('unselected canvas plugin iframe releases pointer, while selected modifier zoom does too',()=>{
 assert.match(css,/\.cfile-node\[data-kind='c-plugin-panel'\]:not\(\.sel\)\s+\.plg-frame[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(css,/\.canvas-zoom-modifier[^{}]*\.cfile-node\[data-kind='c-plugin-panel'\][^{}]*\.plg-frame[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(stage,/classList\.add\('canvas-zoom-modifier'\)/)
 assert.match(stage,/classList\.remove\('canvas-zoom-modifier'\)/)
 assert.equal((node.match(/comp\.type === 'plugin-panel' && !selected && \(e\.target as HTMLElement\)\.closest\('\.cfile-body'\)/g)||[]).length,2)
 assert.match(css,/\.plg-frame\.plg-zoom-modifier[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(panel,/e\.source !== f\.contentWindow/)
 assert.match(panel,/classList\.toggle\('plg-zoom-modifier', modifier\.params\.pressed\)/)
})
