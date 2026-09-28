import {test} from 'node:test'
import assert from 'node:assert/strict'
import {agentNodeSize} from './agentNodeSize.ts'
test('new chat grows height another 20 percent without changing width',()=>{
 assert.deepEqual(agentNodeSize(1440,900,1),{w:768,h:547})
})
test('small viewport reserves frame chrome and screen margins',()=>{
 assert.deepEqual(agentNodeSize(700,500,1),{w:636,h:368})
})
test('viewport cap uses world coordinates at canvas zoom',()=>{
 assert.deepEqual(agentNodeSize(1000,700,2),{w:452,h:234})
 assert.deepEqual(agentNodeSize(700,500,.5),{w:768,h:547})
})
test('invalid or unavailable dimensions use safe defaults',()=>{
 assert.deepEqual(agentNodeSize(0,NaN,0),{w:768,h:547})
})

test('mounting a stored pane does not overwrite its geometry',async()=>{
 const {readFileSync}=await import('node:fs')
 const source=readFileSync(new URL('../../features/workspace/PaneView.tsx',import.meta.url),'utf8')
 assert.ok(!source.includes('canvasRect.w < AGENT_CHAT_MIN_WIDTH'))
})
