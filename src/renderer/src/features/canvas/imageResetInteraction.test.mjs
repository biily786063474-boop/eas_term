import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync(new URL('./CanvasImageViewer.tsx',import.meta.url),'utf8')
test('image scale reset is excluded from drag pointer capture',()=>{
 const guard=source.slice(source.indexOf('const onPointerDown ='),source.indexOf('const onPointerMove ='))
 assert.match(guard,/closest\('button, \.civ-zoom'\)/)
 assert.ok(guard.indexOf('.civ-zoom')<guard.indexOf('setPointerCapture'))
})
test('scale reset explains single click and stops double click image zoom',()=>{
 const control=source.split('\n').find(line=>line.includes('className="civ-zoom"'))
 assert.match(control,/data-tip="点击复位"/)
 assert.match(control,/onClick=\{reset\}/)
 assert.match(control,/onDoubleClick=\{\(e\) => e\.stopPropagation\(\)\}/)
})
