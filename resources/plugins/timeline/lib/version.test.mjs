import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const manifest=JSON.parse(fs.readFileSync(new URL('../plugin.json',import.meta.url),'utf8'))
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8')
test('changed timeline plugin has a new release version and matching server identity',()=>{
 assert.equal(manifest.version,'1.0.2')
 assert.match(server,/serverInfo:\{name:'timeline',version:'1\.0\.2'\}/)
})
