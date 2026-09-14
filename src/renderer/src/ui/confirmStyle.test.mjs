import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8')
test('shared and canvas confirmation actions reuse primary CTA',()=>{
 for(const file of ['./ConfirmDialog.tsx','../features/canvas/CanvasStage.tsx']) {
  const source=read(file)
  assert.doesNotMatch(source,/className="danger-btn"/)
  assert.match(source,/className="primary-btn"/)
 }
})
test('obsolete red confirmation CSS cannot return through legacy selectors',()=>{
 assert.doesNotMatch(read('../styles/base.css'),/\.danger-btn\s*[{ :]/)
 assert.doesNotMatch(read('../features/design/composer/designer/styles.css'),/\.uc__complib-confirm-del[^\n]*(?:--danger|#e53e3e)/)
})
