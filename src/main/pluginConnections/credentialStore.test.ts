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
test('stored expiry is reduced by elapsed time rather than reset on every load',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-expiry-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 let now=1000
 const store=new PluginCredentialStore(dir,()=>now),lease=protection()
 store.save(scope,{access_token:'fixture',token_type:'Bearer',expires_in:60},lease)
 now+=45_000;assert.equal(store.load(scope,lease)?.expires_in,15)
 now+=20_000;assert.equal(store.load(scope,lease)?.expires_in,0)
})
test('removePlugin removes every account/config for only that plugin without decrypting',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-remove-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new PluginCredentialStore(dir),lease=protection()
 store.save(scope,{access_token:'one',token_type:'Bearer'},lease)
 store.save({...scope,account:'second-config'},{access_token:'two',token_type:'Bearer'},lease)
 store.save({...scope,plugin:'other'},{access_token:'keep',token_type:'Bearer'},lease)
 lease.dispose()
 store.removePlugin('fixture')
 assert.equal(fs.readdirSync(dir).length,1)
 assert.throws(()=>store.removePlugin('../other'))
})

test('configuration is encrypted, scope-bound, separate from OAuth and removed with its plugin',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-config-store-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new PluginCredentialStore(dir),lease=protection()
 store.save(scope,{access_token:'oauth-value',token_type:'Bearer'},lease)
 store.saveConfiguration(scope,{'api-key':'private-config-value',region:'cn'},lease)
 assert.equal(store.load(scope,lease)?.access_token,'oauth-value')
 assert.deepEqual(new PluginCredentialStore(dir).loadConfiguration(scope,lease),{'api-key':'private-config-value',region:'cn'})
 const files=fs.readdirSync(dir);assert.equal(files.length,2)
 for(const file of files){assert.doesNotMatch(fs.readFileSync(path.join(dir,file),'utf8'),/private-config-value|oauth-value/);assert.equal(fs.statSync(path.join(dir,file)).mode&0o777,0o600)}
 assert.equal(store.loadConfiguration({...scope,resource:'https://changed.example.com'},lease),undefined)
 lease.dispose();assert.throws(()=>store.loadConfiguration(scope,lease));assert.throws(()=>store.saveConfiguration(scope,{region:'us'},lease))
 store.removePlugin(scope.plugin);assert.deepEqual(fs.readdirSync(dir),[])
})
test('invalid configuration and revoked save cannot overwrite prior encrypted state',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-config-invalid-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new PluginCredentialStore(dir),lease=protection()
 store.saveConfiguration(scope,{region:'cn'},lease)
 for(const value of [null,[],{region:2},{'../path':'x'},Object.fromEntries(Array.from({length:33},(_,i)=>['f'+i,'v'])),{key:'x'.repeat(16385)}])assert.throws(()=>store.saveConfiguration(scope,value,lease))
 const late=protection(),seal=late.seal;late.seal=v=>{const cipher=seal(v);late.dispose();return cipher}
 assert.throws(()=>store.saveConfiguration(scope,{region:'changed'},late))
 assert.deepEqual(store.loadConfiguration(scope,lease),{region:'cn'})
 assert.equal(fs.readdirSync(dir).length,1)
})
test('configuration ciphertext cannot be swapped between accounts or with OAuth ciphertext',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'plugin-config-swap-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new PluginCredentialStore(dir),lease=protection(),other={...scope,account:'other'}
 store.saveConfiguration(scope,{key:'one'},lease)
 const first=fs.readdirSync(dir)[0]
 store.saveConfiguration(other,{key:'two'},lease)
 const second=fs.readdirSync(dir).find(x=>x!==first)!
 fs.copyFileSync(path.join(dir,first),path.join(dir,second))
 assert.throws(()=>store.loadConfiguration(other,lease),/配置损坏/)
 store.save(scope,{access_token:'oauth',token_type:'Bearer'},lease)
 const token=fs.readdirSync(dir).find(x=>x!==first&&x!==second)!
 fs.copyFileSync(path.join(dir,token),path.join(dir,first))
 assert.throws(()=>store.loadConfiguration(scope,lease),/配置损坏/)
 fs.copyFileSync(path.join(dir,second),path.join(dir,token))
 assert.throws(()=>store.load(scope,lease),/凭证损坏/)
})
