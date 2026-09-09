import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
test('each blueprint term closes preview when its own hover ends',()=>{
 const code=fs.readFileSync(new URL('./BlueprintPanel.tsx',import.meta.url),'utf8')
 const pill=code.slice(code.indexOf('className="dict-pill"'),code.indexOf('<span className="dict-pill-zh">'))
 assert.match(pill,/onMouseLeave=\{onLeave\}/)
 assert.match(pill,/onMouseEnter=/)
 assert.match(pill,/onClick=/)
})
