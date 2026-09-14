import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
test('plain agent restart is dispatched only from managed startup with actual close completion',()=>{
 const s=fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8')
 const block=s.slice(s.indexOf('function restartAndDeliver('),s.indexOf('function restartAndDeliverNow('))
 assert.match(block,/startManagedSession/)
 assert.match(block,/signal\.aborted/)
 assert.match(block,/sessions\.get\(live\.rec\.id\) !== live/)
 assert.match(block,/proc\.once\('close', resolve\)/)
 assert.match(s,/if \(live\.runtimeStartupId\) return/)
})
