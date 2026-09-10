import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync(new URL('./CanvasWikiDrawer.tsx',import.meta.url),'utf8')
const css=fs.readFileSync(new URL('./canvas.css',import.meta.url),'utf8')
test('mode tabs sit outside the drawer body, inside the shared shell',()=>{
 const tabs=source.indexOf('<div className="wk-seg">'),aside=source.indexOf('<aside')
 assert.ok(tabs>source.indexOf('<div className={`wk-shell'))
 assert.ok(tabs<aside,'tabs must precede aside, not sit under the header')
 assert.ok(!css.includes('.wiki-drawer > .wk-seg'),'remove the conflicting horizontal override')
})
test('original drawer glass material remains unchanged',()=>{
 const material=css.match(/\.wiki-drawer\s*\{([^}]+)\}/)[1]
 for(const declaration of ['background: var(--glass-1);','backdrop-filter: var(--blur);','border: 1px solid var(--glass-border);','border-radius: var(--radius-lg);','box-shadow: var(--glass-highlight), 0 10px 36px var(--ink-1);'])assert.ok(material.includes(declaration),declaration)
})
test('right drawer hides bottom tools rather than moving them',()=>{
 const rule=css.match(/\.app\.wiki-open \.canvas-zoombar,\s*\.app\.wiki-open \.ctoolbar-mini\s*\{([^}]+)\}/)?.[1]??''
 for(const declaration of ['visibility: hidden;','opacity: 0;','pointer-events: none;'])assert.ok(rule.includes(declaration),declaration)
 assert.ok(!rule.includes('translateX'))
})
