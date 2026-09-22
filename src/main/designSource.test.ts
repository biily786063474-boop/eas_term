import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readDesignSource } from './designSource.ts'
const url = 'https://design.biily.top/cdn-mirror/template-kits/test/home.html'
const index = { demo: { previewUrl: url } }
test('returns actual HTML, no credentials or redirects', async () => {
 const r = await readDesignSource('demo', index, async (input, opts) => {
  assert.equal(input, url); assert.equal(opts?.redirect, 'error'); assert.equal(opts?.credentials, 'omit')
  return new Response('<!doctype html><html>source</html>', {headers:{'content-type':'text/html'}})
 })
 assert.match(r.source, /<html>source/); assert.equal(r.url,url)
})
test('unknown slug and foreign origins never fetched', async () => {
 const fail = async () => { throw Error('FETCH MUST NOT RUN') }
 await assert.rejects(readDesignSource('../x', index, fail), /未收录/)
 await assert.rejects(readDesignSource('demo', {demo:{previewUrl:'http://127.0.0.1/'}}, fail), /来源/)
})
test('refuses errors, non HTML and oversized content, without truncation', async () => {
 await assert.rejects(readDesignSource('demo',index,async()=>new Response('bad',{status:500})),/读取失败/)
 await assert.rejects(readDesignSource('demo',index,async()=>new Response('{}',{headers:{'content-type':'application/json'}})),/HTML/)
 await assert.rejects(readDesignSource('demo',index,async()=>new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'text/html'}})),/过大/)
})
import { saveDesignSource } from './designSource.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
test('source file is complete, immutable and path-authorized', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'design-source-'))
 const allow=(p: unknown)=>({ok:true as const,path:String(p)})
 try {
  const source='<!doctype html><html>whole source</html>'
  const file=saveDesignSource(dir,'demo',source,allow)
  assert.equal(fs.readFileSync(file,'utf8'),source)
  assert.equal(saveDesignSource(dir,'demo',source,allow),file)
  assert.throws(()=>saveDesignSource(dir,'demo',source,()=>({ok:false as const,error:'denied'})),/denied/)
  assert.throws(()=>saveDesignSource(dir,'../escape',source,allow),/名称/)
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
