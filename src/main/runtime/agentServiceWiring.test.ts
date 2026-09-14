import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
test('plain agent process registration uses actual completion and generation-local cancellation',()=>{
 const s=fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8')
 const wire=s.slice(s.indexOf('function wireProc('),s.indexOf('function restartAndDeliver('))
 assert.match(wire,/ownedSessions\.add\(/)
 assert.match(wire,/proc\.once\('close', resolve\)/)
 assert.match(wire,/if \(isCurrent\(\)\) live\.killing = true/)
 assert.match(wire,/stopAgentProcess\(proc\)/)
})
