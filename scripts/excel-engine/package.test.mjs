import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {sealEnginePackage} from './package.mjs'
test('seals all three binaries with fixed names, notices and worker',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excel-seal-'))
 try{
  const bin=path.join(root,'bin');fs.mkdirSync(bin)
  const names=['darwin-arm64','darwin-x64','win32-x64']
  for(const key of names)fs.writeFileSync(path.join(bin,'excel-engine-'+key+(key.startsWith('win32')?'.exe':'')),key)
  sealEnginePackage(root,'dependency license notice')
  const manifest=JSON.parse(fs.readFileSync(path.join(bin,'integrity.json')))
  for(const key of names)assert.deepEqual(manifest[key],{size:Buffer.byteLength(key),sha256:createHash('sha256').update(key).digest('hex')})
  assert.match(fs.readFileSync(path.join(root,'lib/worker.mjs'),'utf8'),/export async function runEngine/)
  assert.equal(fs.readFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),'utf8'),'dependency license notice')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'plugin.json'))).version,'1.1.0')
  assert.match(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),/createConnector/)
  assert.match(fs.readFileSync(path.join(root,'lib/files.mjs'),'utf8'),/O_NOFOLLOW/)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('missing binaries or blank notices cannot produce integrity manifest',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'excel-seal-'))
 try{fs.mkdirSync(path.join(root,'bin'));assert.throws(()=>sealEnginePackage(root,'license'));assert.throws(()=>sealEnginePackage(root,''));assert.equal(fs.existsSync(path.join(root,'bin/integrity.json')),false)}finally{fs.rmSync(root,{recursive:true,force:true})}
})
