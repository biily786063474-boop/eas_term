// Run the actual IPC handlers with isolated filesystem and deterministic network responses.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import ts from 'typescript'
import * as replace from './pluginReplace.ts'
import * as compatibility from './pluginCompatibility.ts'
import * as manifest from './pluginManifest.ts'
import * as catalog from './pluginCatalog.ts'
import * as registry from './pluginRegistry.ts'
import * as install from './pluginInstall.ts'
import * as unzip from './pluginUnzip.ts'
import * as gate from './pluginInstallGate.ts'
// @ts-expect-error packaging script has no declaration
import {packPlugin} from '../../scripts/pack-plugin.mjs'

function harness(t: {after: (fn:()=>void)=>void}, requirements?: unknown) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'market-boundary-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const userData=path.join(root,'data'), home=path.join(root,'home'), dir=path.join(root,'sample')
  fs.mkdirSync(dir,{recursive:true})
  const raw={name:'sample',version:'1.0.0',mcp:{command:'node'},...(requirements === undefined ? {}:{requirements})}
  fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify(raw))
  const {entry,zipPath}=packPlugin(dir,{outRoot:path.join(root,'out'),registrySchema:2})
  const handlers=new Map<string, (...args:any[])=>any>()
  const requests:string[]=[]
  const net={request:({url}:{url:string})=>{
    requests.push(url)
    const req=new EventEmitter() as EventEmitter & {end:()=>void;abort:()=>void}
    req.abort=()=>{}
    req.end=()=>queueMicrotask(()=>{
      const response=Object.assign(new EventEmitter(),{statusCode:200})
      req.emit('response',response)
      response.emit('data',url.endsWith('registry.json')? Buffer.from(JSON.stringify({schema:1,plugins:[entry]})):fs.readFileSync(zipPath))
      response.emit('end')
    })
    return req
  }}
  const imports:Record<string,unknown>={'./pluginReplace.ts':replace,'./pluginCatalog.ts':catalog,electron:{app:{getPath:()=>userData,getVersion:()=> '0.4.102'},net},'node:fs':fs,'node:path':path,'node:os':{homedir:()=>home},'./ipcGuard':{guardedHandle:(name:string,fn:(...args:any[])=>any)=>handlers.set(name,fn)},'./pluginCompatibility.ts':compatibility,'./pluginManifest.ts':manifest,'./pluginRegistry.ts':registry,'./pluginInstall.ts':install,'./pluginUnzip.ts':unzip,'./pluginInstallGate.ts':gate}
  const source=fs.readFileSync(new URL('./pluginMarket.ts',import.meta.url),'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  const exports:Record<string,any>={}
  vm.runInNewContext(output,{exports,require:(id:string)=>{if(!(id in imports))throw Error('Unexpected import '+id);return imports[id]},process:{platform:'darwin',arch:'arm64',env:{}},Buffer,URL,console,setTimeout,clearTimeout})
  exports.registerPluginMarketHandlers()
  return {root,home,userData,requests,call:(channel:string,arg?:unknown)=>handlers.get(channel)!({},arg)}
}

test('incompatible host rejects before downloading an archive or creating installation',async t=>{
  const h=harness(t,{capabilities:['mcp.remote']})
  const result=await h.call('plugins:install','sample')
  assert.equal(result.ok,false)
  assert.match(result.error,/mcp.remote/)
  assert.equal(h.requests.length,1)
  assert.equal(fs.existsSync(path.join(h.home,'.eas','plugins','sample')),false)
})

test('commit revalidates staged package and leaves existing install untouched',async t=>{
  const h=harness(t)
  const staged=await h.call('plugins:install','sample')
  assert.equal(staged.ok,true,staged.error)
  const target=path.join(h.home,'.eas','plugins','sample')
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'old.txt'),'keep')
  const staging=path.join(h.userData,'plugin-staging')
  const packageFile=path.join(staging,fs.readdirSync(staging)[0],'sample','plugin.json')
  const raw=JSON.parse(fs.readFileSync(packageFile,'utf8'));raw.requirements={capabilities:['mcp.remote']}
  fs.writeFileSync(packageFile,JSON.stringify(raw))
  const result=h.call('plugins:installCommit',staged.token)
  assert.equal(result.ok,false)
  assert.equal(fs.readFileSync(path.join(target,'old.txt'),'utf8'),'keep')
  assert.equal(fs.readdirSync(staging).length,0)
})

test('legacy package still stages and installs with a one-use token',async t=>{
  const h=harness(t)
  const staged=await h.call('plugins:install','sample')
  assert.equal(staged.ok,true,staged.error)
  assert.equal(h.call('plugins:installCommit',staged.token).ok,true)
  assert.equal(h.call('plugins:installCommit',staged.token).ok,false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.home,'.eas','plugins','sample','plugin.json'),'utf8')).name,'sample')
})

test('commit refuses a changed command after user confirmation was staged',async t=>{
 const h=harness(t),staged=await h.call('plugins:install','sample')
 assert.equal(staged.ok,true)
 const staging=path.join(h.userData,'plugin-staging'),file=path.join(staging,fs.readdirSync(staging)[0],'sample','plugin.json')
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.mcp.command='unexpected-command';fs.writeFileSync(file,JSON.stringify(raw))
 assert.equal(h.call('plugins:installCommit',staged.token).ok,false)
 assert.equal(fs.existsSync(path.join(h.home,'.eas','plugins','sample')),false)
})
