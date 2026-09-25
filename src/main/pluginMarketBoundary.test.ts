import * as marketSources from './pluginMarketSource.ts'
import * as permissionChangesModule from '../shared/pluginPermissionChanges.ts'
import * as catalogSourceModule from './pluginCatalogSource.ts'
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

function harness(t: {after: (fn:()=>void)=>void}, requirements?: unknown, permissions?: unknown) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'market-boundary-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const userData=path.join(root,'data'), home=path.join(root,'home'), dir=path.join(root,'sample')
  fs.mkdirSync(dir,{recursive:true})
  const raw={name:'sample',version:'1.0.0',mcp:{command:'node'},...(permissions?{permissions}:{}),...(requirements === undefined ? {}:{requirements})}
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
  let busy=false;const cleared:string[]=[]
  let confirmations=0,stops=0
  const lifecycle={assertPluginPackageIdle:()=>{if(busy)throw Error('plugin busy')},withPluginPackageMutation:async (_name:string,confirm:()=>Promise<boolean>,mutate:()=>unknown)=>{if(busy){confirmations++;if(!await confirm())throw Error('已取消');stops++;busy=false}return mutate()}}
  const authorization={invalidatePluginAuthorization:(name:string,remove:boolean)=>{if(remove)cleared.push(name)}}
  let answer=0
  const imports:Record<string,unknown>={'./pluginMarketSource.ts':marketSources,'./pluginConnections/pluginNetwork.ts':{createPluginNetwork:()=>async(url:string)=>new Response(url.endsWith('registry.json')?JSON.stringify({schema:2,plugins:[entry],unavailable:[]}):fs.readFileSync(zipPath))},'../shared/pluginPermissionChanges.ts':permissionChangesModule,'./pluginCatalogSource.ts':catalogSourceModule,'./pluginHost':lifecycle,'./pluginAuthorization':authorization,'./pluginReplace.ts':replace,'./pluginCatalog.ts':catalog,electron:{dialog:{showMessageBox:async()=>({response:answer})},BrowserWindow:{fromWebContents:()=>({isDestroyed:()=>false})},session:{defaultSession:{}},app:{getPath:()=>userData,getAppPath:()=>root,getVersion:()=> '0.4.102'},net},'node:fs':fs,'node:path':path,'node:os':{homedir:()=>home},'./ipcGuard':{guardedHandle:(name:string,fn:(...args:any[])=>any)=>handlers.set(name,fn)},'./pluginCompatibility.ts':compatibility,'./pluginManifest.ts':manifest,'./pluginRegistry.ts':registry,'./pluginInstall.ts':install,'./pluginUnzip.ts':unzip,'./pluginInstallGate.ts':gate}
  const source=fs.readFileSync(new URL('./pluginMarket.ts',import.meta.url),'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  const exports:Record<string,any>={}
  vm.runInNewContext(output,{exports,require:(id:string)=>{if(!(id in imports))throw Error('Unexpected import '+id);return imports[id]},process:{platform:'darwin',arch:'arm64',env:{}},Buffer,URL,AbortController,Error,console,setTimeout,clearTimeout})
  exports.registerPluginMarketHandlers()
  const sender={mainFrame:{}}
  return {entry,root,home,userData,requests,cleared,setBusy:(value:boolean)=>{busy=value},setAnswer:(value:number)=>{answer=value},counts:()=>({confirmations,stops}),call:(channel:string,arg?:unknown)=>handlers.get(channel)!({sender,senderFrame:sender.mainFrame},arg)}
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
  const result=await h.call('plugins:installCommit',staged.token)
  assert.equal(result.ok,false)
  assert.equal(fs.readFileSync(path.join(target,'old.txt'),'utf8'),'keep')
  assert.equal(fs.readdirSync(staging).length,0)
})

test('legacy package still stages and installs with a one-use token',async t=>{
  const h=harness(t)
  const staged=await h.call('plugins:install','sample')
  assert.equal(staged.ok,true,staged.error)
  assert.equal((await h.call('plugins:installCommit',staged.token)).ok,true)
  assert.equal((await h.call('plugins:installCommit',staged.token)).ok,false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.home,'.eas','plugins','sample','plugin.json'),'utf8')).name,'sample')
})

test('commit refuses a changed command after user confirmation was staged',async t=>{
 const h=harness(t),staged=await h.call('plugins:install','sample')
 assert.equal(staged.ok,true)
 const staging=path.join(h.userData,'plugin-staging'),file=path.join(staging,fs.readdirSync(staging)[0],'sample','plugin.json')
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.mcp.command='unexpected-command';fs.writeFileSync(file,JSON.stringify(raw))
 assert.equal((await h.call('plugins:installCommit',staged.token)).ok,false)
 assert.equal(fs.existsSync(path.join(h.home,'.eas','plugins','sample')),false)
})


test('active plugin asks before update/uninstall and closes only after approval',async t=>{
 const h=harness(t),target=path.join(h.home,'.eas','plugins','sample')
 fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'old.txt'),'keep')
 const staged=await h.call('plugins:install','sample');assert.equal(staged.ok,true)
 h.setBusy(true)
 assert.equal((await h.call('plugins:installCommit',staged.token)).ok,false)
 assert.equal((await h.call('plugins:uninstall','sample')).ok,false)
 assert.equal(fs.readFileSync(path.join(target,'old.txt'),'utf8'),'keep');assert.deepEqual(h.cleared,[])
 assert.deepEqual(h.counts(),{confirmations:2,stops:0})
 h.setAnswer(1)
 const retry=await h.call('plugins:install','sample');assert.equal(retry.ok,true)
 assert.equal((await h.call('plugins:installCommit',retry.token)).ok,true)
 assert.deepEqual(h.counts(),{confirmations:3,stops:1})
 h.setBusy(true);assert.equal((await h.call('plugins:uninstall','sample')).ok,true)
 assert.equal(fs.existsSync(target),false);assert.deepEqual(h.cleared,['sample'])
})

test('catalog version cannot mislabel a differently versioned archive',async t=>{
 const h=harness(t);h.entry.version='1.1.0'
 const result=await h.call('plugins:install','sample')
 assert.equal(result.ok,false)
 assert.match(result.error,/版本/)
 assert.equal(fs.existsSync(path.join(h.home,'.eas','plugins','sample')),false)
 assert.equal(fs.readdirSync(path.join(h.userData,'plugin-staging')).length,0)
})

test('actual registry IPC requests default v2 endpoint',async t=>{
 const h=harness(t)
 const result=await h.call('plugins:registry')
 assert.equal(result.ok,true)
 assert.equal(h.requests[0],catalogSourceModule.DEFAULT_PLUGIN_CATALOG_URL)
 assert.equal(fs.existsSync(path.join(h.userData,catalogSourceModule.catalogSource().cacheFile)),true)
})

test('staged update compares validated installed manifest permissions',async t=>{
 const h=harness(t),dir=path.join(h.home,'.eas/plugins/sample')
 fs.mkdirSync(dir,{recursive:true})
 fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name:'sample',version:'0.9.0',mcp:{command:'node'},permissions:{canvas:['canvas_open_file']}}))
 const result=await h.call('plugins:install','sample')
 assert.equal(result.ok,true)
 assert.deepEqual(JSON.parse(JSON.stringify(result.permissionChanges)),{added:[],removed:['canvas_open_file']})
})
test('unreadable old manifest is unknown, never a no-change claim',async t=>{
 const h=harness(t),dir=path.join(h.home,'.eas/plugins/sample')
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.json'),'invalid JSON')
 const result=await h.call('plugins:install','sample')
 assert.equal(result.ok,true);assert.equal(result.permissionChanges,null)
})

 test('event access is disclosed as an added update permission without enabling recording',async t=>{
 const h=harness(t,undefined,{canvas:[],events:['agent.turn.completed']})
 const dir=path.join(h.home,'.eas/plugins/sample');fs.mkdirSync(dir,{recursive:true})
 fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name:'sample',mcp:{command:'node'}}))
 const staged=await h.call('plugins:install','sample')
 assert.equal(staged.ok,true,staged.error)
 assert.ok(staged.permissions.includes('订阅事件：agent.turn.completed（仍需单独授权）'))
 assert.ok(staged.permissionChanges.added.includes('订阅事件：agent.turn.completed（仍需单独授权）'))
 assert.equal(fs.existsSync(path.join(h.userData,'plugin-event-grants.json')),false)
})

test('external source installation pins provenance and cannot cross-update from official source',async t=>{
 const h=harness(t)
 const added=await h.call('plugins:sources',{action:'add',name:'社区',url:'https://eas.biily.top/community/registry.json'})
 assert.equal(added.ok,true,added.error)
 const source=added.sources[0]
 const staged=await h.call('plugins:install',{name:'sample',sourceId:source.id})
 assert.equal(staged.ok,true,staged.error)
 assert.equal((await h.call('plugins:installCommit',staged.token)).ok,true)
 const foreign=await h.call('plugins:install','sample')
 assert.equal(foreign.ok,false);assert.match(foreign.error,/来源/)
 const again=await h.call('plugins:install',{name:'sample',sourceId:source.id});assert.equal(again.ok,true,again.error)
 await h.call('plugins:sources',{action:'remove',id:source.id})
 const expired=await h.call('plugins:installCommit',again.token);assert.equal(expired.ok,false);assert.match(expired.error,/来源/)
 assert.equal(JSON.parse(fs.readFileSync(path.join(h.home,'.eas/plugins/sample/plugin.json'),'utf8')).version,'1.0.0')
})

test('unknown installed provenance cannot be adopted by an external source',async t=>{
 const h=harness(t),dir=path.join(h.home,'.eas/plugins/sample');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.json'),'{}')
 const added=await h.call('plugins:sources',{action:'add',name:'社区',url:'https://eas.biily.top/community/registry.json'})
 const r=await h.call('plugins:install',{name:'sample',sourceId:added.sources[0].id});assert.equal(r.ok,false);assert.match(r.error,/来源未知/)
})
test('external source cannot shadow a bundled plugin with the same name',async t=>{
 const h=harness(t),dir=path.join(h.root,'resources/plugins/sample');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.json'),'{}')
 const added=await h.call('plugins:sources',{action:'add',name:'社区',url:'https://eas.biily.top/community/registry.json'})
 const r=await h.call('plugins:install',{name:'sample',sourceId:added.sources[0].id});assert.equal(r.ok,false);assert.match(r.error,/内置/)
})
