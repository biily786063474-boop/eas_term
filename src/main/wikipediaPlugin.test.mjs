import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import readline from 'node:readline'
import * as wiki from '../../plugins-store/wikipedia/lib/client.mjs'
test('Wikipedia search uses only fixed language origins and returns attributed bounded results',async()=>{
 const urls=[];const client=wiki.createWikipediaClient(async url=>{urls.push(url);return {pages:[{title:'Earth',key:'Earth',description:'planet',excerpt:'The <span>Earth</span>'}]}})
 const result=await client.search({query:'Earth & Moon',language:'en',limit:2})
 assert.equal(urls[0],'https://en.wikipedia.org/w/rest.php/v1/search/page?q=Earth+%26+Moon&limit=2')
 assert.equal(result.pages[0].url,'https://en.wikipedia.org/wiki/Earth');assert.equal(result.pages[0].excerpt,'The Earth')
 assert.ok(result.attribution.includes('Wikipedia'))
 await assert.rejects(client.search({query:'x',language:'localhost'}),/language/)
 await assert.rejects(client.search({query:'x',limit:99}),/limit/)
 assert.equal(urls.length,1)
})
test('Wikipedia summary requests plaintext intro and rejects missing articles and arbitrary endpoint inputs',async()=>{
 const urls=[];let missing=false
 const client=wiki.createWikipediaClient(async url=>{urls.push(new URL(url));return {query:{pages:[missing?{missing:true}:{title:'Earth',extract:'planet',pageid:534366}]}}})
 const result=await client.summary({title:'Earth',language:'en'})
 assert.equal(result.extract,'planet');assert.equal(result.url,'https://en.wikipedia.org/wiki/Earth')
 assert.equal(urls[0].searchParams.get('explaintext'),'1');assert.equal(urls[0].searchParams.get('exintro'),'1')
 await assert.rejects(client.summary({title:'Earth',url:'https://localhost/'}),/unknown/)
 missing=true;await assert.rejects(client.summary({title:'Missing'}),/not found/)
})
test('packaged stdio server exposes both real tools and rejects invalid tool arguments without network',async t=>{
 const child=spawn(process.execPath,['plugins-store/wikipedia/server.mjs'],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill())
 const pending=new Map();const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r)})
 const request=(id,method,params)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('stdio timeout')),3000);pending.set(id,value=>{clearTimeout(timer);resolve(value)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})
 assert.equal((await request(1,'initialize',{})).result.serverInfo.name,'eas-wikipedia')
 assert.deepEqual((await request(2,'tools/list',{})).result.tools.map(t=>t.name),['wikipedia_search','wikipedia_summary'])
 const bad=await request(3,'tools/call',{name:'wikipedia_search',arguments:{query:'x',language:'127.0.0.1'}})
 assert.equal(bad.result.isError,true)
 child.stdin.end()
})
test('Wikipedia network refuses arbitrary endpoints and private/fake-IP DNS policy stays fail-closed',async()=>{
 const {wikipediaJSON}=await import('../../plugins-store/wikipedia/lib/network.mjs')
 const {validatePublicAddresses}=await import('../../plugins-store/wikipedia/lib/address-policy.mjs')
 for(const url of ['http://en.wikipedia.org/w/api.php','https://localhost/w/api.php','https://en.wikipedia.org.evil.test/w/api.php','https://en.wikipedia.org:444/w/api.php','https://en.wikipedia.org/other'])await assert.rejects(wikipediaJSON(url),/endpoint rejected/)
 for(const ip of ['127.0.0.1','198.18.0.76','10.1.2.3','169.254.169.254','::1'])assert.throws(()=>validatePublicAddresses([ip]),/非公开/)
 assert.throws(()=>validatePublicAddresses(['8.8.8.8','127.0.0.1']),/非公开/)
})
test('Wikipedia HTTPS pins the validated address, preserves TLS hostname, and rejects redirects/oversized bodies',async t=>{
 const dns=(await import('node:dns/promises')).default,https=(await import('node:https')).default
 const {EventEmitter}=await import('node:events')
 const {wikipediaJSON}=await import('../../plugins-store/wikipedia/lib/network.mjs')
 const lookup=dns.lookup,request=https.request;t.after(()=>{dns.lookup=lookup;https.request=request})
 let status=200,large=false
 dns.lookup=async()=>[{address:'8.8.8.8',family:4}]
 https.request=(options,callback)=>{
  assert.equal(options.hostname,'8.8.8.8');assert.equal(options.servername,'en.wikipedia.org')
  assert.equal(options.headers.Host,'en.wikipedia.org');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,undefined)
  assert.equal(options.rejectUnauthorized,undefined);assert.ok(options.headers['User-Agent'].includes('Eas-Term'))
  const req=new EventEmitter();req.destroy=error=>{if(error)queueMicrotask(()=>req.emit('error',error))};req.end=()=>queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=status;res.resume=()=>{};callback(res)
   if(status===200){res.emit('data',large?Buffer.alloc(1024*1024+1):Buffer.from('{"pages":[]}'));if(!large)res.emit('end')}
  });return req
 }
 const url='https://en.wikipedia.org/w/rest.php/v1/search/page?q=Earth&limit=1'
 assert.deepEqual(await wikipediaJSON(url),{pages:[]})
 status=302;await assert.rejects(wikipediaJSON(url),/HTTP 302/)
 status=200;large=true;await assert.rejects(wikipediaJSON(url),/1MB/)
})
