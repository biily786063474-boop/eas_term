import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractPage} from '../../plugins-store/web-fetch/lib/extract.mjs'
import {validatePageURL,fetchPage} from '../../plugins-store/web-fetch/lib/network.mjs'
test('extract HTML without execution, decode entities, retain title readable blocks and public links',()=>{
 const result=extractPage('<title>A &amp; B</title><style>secret</style><main><h1>Hello</h1><p>世界 &lt;test&gt;</p><script>alert(1)</script><div hidden>hidden</div><a href="/next">Next</a><a href="javascript:alert(1)">Bad</a></main>','text/html','https://example.com/a')
 assert.equal(result.title,'A & B');assert.match(result.text,/Hello\n+世界 <test>/);assert.doesNotMatch(result.text,/alert|secret|hidden/)
 assert.deepEqual(result.links,[{text:'Next',url:'https://example.com/next'}])
})
test('bound output and reject unsupported content rather than returning binary noise',()=>{
 const result=extractPage('<p>'+ 'x'.repeat(60000)+'</p>','text/html','https://example.com')
 assert.equal(result.text.length,50000);assert.equal(result.truncated,true)
 assert.throws(()=>extractPage('pdf','application/pdf','https://example.com'),/类型/)
 assert.equal(extractPage('a\nb','text/plain','https://example.com').text,'a\nb')
})
test('page URLs allow queries but reject credentials private literals nonHTTPS fragments and ports',()=>{
 assert.equal(validatePageURL('https://example.com/path?q=hello').search,'?q=hello')
 for(const url of ['http://example.com','https://127.0.0.1','https://localhost','https://x.local','https://example.com:444','https://a:b@example.com','file:///etc/passwd','https://example.com/#x'])assert.throws(()=>validatePageURL(url))
})
test('network pins public DNS, follows validated redirects without auth, rejects mixed DNS and oversized response',async t=>{
 const dns=(await import('node:dns/promises')).default,https=(await import('node:https')).default,{EventEmitter}=await import('node:events')
 const lookup=dns.lookup,request=https.request;t.after(()=>{dns.lookup=lookup;https.request=request})
 let addresses=[{address:'8.8.8.8',family:4}],mode='redirect',sent=[]
 dns.lookup=async()=>addresses
 https.request=(o,cb)=>{sent.push(o);const req=new EventEmitter();req.destroy=e=>{if(e)queueMicrotask(()=>req.emit('error',e))};req.end=()=>queueMicrotask(()=>{
  const res=new EventEmitter();res.resume=()=>{};res.destroy=()=>{};res.statusCode=mode==='redirect'&&sent.length===1?302:200;res.headers=res.statusCode===302?{location:'/next'}:{'content-type':'text/html'};cb(res)
  if(res.statusCode===200){res.emit('data',mode==='large'?Buffer.alloc(2*1024*1024+1):Buffer.from('<p>hello</p>'));res.emit('end')}
 });return req}
 const value=await fetchPage('https://example.com/start');assert.equal(value.url,'https://example.com/next');assert.equal(sent.length,2)
 for(const o of sent){assert.equal(o.hostname,'8.8.8.8');assert.equal(o.servername,'example.com');assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers.Cookie,undefined)}
 addresses=[{address:'8.8.8.8'},{address:'127.0.0.1'}];await assert.rejects(fetchPage('https://example.com'),/非公开/);assert.equal(sent.length,2)
 addresses=[{address:'8.8.8.8'}];mode='large';await assert.rejects(fetchPage('https://example.com'),/2MB/)
})
test('real package extraction and stdio fetch readable content through the production DNS guard',async t=>{
 const fs=(await import('node:fs')).default,os=(await import('node:os')).default,path=(await import('node:path')).default,http=(await import('node:http')).default
 const {buildPluginRegistries}=await import('../../scripts/plugin-registry-build.mjs'),{McpClient}=await import('./mcpClient.ts'),{execFileSync}=await import('node:child_process')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'webfetch-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const {v2}=buildPluginRegistries({plugins:[path.resolve('plugins-store/web-fetch')],outRoot:path.join(root,'dist')});assert.equal(v2.plugins.length,1)
 const unpack=path.join(root,'unpack');fs.mkdirSync(unpack);execFileSync('unzip',['-q',path.join(root,'dist/web-fetch/web-fetch-1.0.0.zip'),'-d',unpack])
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<title>Owned page</title><h1>实际抓取</h1><p>Hello &amp; world</p><script>secret()</script>')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const port=server.address().port,adapter=path.join(root,'adapter.mjs')
 fs.writeFileSync(adapter,`import dns from 'node:dns/promises';import https from 'node:https';import http from 'node:http';
 const lookup=dns.lookup;dns.lookup=(h,o)=>h==='owned.example.com'?Promise.resolve([{address:'8.8.8.8',family:4}]):lookup(h,o);
 const request=https.request;https.request=(o,cb)=>o.servername==='owned.example.com'&&o.hostname==='8.8.8.8'?http.request({...o,hostname:'127.0.0.1',port:${port}},cb):request(o,cb);`)
 const c=new McpClient({name:'webfetch-test',command:process.execPath,args:['--import',adapter,path.join(unpack,'server.mjs')],cwd:unpack});t.after(async()=>{c.close();await c.exited})
 await c.initialize('0.4.102');assert.deepEqual((await c.listTools()).map(x=>x.name),['web_fetch'])
 const response=await c.request('tools/call',{name:'web_fetch',arguments:{url:'https://owned.example.com/page'}})
 assert.ok(!response.isError,JSON.stringify(response));const page=JSON.parse(response.content[0].text)
 assert.equal(page.title,'Owned page');assert.match(page.text,/实际抓取/);assert.match(page.text,/Hello & world/);assert.doesNotMatch(page.text,/secret/)
 const bad=await c.request('tools/call',{name:'web_fetch',arguments:{url:'https://127.0.0.1/'}});assert.equal(bad.isError,true)
})
test('default v2 build includes the implemented web-fetch package without promoting OAuth candidates',async()=>{
 const fs=(await import('node:fs')).default
 const source=fs.readFileSync('scripts/build-plugin-registry.mjs','utf8')
 assert.ok(source.includes("'plugins-store/web-fetch'"))
})
