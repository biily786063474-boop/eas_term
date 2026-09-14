import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync(new URL('./pluginHost.ts',import.meta.url),'utf8')
test('panel and shim tools/call both enter tracked MCP lifecycle, control plane remains independent',()=>{
 assert.equal((source.match(/requestTracked\('tools\/call'/g)||[]).length,2)
 assert.equal((source.match(/\.request\('tools\/call'/g)||[]).length,0)
 assert.ok(source.includes('h.client.request(args.method'))
})
