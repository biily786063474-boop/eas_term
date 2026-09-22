import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createWeatherClient} from '../../plugins-store/weather/lib/client.mjs'
test('weather requests current and forecast with fixed destination, explicit report times and no credential output',async()=>{
 const requests=[],key='fixture-secret-only'
 const client=createWeatherClient({key},async url=>{requests.push(new URL(url));return {status:'1',infocode:'10000',lives:[{adcode:'110101',city:'东城',weather:'晴',temperature:'24',reporttime:'2026-09-21 20:00:00'}],forecasts:[{adcode:'110101',city:'东城',reporttime:'2026-09-21 18:00:00',casts:[{date:'2026-09-22',dayweather:'晴',daytemp:'25'}]}]}})
 const current=await client.current({city:'110101'}),forecast=await client.forecast({city:'110101'})
 assert.equal(current.data[0].reporttime,'2026-09-21 20:00:00');assert.equal(forecast.data[0].casts[0].date,'2026-09-22')
 assert.equal(requests[0].origin,'https://restapi.amap.com');assert.equal(requests[0].pathname,'/v3/weather/weatherInfo')
 assert.equal(requests[0].searchParams.get('key'),key);assert.equal(requests[1].searchParams.get('extensions'),'all')
 assert.ok(!JSON.stringify([current,forecast]).includes(key))
 await assert.rejects(client.current({city:'https://evil.test'}))
 await assert.rejects(client.current({city:'110101',key:'override'}))
})
test('weather strips vendor arbitrary fields, rejects errors and redacts even thrown secrets',async()=>{
 const key='never-echo-this'
 const bad=createWeatherClient({key},async()=>{throw Error('https://restapi.amap.com?key='+key)})
 await assert.rejects(bad.current({city:'110101'}),e=>!e.message.includes(key))
 for(const response of [{status:'0',info:key},{status:'1',lives:[]},{status:'1',lives:[{adcode:'999999'}]}]){
  await assert.rejects(createWeatherClient({key},async()=>response).current({city:'110101'}))
 }
 const good=await createWeatherClient({key},async()=>({status:'1',lives:[{adcode:'110101',reporttime:'now',injected:key}]})).current({city:'110101'})
 assert.ok(!JSON.stringify(good).includes(key))
})
test('actual extracted weather package queries owned JSON fixture, pins DNS and rejects unsafe DNS or redirects',async t=>{
 const fs=(await import('node:fs')).default,os=(await import('node:os')).default,path=(await import('node:path')).default,http=(await import('node:http')).default
 const {execFileSync}=await import('node:child_process'),{packPlugin}=await import('../../scripts/pack-plugin.mjs'),{McpClient}=await import('./mcpClient.ts')
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'weather-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
 const dest=path.join(tmp,'installed');fs.mkdirSync(dest);const packed=packPlugin('plugins-store/weather',{outRoot:path.join(tmp,'packages'),registrySchema:2})
 execFileSync('unzip',['-q',packed.zipPath,'-d',dest])
 let calls=0,mode='ok'
 const secret='fixture-test-key'
 const server=http.createServer((req,res)=>{calls++;const url=new URL(req.url,'http://fixture');assert.equal(url.pathname,'/v3/weather/weatherInfo');assert.equal(url.searchParams.get('key'),secret)
  if(mode==='large'){res.setHeader('content-type','application/json');res.end('x'.repeat(1024*1024+1));return}
  if(mode==='redirect'){res.writeHead(302,{Location:'https://evil.test/?key='+secret});res.end();return}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'1',lives:[{adcode:'110101',weather:'晴',reporttime:'fixture-time'}],forecasts:[{adcode:'110101',casts:[{date:'2026-09-22',dayweather:'晴'}]}]}))
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const adapter=path.join(tmp,'adapter.mjs'),dnsMode=path.join(tmp,'dns-mode');fs.writeFileSync(dnsMode,'public')
 fs.writeFileSync(adapter,`import dns from 'node:dns/promises';import https from 'node:https';import http from 'node:http';import fs from 'node:fs';
 dns.lookup=async h=>{if(h!=='restapi.amap.com')throw Error('Unexpected host');return [{address:fs.readFileSync(${JSON.stringify(dnsMode)},'utf8')==='public'?'8.8.8.8':'127.0.0.1',family:4}]};
 https.request=(o,cb)=>{if(o.hostname!=='8.8.8.8'||o.servername!=='restapi.amap.com')throw Error('Not pinned');return http.request({...o,hostname:'127.0.0.1',port:${server.address().port}},cb)};`)
 const c=new McpClient({name:'weather-test',command:process.execPath,args:['--import',adapter,path.join(dest,'server.mjs')],cwd:dest,env:{PATH:process.env.PATH||'',EAS_PLUGIN_CONFIG:JSON.stringify({key:secret})}})
 t.after(async()=>{c.close();await c.exited});await c.initialize('0.4.102')
 assert.deepEqual((await c.listTools()).map(t=>t.name),['weather_current','weather_forecast'])
 const call=name=>c.request('tools/call',{name,arguments:{city:'110101'}})
 assert.ok(!(await call('weather_current')).isError);assert.ok(!(await call('weather_forecast')).isError)
 mode='redirect';const bad=await call('weather_current');assert.equal(bad.isError,true);assert.ok(!JSON.stringify(bad).includes(secret));assert.equal(calls,3)
 mode='large';assert.equal((await call('weather_current')).isError,true);assert.equal(calls,4)
 fs.writeFileSync(dnsMode,'private');assert.equal((await call('weather_current')).isError,true);assert.equal(calls,4)
})
