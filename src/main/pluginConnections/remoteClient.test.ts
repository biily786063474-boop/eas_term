import {test} from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import * as remote from './remoteClient.ts'

test('real HTTP handshake, tool listing, tool call, no write replay, and close',async t=>{
 const methods:string[]=[]
 let fail=false
 const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405);res.end();return}
  let raw='';for await(const chunk of req)raw+=chunk
  const m=JSON.parse(raw);methods.push(m.method)
  if(m.id===undefined){res.writeHead(202);res.end();return}
  if(fail && m.method==='tools/call'){res.writeHead(503);res.end('unavailable');return}
  const result=m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:
   m.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'actual result'}]}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}))
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>{server.closeAllConnections();server.close()})
 const address=server.address() as {port:number}
 // Network adapter seam: local test server only. Production will require its own validated/pinned adapter.
 const client=new remote.RemotePluginClient({url:'https://mcp.example.com/mcp',approvedOrigins:['https://mcp.example.com'],version:'0.4.102',fetch:async(_url,init)=>fetch('http://127.0.0.1:'+address.port+'/mcp',init)})
 t.after(()=>client.close())
 await Promise.all([client.connect(),client.connect()])
 assert.equal(methods.filter(m=>m==='initialize').length,1)
 assert.deepEqual(methods.slice(0,2),['initialize','notifications/initialized'])
 assert.equal((await client.listTools())[0].name,'echo')
 const result=await client.callTool('echo',{})
 assert.deepEqual(result.content,[{type:'text',text:'actual result'}])
 fail=true
 await assert.rejects(client.callTool('echo',{}))
 assert.equal(methods.filter(m=>m==='tools/call').length,2)
 await client.close()
 await assert.rejects(client.callTool('echo',{}),/未连接/)
})

test('tracked timeout is not remote completion; only connection close releases local tracking',async t=>{
 const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405);res.end();return}
  let raw='';for await(const chunk of req)raw+=chunk
  const m=JSON.parse(raw)
  if(m.id===undefined){res.writeHead(202);res.end();return}
  if(m.method==='tools/call')return
  res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}}))
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const port=(server.address() as {port:number}).port
 const client=new remote.RemotePluginClient({url:'https://mcp.example.com/mcp',approvedOrigins:['https://mcp.example.com'],version:'test',fetch:async(_url,init)=>fetch('http://127.0.0.1:'+port+'/mcp',init)})
 t.after(()=>client.close());await client.connect()
 const call=client.requestTracked('tools/call',{name:'slow',arguments:{}},10)
 let completed=false;void call.completed.then(()=>{completed=true})
 await assert.rejects(call.result,/超时/);assert.equal(completed,false)
 call.cancel();await new Promise(r=>setTimeout(r,10));assert.equal(completed,false)
 await client.close();assert.equal(await call.completed,'connection-closed')
})
