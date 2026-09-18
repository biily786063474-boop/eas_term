import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {PluginCredentialStore} from './credentialStore.ts'
const scope={plugin:'fixture',issuer:'https://auth.example.com',resource:'https://mcp.example.com',account:'test-account'}
function protection(){
 const key=crypto.randomBytes(32);let active=true
 return {signal:new AbortController().signal,dispose:()=>{active=false},assertActive:()=>{if(!active)throw Error('locked')},seal:(v:string)=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([c.update(v),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64')},open:(v:string)=>{const b=Buffer.from(v,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString()}}
}
test('encrypted scoped credentials survive reload but cannot be swapped or used after lock',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-credentials-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new PluginCredentialStore(dir),lease=protection()
 store.save(scope,{access_token:'fixture-sensitive-token',token_type:'Bearer'},lease)
 const files=fs.readdirSync(dir);assert.equal(files.length,1)
 const file=path.join(dir,files[0]);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fixture-sensitive-token/)
 assert.equal(fs.statSync(file).mode&0o777,0o600)
 assert.equal(new PluginCredentialStore(dir).load(scope,lease)?.access_token,'fixture-sensitive-token')
 const other={...scope,account:'other-account'}
 store.save(other,{access_token:'another-fixture',token_type:'Bearer'},lease)
 const otherFile=fs.readdirSync(dir).find(x=>x!==files[0])!
 fs.copyFileSync(file,path.join(dir,otherFile))
 assert.throws(()=>store.load(other,lease))
 lease.dispose();assert.throws(()=>store.load(scope,lease));assert.throws(()=>store.save(scope,{access_token:'late',token_type:'Bearer'},lease))
 store.remove(scope);assert.equal(fs.existsSync(file),false)
})
test('corrupt or symlink credential files fail closed without overwriting',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-credentials-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new PluginCredentialStore(dir),lease=protection()
 store.save(scope,{access_token:'fixture',token_type:'Bearer'},lease)
 const file=path.join(dir,fs.readdirSync(dir)[0]);fs.writeFileSync(file,'broken')
 assert.throws(()=>store.load(scope,lease))
 fs.unlinkSync(file);const target=path.join(dir,'untouched');fs.writeFileSync(target,'keep');fs.symlinkSync(target,file)
 assert.throws(()=>store.save(scope,{access_token:'fixture',token_type:'Bearer'},lease))
 assert.equal(fs.readFileSync(target,'utf8'),'keep')
})
