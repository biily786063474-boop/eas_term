import {test} from 'node:test'
import assert from 'node:assert/strict'
import {HostRegistry} from '../hostRegistry.ts'
import {McpClient} from '../mcpClient.ts'
import {stopHost} from './stopHost.ts'
function setup(){
 const registry=new HostRegistry<{close():void}>({graceMs:100,setTimer:()=>0,clearTimer:()=>{},onIdle:()=>{}})
 let calls=0;const host=registry.acquire('x','panel:a',()=>({close(){calls++}}))
 return {registry,host,calls:()=>calls}
}
test('cancel does not drain or close',async()=>{
 const s=setup();assert.equal((await stopHost(s.registry,'x',()=>true,async()=>false,h=>h.close())).ok,false)
 assert.equal(s.calls(),0);assert.equal(s.registry.acquire('x','panel:b',()=>{throw Error()}),s.host)
})
test('ownership changes during confirmation prevent closing',async()=>{
 const s=setup();const result=await stopHost(s.registry,'x',()=>true,async()=>{s.registry.acquire('x','panel:b',()=>{throw Error()});return true},h=>h.close())
 assert.equal(result.ok,false);assert.equal(s.calls(),0)
})
test('replacement during confirmation cannot be stopped by old approval',async()=>{
 const s=setup();const result=await stopHost(s.registry,'x',()=>true,async()=>{s.registry.drop('x',s.host);s.registry.acquire('x','panel:a',()=>({close(){throw Error('wrong host')}}));return true},h=>h.close())
 assert.equal(result.ok,false);assert.equal(s.calls(),0)
})
test('permission is rechecked after confirmation, not cached',async()=>{
 const s=setup();let permitted=true
 assert.equal((await stopHost(s.registry,'x',()=>permitted,async()=>{permitted=false;return true},h=>h.close())).ok,false)
 assert.equal(s.calls(),0)
})
test('actual MCP child closes and registry waits for actual exit', {timeout:7000},async()=>{
 const registry=new HostRegistry<McpClient>({graceMs:100,setTimer:()=>0,clearTimer:()=>{},onIdle:()=>{}})
 const client=registry.acquire('test','panel:test',()=>new McpClient({name:'runtime-stop-test',command:process.execPath,args:['-e',`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ready:true}})+'\\n')});setTimeout(()=>process.exit(0),5000)`],env:{},cwd:process.cwd()}))
 const exited=new Promise<void>(resolve=>{client.onExit=()=>{registry.drop('test',client);resolve()}})
 try{
  assert.deepEqual(await client.request('ping',{},2000),{ready:true})
  assert.deepEqual(await stopHost(registry,'test',()=>true,async()=>true,h=>h.close()),{ok:true})
  assert.equal(registry.get('test'),client,'stop request must not pretend process exited')
  assert.throws(()=>registry.acquire('test','panel:new',()=>client),/draining/)
  await exited;assert.equal(registry.get('test'),undefined)
 }finally{client.close();await exited}
})

test('failed persistence does not fence or stop a live service',async()=>{
 const s=setup()
 await assert.rejects(stopHost(s.registry,'x',()=>true,async()=>true,h=>h.close(),()=>{throw Error('disk unavailable')}),/disk unavailable/)
 assert.equal(s.calls(),0)
 assert.equal(s.registry.acquire('x','panel:b',()=>{throw Error('unexpected spawn')}),s.host)
})
