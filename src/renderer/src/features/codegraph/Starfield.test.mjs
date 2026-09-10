import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
test('starfield uses one visibility gate for focus and intersection with cleanup',()=>{
 const s=fs.readFileSync(new URL('./Starfield.tsx',import.meta.url),'utf8')
 assert.match(s,/document\.hidden\s*\|\|\s*!document\.hasFocus\(\)\s*\|\|\s*!visible/)
 for(const e of ['blur','focus']) {
  assert.ok(s.includes(`window.addEventListener('${e}', onVis)`))
  assert.ok(s.includes(`window.removeEventListener('${e}', onVis)`))
 }
})
