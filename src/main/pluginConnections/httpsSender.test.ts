import {test} from 'node:test'
import assert from 'node:assert/strict'
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import forge from 'node-forge'
import * as sender from './httpsSender.ts'

test('real TLS and CONNECT preserve original SNI/Host but dial pinned address',async t=>{
 const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate()
 cert.publicKey=keys.publicKey;cert.serialNumber='01';cert.validity.notBefore=new Date(Date.now()-60_000);cert.validity.notAfter=new Date(Date.now()+3600_000)
 cert.setSubject([{name:'commonName',value:'mcp.fixture.test'}]);cert.setIssuer(cert.subject.attributes)
 cert.setExtensions([{name:'basicConstraints',cA:true},{name:'subjectAltName',altNames:[{type:2,value:'mcp.fixture.test'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create())
 const pem=forge.pki.certificateToPem(cert),key=forge.pki.privateKeyToPem(keys.privateKey)
 let oversized=false
 const seen:{host:string|undefined,sni:string|false|null|undefined}[]=[]
 const server=https.createServer({cert:pem,key},(req,res)=>{
  seen.push({host:req.headers.host,sni:(req.socket as import('node:tls').TLSSocket).servername})
  if(oversized){res.end(Buffer.alloc(17*1024*1024));return}
  res.setHeader('content-type','application/json');res.end('{"ok":true}')
 })
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const port=(server.address() as net.AddressInfo).port
 const tunnels:string[]=[];const sockets=new Set<import('node:stream').Duplex>()
 const proxy=http.createServer()
 proxy.on('connect',(req,socket,head)=>{
  tunnels.push(req.url!);sockets.add(socket)
  const upstream=net.connect(port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)})
  sockets.add(upstream);upstream.on('error',()=>socket.destroy())
 })
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();proxy.close()})
 const plan={url:new URL('https://mcp.fixture.test:'+port+'/mcp'),address:'127.0.0.1',servername:'mcp.fixture.test'}
 const send=sender.createHttpsSender({ca:pem})
 for(const proxyUrl of [undefined,new URL('http://127.0.0.1:'+(proxy.address() as net.AddressInfo).port)]){
  const response=await send({...plan,proxy:proxyUrl},{method:'POST',body:'{}',headers:{host:'mcp.fixture.test'}})
  assert.deepEqual(await response.json(),{ok:true})
 }
 await assert.rejects(sender.createHttpsSender()(plan,{headers:{host:'mcp.fixture.test'}}))
 oversized=true
 const big=await send(plan,{headers:{host:'mcp.fixture.test'}})
 await assert.rejects(big.arrayBuffer(),/16MB/)
 assert.deepEqual(tunnels,['127.0.0.1:'+port])
 assert.equal(seen.length,3);for(const s of seen){assert.equal(s.host,'mcp.fixture.test');assert.equal(s.sni,'mcp.fixture.test')}
})

test('header deadline closes a proxy socket even before CONNECT completes',async t=>{
 const sockets=new Set<net.Socket>();let closed=false
 const proxy=net.createServer(socket=>{sockets.add(socket);socket.on('data',()=>{});socket.on('close',()=>{closed=true;sockets.delete(socket)})})
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r))
 t.after(()=>{for(const s of sockets)s.destroy();proxy.close()})
 const controller=new AbortController()
 const plan={url:new URL('https://mcp.fixture.test/mcp'),address:'8.8.8.8',servername:'mcp.fixture.test',proxy:new URL('http://127.0.0.1:'+(proxy.address() as net.AddressInfo).port)}
 const result=sender.createHttpsSender({},30)(plan,{signal:controller.signal}).then(()=> 'success',()=> 'rejected')
 const outcome=await Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve('hung'),150))])
 await new Promise(r=>setTimeout(r,20))
 controller.abort()
 assert.equal(outcome,'rejected')
 assert.equal(closed,true,'pending CONNECT socket must close, not only reject the fetch')
})
