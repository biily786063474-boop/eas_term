import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import * as publisher from '../../scripts/plugin-publish.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-publish-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const source=path.join(root,'source'),remote=path.join(root,'remote');fs.mkdirSync(source);fs.mkdirSync(remote)
 const baseUrl='https://eas.biily.top/plugins';const bytes=Buffer.from('controlled archive bytes')
 const entry={name:'demo',version:'1.0.0',displayName:'Demo',url:baseUrl+'/demo/demo-1.0.0.zip',sha256:hash(bytes),size:bytes.length}
 fs.mkdirSync(path.join(source,'demo'));fs.writeFileSync(path.join(source,'demo/demo-1.0.0.zip'),bytes)
 const write=()=>{fs.writeFileSync(path.join(source,'registry.json'),JSON.stringify({schema:1,plugins:[entry]}));fs.writeFileSync(path.join(source,'registry-v2.json'),JSON.stringify({schema:2,plugins:[entry],unavailable:[]}))};write()
 fs.writeFileSync(path.join(remote,'registry.json'),'old v1');fs.writeFileSync(path.join(remote,'registry-v2.json'),'old v2')
 let uploads=0;let corrupt=false;let restricted=false;let failLegacy=false
 // Only substitute the remote process boundary. Run the actual generated POSIX
 // commands against a temporary filesystem, including links, locks and renames.
 const run=(command,args)=>{
  if(command==='ssh'){assert.equal(args[0],'-n');assert.equal(args.at(-2),'fixture');if(failLegacy&&args.at(-1).includes('mv -f')&&args.at(-1).endsWith("/registry.json'"))throw Error('injected legacy promotion failure');return execFileSync('/bin/sh',['-c',args.at(-1)],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}
  assert.equal(command,'scp');assert.equal(args[0],'-q');const dest=args.at(-1);assert.ok(dest.startsWith('fixture:'))
  const target=dest.slice('fixture:'.length);fs.copyFileSync(args.at(-2),target);if(restricted)fs.chmodSync(target,0o600);uploads++
  if(corrupt&&target.endsWith('registry-v2.json'))fs.appendFileSync(target,'corrupt')
  return ''
 }
 const publish=()=>publisher.publishPluginRegistries({source,baseUrl,transport:new publisher.SshPluginPublisher({host:'fixture',root:remote,run})})
 return {root,source,remote,entry,write,publish,setRestricted:()=>{restricted=true},failLegacy:()=>{failLegacy=true},setCorrupt:()=>{corrupt=true},uploads:()=>uploads}
}
test('publishes verified packages before two catalogs, preserves old catalogs, and safely repeats',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);await f.publish()
 for(const name of ['registry.json','registry-v2.json','demo/demo-1.0.0.zip'])assert.deepEqual(fs.readFileSync(path.join(f.remote,name)),fs.readFileSync(path.join(f.source,name)))
 const release=fs.readdirSync(f.remote).find(x=>x.startsWith('.release-'))
 assert.equal(fs.readFileSync(path.join(f.remote,release,'previous-registry.json'),'utf8'),'old v1')
 assert.equal(fs.readFileSync(path.join(f.remote,release,'previous-registry-v2.json'),'utf8'),'old v2')
 await f.publish();assert.equal(fs.existsSync(path.join(f.remote,'.publish-lock')),false)
})
test('remote same-version conflict rejects before uploads and does not delete the previous package',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.remote,'demo'));fs.writeFileSync(path.join(f.remote,'demo/demo-1.0.0.zip'),'old bytes')
 await assert.rejects(f.publish(),/immutable|版本/);assert.equal(f.uploads(),0)
 assert.equal(fs.readFileSync(path.join(f.remote,'demo/demo-1.0.0.zip'),'utf8'),'old bytes')
 assert.equal(fs.readFileSync(path.join(f.remote,'registry.json'),'utf8'),'old v1')
})
test('corrupt upload leaves both live catalogs unchanged and releases its own lock',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);f.setCorrupt();await assert.rejects(f.publish(),/integrity|校验/)
 assert.equal(fs.readFileSync(path.join(f.remote,'registry.json'),'utf8'),'old v1')
 assert.equal(fs.readFileSync(path.join(f.remote,'registry-v2.json'),'utf8'),'old v2')
 assert.equal(fs.existsSync(path.join(f.remote,'.publish-lock')),false)
})
test('another publisher lock is never removed or bypassed',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.remote,'.publish-lock'))
 await assert.rejects(f.publish());assert.equal(f.uploads(),0);assert.equal(fs.existsSync(path.join(f.remote,'.publish-lock')),true)
})
test('local tampering, URL traversal and legacy capability leakage fail before transport',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t)
 fs.appendFileSync(path.join(f.source,'demo/demo-1.0.0.zip'),'changed')
 await assert.rejects(f.publish(),/integrity|校验/);assert.equal(f.uploads(),0)
 f.entry.url='https://eas.biily.top/plugins/demo/../escape.zip';f.write()
 await assert.rejects(f.publish(),/URL|路径/);assert.equal(f.uploads(),0)
 f.entry.url='https://eas.biily.top/plugins/demo/demo-1.0.0.zip';f.entry.requirements={capabilities:['mcp.remote']};f.write()
 await assert.rejects(f.publish(),/legacy|旧目录/)
})
test('publish CLI requires explicit approval flag without contacting transport',()=>{
 assert.throws(()=>execFileSync(process.execPath,['scripts/publish-plugins.mjs'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),error=>error.status===2&&error.stderr.includes('No connection or upload was made'))
})

test('private upload modes are made readable before promotion',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);f.setRestricted();await f.publish()
 for(const rel of ['demo/demo-1.0.0.zip','registry.json','registry-v2.json'])assert.equal(fs.statSync(path.join(f.remote,rel)).mode&0o777,0o644)
})
test('late second catalog failure leaves two individually valid generations, not missing package references',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);f.failLegacy();await assert.rejects(f.publish(),/injected legacy/)
 assert.equal(fs.readFileSync(path.join(f.remote,'registry.json'),'utf8'),'old v1')
 assert.deepEqual(fs.readFileSync(path.join(f.remote,'registry-v2.json')),fs.readFileSync(path.join(f.source,'registry-v2.json')))
 assert.deepEqual(fs.readFileSync(path.join(f.remote,'demo/demo-1.0.0.zip')),fs.readFileSync(path.join(f.source,'demo/demo-1.0.0.zip')))
 assert.equal(fs.existsSync(path.join(f.remote,'.publish-lock')),false)
})
