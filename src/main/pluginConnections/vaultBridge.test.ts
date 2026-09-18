import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
import {CredentialLeases} from './credentialLease.ts'

test('real secrets handlers invalidate plugin leases without exposing terminal secrets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-vault-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 let ready=true,available=true
 const handlers=new Map<string,(...args:any[])=>any>()
 const mocks:Record<string,unknown>={
  './ipcGuard':{guardedHandle:(name:string,fn:(...args:any[])=>any)=>handlers.set(name,fn)},
  electron:{app:{isReady:()=>ready,getPath:()=>dir,getName:()=> 'Isolated Test'},safeStorage:{isEncryptionAvailable:()=>available,getSelectedStorageBackend:()=>"gnome_libsecret",encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString()},BrowserWindow:{getAllWindows:()=>[]}},
  crypto,fs,path,'./island':{},'../shared/envParse':{},'./pluginConnections/credentialLease.ts':{CredentialLeases}
 }
 const source=fs.readFileSync(new URL('../secrets.ts',import.meta.url),'utf8')
 const exports:Record<string,any>={}
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(id:string)=>{if(!(id in mocks))throw Error(id);return mocks[id]},Buffer,process:{platform:process.platform},console,setTimeout:(fn:()=>void,ms:number)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},clearTimeout})
 exports.registerSecretHandlers()
 const call=(name:string,arg?:unknown)=>handlers.get('secrets:'+name)!({},arg)
 assert.throws(()=>exports.acquirePluginCredentialAccess())
 assert.equal(call('setup','123456').ok,true)
 const lease=exports.acquirePluginCredentialAccess()
 const cipher=lease.seal('fixture-plugin-token');assert.equal(lease.open(cipher),'fixture-plugin-token')
 call('lock');assert.equal(lease.signal.aborted,true)
 assert.equal(call('unlock','123456').ok,true)
 assert.throws(()=>lease.open(cipher))
 const current=exports.acquirePluginCredentialAccess();assert.equal(current.open(cipher),'fixture-plugin-token')
 available=false;assert.throws(()=>current.seal('no-plaintext-fallback'))
 available=true;ready=false;assert.throws(()=>exports.acquirePluginCredentialAccess())
 current.dispose()
})
