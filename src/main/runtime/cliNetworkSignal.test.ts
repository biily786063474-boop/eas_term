import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cliNetworkSignal} from './cliNetworkSignal.ts'
test('only explicit network and rate-limit errors affect admission',()=>{
 for(const text of ['ECONNRESET','ETIMEDOUT','network error'])assert.equal(cliNetworkSignal(text),'network')
 for(const text of ['HTTP 429','rate_limit_error','429 Too Many Requests'])assert.equal(cliNetworkSignal(text),'rate-limit')
 for(const text of ['thinking for 300 seconds','tool ETIMEDOUT','MCP ECONNRESET','quota HTTP 429','authentication failed','request timeout','exit code 1',''])assert.equal(cliNetworkSignal(text),undefined)
})
