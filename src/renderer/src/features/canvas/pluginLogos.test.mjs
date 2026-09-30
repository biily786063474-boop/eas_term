import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const src=fs.readFileSync(new URL('./pluginLogos.tsx',import.meta.url),'utf8')
const m=src.match(/export function logoKeyFor\(name: string\): string \| null \{([\s\S]*?)\n\}\n/)
assert.ok(m,'logoKeyFor found')
const logoKeyFor=new Function('name',m[1].replace(/: string\[\]/g,'').replace(/: boolean/g,''))
const LOGOS=src.match(/const LOGOS[^=]*=\s*\{([\s\S]*?)\n\}\n/)[1]
test('sentry and wikipedia map to official logos',()=>{
 assert.equal(logoKeyFor('sentry'),'sentry')
 assert.equal(logoKeyFor('wikipedia'),'wikipedia')
 assert.equal(logoKeyFor('维基百科'),'wikipedia')
 assert.match(LOGOS,/\n  sentry:/)
 assert.match(LOGOS,/\n  wikipedia:/)
 assert.equal(/<script|\son\w+=/i.test(LOGOS),false)
})
test('brand plugins use official logos (no composerIcon); own plugins keep generated icons',()=>{
 const read=(n)=>JSON.parse(fs.readFileSync(new URL(`../../../../../plugins-store/${n}/plugin.json`,import.meta.url),'utf8'))
 for(const n of ['excel','word','powerpoint','amap','github','notion','sentry','wikipedia'])
  assert.equal(read(n).composerIcon,undefined,n)
 for(const n of ['local-files','web-fetch','weather'])
  assert.ok(read(n).composerIcon,n)
})
