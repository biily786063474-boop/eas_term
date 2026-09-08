import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { CapabilitySessions, type CapabilityLease } from './capabilitySessions.ts'
import { capabilityInvocationCwd } from './capabilityPtyCommand.ts'

const source = ts.createSourceFile('mcpBridge.ts', fs.readFileSync(new URL('./mcpBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
let route: ts.IfStatement | undefined
function visit(n: ts.Node) {
  if (ts.isIfStatement(n) && n.expression.getText(source).includes("req.url === '/capability/launch/close'" ) && n.expression.getText(source).includes('req.method')) route = n
  ts.forEachChild(n, visit)
}
visit(source)
assert.ok(route)
const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && ['capabilityPtyEnv','revokeCapabilitySession'].includes(n.name?.text ?? '')).map(n => n.getText(source).replace(/^export /, '')).join('\n')
const code = ts.transpileModule(declarations + '\nasync function handle(req,res){const send=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body))};try{' + route.getText(source) + '}catch{send(500,{ok:false})}}', { compilerOptions: {target:ts.ScriptTarget.ES2022} }).outputText
const ptySource=ts.createSourceFile('pty.ts',fs.readFileSync(new URL('./pty.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
let exitCallback: ts.Node | undefined
function findExit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(ptySource)==='proc.onExit'&&n.arguments[0]?.getText(ptySource).includes('revokeCapabilitySession'))exitCallback=n.arguments[0];ts.forEachChild(n,findExit)}
findExit(ptySource);assert.ok(exitCallback)
const exitCode=ts.transpileModule('const exitCallback='+exitCallback.getText(ptySource),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText

async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pty 能力-'))
 const project=path.join(root,'子项目');fs.mkdirSync(project)
 const sessions=new CapabilitySessions('instance','generation'), released:string[]=[]
 let bodyStarted!:()=>void
 let nextBodyStarted:Promise<void>|undefined
 const sandbox={capabilitySessions:sessions,capabilityLeases:new Map(),builtinCapabilityHost:{releaseSession:(id:string)=>released.push(id)},port:1,token:'test-only',
  path,fs,process:{execPath:process.execPath,resourcesPath:root},app:{getPath:()=>root,getAppPath:()=>root,isPackaged:false},
  capabilityInvocationCwd,sessionMcpServers:()=>[],agentMcpConfigPath:()=>path.join(root,'test-config.json'),
  capabilityPreferences:()=>({preferences:{workbench:true,bizone:false,guidance:true}}),sessionCapabilityGuidance:()=>'',
  ompHostPaths:()=>({userData:root,home:root}),
  prepareOmpPtyConfig:(host:{userData:string},binary:string,args:string[],guidance:boolean)=>{assert.equal(host.userData,root);assert.equal(binary,process.execPath);assert.equal(args.length,0);assert.equal(guidance,true);return {HOME:root,PI_CONFIG_DIR:'omp',PI_CODING_AGENT_DIR:path.join(root,'omp/agent'),OMP_SKIP_SETUP:'1'}},
  runnerFor:()=>({command:process.execPath,args:[]}),serverScriptPath:()=>path.join(root,'mcp/server.mjs'),createOmpCapabilityPlugin:()=>null,
  buildPtyCapabilityCommand:(body:{binary:string;args:string[]})=>({command:body.binary,args:body.args}),
  readBody:(req:http.IncomingMessage)=>new Promise<string>((resolve,reject)=>{bodyStarted?.();let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>resolve(text));req.on('error',reject)})}
 const runtime=runInNewContext(code+'\n({handle,capabilityPtyEnv,revokeCapabilitySession})',sandbox)
 const server=http.createServer(runtime.handle)
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 const port=(server.address() as {port:number}).port
 const parent=(id='pty-a'):CapabilityLease=>JSON.parse(runtime.capabilityPtyEnv(id,root).EAS_CAPABILITY_PARENT)
 const payload=(parent:CapabilityLease)=>({parent,kind:'codex',binary:process.execPath,cwd:root,args:['--cd','子项目'],ptyId:'forged',agentSessionId:'forged'})
 const post=(url:string,body:unknown)=>new Promise<{status:number;result?:{leaseId:string;env:Record<string,string>}}>((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:url,method:'POST'},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode!,...JSON.parse(data)}))});req.on('error',reject);req.end(JSON.stringify(body))
 })
 return {root,project,sessions,released,port,parent,payload,post,runtime,
  waitBody:()=>{nextBodyStarted=new Promise(r=>bodyStarted=r);return nextBodyStarted},
  exit:(id:string)=>runInNewContext(exitCode+'\nexitCallback', {id,flushOut(){},ptys:new Map(),revokeCapabilitySession:runtime.revokeCapabilitySession,termTail:{drop(){}},forgetPty(){},wc:{isDestroyed:()=>true}})({exitCode:0}),
  close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true})}}
}

test('production launch HTTP rejects forged parent and ordinary session credentials',async()=>{
 const f=await fixture()
 try{
  const parent=f.parent()
  assert.equal((await f.post('/capability/launch',f.payload({...parent,secret:'00'.repeat(32)}))).status,401)
  assert.equal((await f.post('/capability/launch',f.payload(f.sessions.issue({ptyId:'fake'})))).status,401)
 }finally{await f.close()}
})
test('production launch resolves native cwd while child keeps owning PTY identity',async()=>{
 const f=await fixture()
 try{
  const result=await f.post('/capability/launch',f.payload(f.parent()))
  assert.equal(result.status,200)
  const lease=JSON.parse(result.result!.env.EAS_CAPABILITY_LEASE)
  assert.deepEqual(f.sessions.authenticate(lease),{project:f.project,ptyId:'pty-a'})
  assert.equal(result.result!.env.EAS_CAPABILITY_PARENT,undefined)
 }finally{await f.close()}
})
test('revoking parent while actual HTTP body is pending prevents child issuance',async()=>{
 const f=await fixture()
 try{
  const parent=f.parent(),bodyStarted=f.waitBody()
  let req!:http.ClientRequest
  const response=new Promise<number>((resolve,reject)=>{
   req=http.request({host:'127.0.0.1',port:f.port,path:'/capability/launch',method:'POST'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!))});req.on('error',reject)
   req.write('{"parent":'+JSON.stringify(parent)+',')
  })
  await bodyStarted;f.exit('pty-a')
  const rest=f.payload(parent);delete (rest as Partial<typeof rest>).parent
  req.end(JSON.stringify(rest).slice(1))
  assert.equal(await response,401)
 }finally{await f.close()}
})
test('closing one invocation preserves siblings and rejects a different PTY parent',async()=>{
 const f=await fixture()
 try{
  const parent=f.parent(),other=f.parent('pty-b')
  const first=(await f.post('/capability/launch',f.payload(parent))).result!
  const second=(await f.post('/capability/launch',f.payload(parent))).result!
  assert.notEqual((await f.post('/capability/launch/close',{parent:other,leaseId:first.leaseId})).status,200)
  assert.equal((await f.post('/capability/launch/close',{parent,leaseId:first.leaseId})).status,200)
  assert.throws(()=>f.sessions.authenticate(JSON.parse(first.env.EAS_CAPABILITY_LEASE)))
  assert.equal(f.sessions.authenticate(JSON.parse(second.env.EAS_CAPABILITY_LEASE)).ptyId,'pty-a')
  assert.deepEqual(f.released,[first.leaseId])
 }finally{await f.close()}
})
test('actual PTY onExit callback revokes parent and all children, releasing only that PTY',async()=>{
 const f=await fixture()
 try{
  const parent=f.parent(),other=f.parent('pty-b')
  const children=await Promise.all([f.post('/capability/launch',f.payload(parent)),f.post('/capability/launch',f.payload(parent))])
  const survivor=(await f.post('/capability/launch',f.payload(other))).result!
  f.exit('pty-a')
  assert.throws(()=>f.sessions.authenticateLauncher(parent))
  for(const child of children)assert.throws(()=>f.sessions.authenticate(JSON.parse(child.result!.env.EAS_CAPABILITY_LEASE)))
  assert.equal(f.sessions.authenticate(JSON.parse(survivor.env.EAS_CAPABILITY_LEASE)).ptyId,'pty-b')
  assert.deepEqual(new Set(f.released),new Set([parent.id,...children.map(c=>c.result!.leaseId)]))
 }finally{await f.close()}
})
test('actual OMP launch route prepares managed config and returns only explicit root overlay plus child lease',async()=>{
 const f=await fixture()
 try{
  const result=await f.post('/capability/launch',{...f.payload(f.parent()),kind:'omp',args:[]})
  assert.equal(result.status,200)
  assert.equal(result.result!.env.PI_CODING_AGENT_DIR,path.join(f.root,'omp/agent'))
  assert.equal(result.result!.env.HOME,f.root)
  assert.deepEqual(Object.keys(result.result!.env).sort(),['EAS_CAPABILITY_LEASE','EAS_TERM_PORT','HOME','OMP_SKIP_SETUP','PI_CODING_AGENT_DIR','PI_CONFIG_DIR'])
 }finally{await f.close()}
})
