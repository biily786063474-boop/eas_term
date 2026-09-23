import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
test('split empty state shares Frame start choices and opens pinned CLI in split, not canvas',()=>{
 const app=fs.readFileSync('src/renderer/src/App.tsx','utf8'),start=fs.readFileSync('src/renderer/src/features/canvas/FrameStart.tsx','utf8')
 assert.ok(app.includes('<StartOptions'));assert.ok(app.includes('openAgentPane({ cli })'));assert.ok(app.includes('先创建一个终端'))
 assert.equal(app.includes('>没有打开的终端</div>'),false)
 assert.ok(start.includes('export function StartOptions'));assert.ok(start.includes('startChoices(clis'))
 assert.ok(start.includes('addAgentNode(frameId, { cli })'))
})

test('terminal escape remains available while CLI discovery is pending or empty',()=>{
 const start=fs.readFileSync('src/renderer/src/features/canvas/FrameStart.tsx','utf8')
 assert.equal(start.includes('if (!clis) return null'),false)
 assert.equal(start.includes('if (!choices.length) return null'),false)
 assert.ok(start.includes('startChoices(clis ?? []'))
})
