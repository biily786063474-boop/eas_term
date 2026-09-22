import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createAmapClient} from '../../plugins-store/amap/lib/client.mjs'
test('Amap geocode, nearby and both route modes use exact endpoints with encoded parameters',async()=>{
 const urls=[],client=createAmapClient({key:'fixture-secret'},async raw=>{
  const u=new URL(raw);urls.push(u)
  return {status:'1',geocodes:[{formatted_address:'测试地址',location:'116.4,39.9',adcode:'110101'}],pois:[{id:'x',name:'咖啡店',location:'116.4,39.9'}],route:{origin:'116.4,39.9',destination:'116.5,39.8',paths:[{distance:'100',duration:'80',steps:[{instruction:'步行向东',distance:'100'}]}]}}
 })
 assert.equal((await client.geocode({address:'北京 & x',city:'北京'})).data[0].adcode,'110101')
 assert.equal((await client.nearby({location:'116.4,39.9',keywords:'咖啡'})).data[0].name,'咖啡店')
 for(const mode of ['walking','driving'])assert.equal((await client.route({origin:'116.4,39.9',destination:'116.5,39.8',mode})).data.paths[0].steps[0].instruction,'步行向东')
 assert.deepEqual(urls.map(u=>u.pathname),['/v3/geocode/geo','/v3/place/around','/v3/direction/walking','/v3/direction/driving'])
 assert.equal(urls[0].searchParams.get('address'),'北京 & x')
 assert.ok(urls.every(u=>u.origin==='https://restapi.amap.com'&&u.searchParams.get('key')==='fixture-secret'))
})
test('Amap rejects invalid coordinate ranges, precision, overrides, modes and unlimited pages before network',async()=>{
 const client=createAmapClient({key:'fixture'},async()=>{throw Error('must not call')})
 for(const location of ['181,0','0,91','116.1234567,39','NaN,0','https://evil.test','1,2,3'])await assert.rejects(client.nearby({location,keywords:'x'}),/坐标/)
 await assert.rejects(client.geocode({address:'x',key:'override'}),/参数/)
 await assert.rejects(client.nearby({location:'1,2',keywords:'x',limit:1000}),/数量/)
 await assert.rejects(client.route({origin:'1,2',destination:'2,3',mode:'unapproved'}),/路线/)
})
test('Amap output removes arbitrary fields and secret-bearing errors',async()=>{
 const key='dont-return-this'
 const result=await createAmapClient({key},async()=>({status:'1',geocodes:[{adcode:'110101',name:key,location:'1,2',extra:key}]})).geocode({address:'x'})
 assert.ok(!JSON.stringify(result).includes(key))
 await assert.rejects(createAmapClient({key},async()=>{throw Error(key)}).geocode({address:'x'}),e=>!e.message.includes(key))
 await assert.rejects(createAmapClient({key},async()=>({status:'0',info:key})).geocode({address:'x'}),e=>!e.message.includes(key))
})

test('actual extracted amap package queries owned JSON fixture, pins DNS and rejects unsafe DNS or redirects',async t=>{
 const fs=(await import('node:fs')).default,os=(await import('node:os')).default,path=(await import('node:path')).default,http=(await import('node:http')).default
 const {execFileSync}=await import('node:child_process'),{packPlugin}=await import('../../scripts/pack-plugin.mjs'),{McpClient}=await import('./mcpClient.ts')
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'amap-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
 const dest=path.join(tmp,'installed');fs.mkdirSync(dest);const packed=packPlugin('plugins-store/amap',{outRoot:path.join(tmp,'packages'),registrySchema:2})
 execFileSync('unzip',['-q',packed.zipPath,'-d',dest])
 let calls=0,mode='ok'
 const secret='fixture-test-key'
 const server=http.createServer((req,res)=>{calls++;const url=new URL(req.url,'http://fixture');assert.equal(url.pathname,'/v3/geocode/geo');assert.equal(url.searchParams.get('key'),secret)
  if(mode==='large'){res.setHeader('content-type','application/json');res.end('x'.repeat(1024*1024+1));return}
  if(mode==='redirect'){res.writeHead(302,{Location:'https://evil.test/?key='+secret});res.end();return}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'1',geocodes:[{adcode:'110101',formatted_address:'fixture',location:'116.4,39.9'}]}))
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const adapter=path.join(tmp,'adapter.mjs'),dnsMode=path.join(tmp,'dns-mode');fs.writeFileSync(dnsMode,'public')
 fs.writeFileSync(adapter,`import dns from 'node:dns/promises';import https from 'node:https';import http from 'node:http';import fs from 'node:fs';
 dns.lookup=async h=>{if(h!=='restapi.amap.com')throw Error('Unexpected host');return [{address:fs.readFileSync(${JSON.stringify(dnsMode)},'utf8')==='public'?'8.8.8.8':'127.0.0.1',family:4}]};
 https.request=(o,cb)=>{if(o.hostname!=='8.8.8.8'||o.servername!=='restapi.amap.com')throw Error('Not pinned');return http.request({...o,hostname:'127.0.0.1',port:${server.address().port}},cb)};`)
 const c=new McpClient({name:'amap-test',command:process.execPath,args:['--import',adapter,path.join(dest,'server.mjs')],cwd:dest,env:{PATH:process.env.PATH||'',EAS_PLUGIN_CONFIG:JSON.stringify({key:secret})}})
 t.after(async()=>{c.close();await c.exited});await c.initialize('0.4.102')
 assert.deepEqual((await c.listTools()).map(t=>t.name),['amap_geocode','amap_nearby','amap_route'])
 const call=name=>c.request('tools/call',{name,arguments:{address:'北京'}})
 assert.ok(!(await call('amap_geocode')).isError);assert.ok(!(await call('amap_geocode')).isError)
 mode='redirect';const bad=await call('amap_geocode');assert.equal(bad.isError,true);assert.ok(!JSON.stringify(bad).includes(secret));assert.equal(calls,3)
 mode='large';assert.equal((await call('amap_geocode')).isError,true);assert.equal(calls,4)
 fs.writeFileSync(dnsMode,'private');assert.equal((await call('amap_geocode')).isError,true);assert.equal(calls,4)
})
