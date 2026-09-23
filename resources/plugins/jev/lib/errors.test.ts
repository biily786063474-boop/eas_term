import test from 'node:test'
import assert from 'node:assert/strict'
import {publicError} from './errors.mjs'
test('known errors give remediation; unknown diagnostics remain private',()=>{
 assert.match(publicError(Error('Jev authentication failed')),/安全连接设置/)
 assert.match(publicError(Error('Capability disabled')),/AI 不能自行授权/)
 assert.equal(publicError(Error('API secret: fixture')).includes('fixture'),false)
})
