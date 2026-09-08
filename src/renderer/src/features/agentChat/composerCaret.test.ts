import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const css=readFileSync(new URL('./agentChat.css',import.meta.url),'utf8')
test('绘制光标有独立的主题颜色与 2px 宽度，不依赖 CodeMirror 默认黑色',()=>{
 assert.match(css,/--ac-caret:\s*#f5f5f5/)
 assert.match(css,/\[data-theme=['"]light['"]\][^{]*\.ac-rich-input\s*\{[^}]*--ac-caret:\s*#171719/)
 assert.match(css,/\.ac-rich-input \.cm-editor \.cm-cursor[^}]*border-left:\s*2px solid var\(--ac-caret\)/)
})
