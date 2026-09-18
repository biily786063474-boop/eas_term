import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import http from 'node:http'
import crypto from 'node:crypto'
import ts from 'typescript'
import {McpClient} from './mcpClient.ts'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {RemotePluginClient} from './pluginConnections/remoteClient.ts'
import {CredentialLeases} from './pluginConnections/credentialLease.ts'
import {createAuthenticatedFetch} from './pluginConnections/authenticatedFetch.ts'
import {HostRegistry} from './hostRegistry.ts'
import {createToolActivity} from './runtime/toolActivity.ts'

for(const oauth of [false,true])test('actual host shim gateway shares one remote connection across Claude/Codex/OMP identities; oauth='+oauth,async t=>{
 let initialized=0,calls=0
 const server=http.createServer(async(req,res)=>{
  if(oauth)assert.equal(req.headers.authorization,'Bearer fixture-token')
  if(req.method!=='POST'){res.writeHead(405);res.end();return}
  let text='';for await(const chunk of req)text+=chunk
  const rpc=JSON.parse(text)
  if(rpc.id===undefined){res.writeHead(202);res.end();return}
  let result:unknown
  if(rpc.method==='initialize'){initialized++;result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}}
  else if(rpc.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]}
  else {calls++;result={content:[{type:'text',text:'fixture-response'}]}}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}))
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const port=(server.address() as {port:number}).port
 const source=ts.createSourceFile('pluginHost.ts',readFileSync(new URL('./pluginHost.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const pick=(name:string)=>{const node=source.statements.find(n=>(ts.isFunctionDeclaration(n)&&n.name?.text===name)||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name)));assert.ok(node);return node.getText(source)}
 const code=ts.transpileModule(['PLUGIN_START_COST','startingPlugins','spawnHosted','acquire','pluginRpcFromShim'].map(pick).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const info={name:'fixture',displayName:'Fixture',cli:'eas',remote:{url:'https://mcp.example.com/mcp',approvedOrigins:['https://mcp.example.com'],auth:oauth?'oauth':'none'}}
 const leases=new CredentialLeases(()=>true)
 const authorized=createAuthenticatedFetch({url:info.remote.url,lease:leases.acquire(),load:()=>({access_token:'fixture-token',token_type:'Bearer'}),refresh:async()=>{throw Error('not expired')},fetch:async(_url,init)=>fetch('http://127.0.0.1:'+port+'/mcp',init)})
 t.after(()=>authorized.close())
 const registry=new HostRegistry<any>({graceMs:1,setTimer:()=>0,clearTimer:()=>{},onIdle:()=>{}})
 t.after(async()=>{await registry.get('fixture')?.client.close()})
 const exports:Record<string,any>={}
 runInNewContext(code,{exports,getPluginAuthorization:()=>({connect:()=>authorized}),RemotePluginClient,McpClient:class {constructor(){throw Error('remote must not spawn stdio')}},app:{getVersion:()=> 'test'},session:{defaultSession:{}},createPluginNetwork:()=>async(_url:unknown,init:RequestInit)=>fetch('http://127.0.0.1:'+port+'/mcp',init),registry,panels:new Map(),shims:new Map(),manualStops:{stamp:()=>null},findPlugin:()=>info,toolActivity:createToolActivity(()=>performance.now()),startManagedSession:async(options:any)=>{await options.start(new AbortController().signal)},broadcastToolResult:()=>{},performance,crypto,console,Promise,Map,Error,JSONRPC_INVALID_PARAMS:-32602,JSONRPC_METHOD_NOT_FOUND:-32601})
 for(const shimId of ['claude-fixture','codex-fixture','omp-fixture']){
  const call=(method:string,params={})=>exports.pluginRpcFromShim({plugin:'fixture',shimId,method,params})
  assert.equal((await call('initialize')).ok,true)
  assert.equal((await call('tools/list')).result.tools[0].name,'echo')
  assert.equal((await call('tools/call',{name:'echo',arguments:{}})).result.content[0].text,'fixture-response')
 }
 assert.equal(initialized,1);assert.equal(calls,3)
 const token=crypto.randomBytes(32).toString('hex')
 const gateway=http.createServer(async(req,res)=>{
  if(req.headers['x-eas-token']!==token){res.writeHead(403);res.end();return}
  let raw='';for await(const chunk of req)raw+=chunk
  res.setHeader('content-type','application/json')
  res.end(JSON.stringify(req.url==='/plugin/rpc'?await exports.pluginRpcFromShim(JSON.parse(raw)):{ok:true}))
 })
 await new Promise<void>(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>{gateway.closeAllConnections();gateway.close()})
 const shimPath=fileURLToPath(new URL('../../mcp/eas-plugin-shim.mjs',import.meta.url))
 for(const label of ['claude','codex','omp']){
  const shim=new McpClient({name:label+'-shim-fixture',command:process.execPath,args:[shimPath],cwd:path.dirname(shimPath),env:{EAS_PLUGIN:'fixture',EAS_TERM_PORT:String((gateway.address() as {port:number}).port),EAS_TERM_TOKEN:token,EAS_PROJECT:'/discardable-fixture'}})
  try{
   await shim.initialize('test')
   assert.equal((await shim.listTools())[0].name,'echo')
   const result=await shim.request('tools/call',{name:'echo',arguments:{}}) as {content:{text:string}[]}
   assert.equal(result.content[0].text,'fixture-response')
  }finally{shim.close();await shim.exited}
 }
 assert.equal(initialized,1);assert.equal(calls,6)
 if(oauth){const client=registry.get('fixture')!.client;leases.invalidate();await client.connectionClosed;assert.equal(client.alive,false)}
})
