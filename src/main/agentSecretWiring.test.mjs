import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
test('agent launch wires session credentials and shared shim', () => {
 const s=read('./agentChat/session.ts')
 assert.ok(s.includes('withAgentSecrets(live.rec.id,'))
 assert.ok(s.includes('forgetPty(live.rec.id)'))
})
test('secret check and approval use agent identity',()=>{
 const s=read('../renderer/src/mcpHandler.ts')
 assert.ok(s.includes('ctx.agentSessionId ?? ctx.ptyId'))
 assert.ok(s.includes('hasCredential'))
})
