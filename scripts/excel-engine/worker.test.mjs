import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
const module = await import('./worker.mjs').catch(()=>({}))
const key=process.platform+'-'+process.arch
async function fixture(t,source){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'excel-worker-')))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 await fs.mkdir(path.join(root,'bin'))
 const name='excel-engine-'+key+(process.platform==='win32'?'.exe':'')
 const bytes=Buffer.from('#!'+process.execPath+'\n'+source)
 await fs.writeFile(path.join(root,'bin',name),bytes,{mode:0o700})
 await fs.writeFile(path.join(root,'bin','integrity.json'),JSON.stringify({[key]:{sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length}}))
 return {root,name,run:(request,options)=>module.runEngine(root,request,options)}
}
test('worker adapter exists',()=>assert.equal(typeof module.runEngine,'function'))
test('one shot request uses scrubbed env and waits for close',async t=>{
 const f=await fixture(t,`let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const q=JSON.parse(s);process.stdout.write(JSON.stringify({value:q.operation+':'+String(process.env.EAS_PLUGIN_CONFIG)}))})`)
 process.env.EAS_PLUGIN_CONFIG='test-secret';t.after(()=>delete process.env.EAS_PLUGIN_CONFIG)
 assert.deepEqual(await f.run({operation:'calculate'}),{value:'calculate:undefined'})
})
test('changed executable fails integrity before spawn',async t=>{
 const f=await fixture(t,`process.stdout.write('{}')`)
 await fs.appendFile(path.join(f.root,'bin',f.name),'\n//changed')
 await assert.rejects(f.run({operation:'calculate'}),/integrity/)
})
test('symlink executable is refused',async t=>{
 const f=await fixture(t,`process.stdout.write('{}')`)
 const file=path.join(f.root,'bin',f.name);await fs.rename(file,file+'.real');await fs.symlink(file+'.real',file)
 await assert.rejects(f.run({operation:'calculate'}),/regular|symlink/)
})
test('timeout kills owned worker and cancellation is distinct',async t=>{
 const f=await fixture(t,`setInterval(()=>{},100)`)
 await assert.rejects(f.run({operation:'calculate'},{timeoutMs:60}),/timeout/)
 const controller=new AbortController();const pending=f.run({operation:'calculate'},{signal:controller.signal});setTimeout(()=>controller.abort(),60)
 await assert.rejects(pending,/cancelled/)
})
test('output flood is bounded and worker killed',async t=>{
 const f=await fixture(t,`setInterval(()=>process.stdout.write('x'.repeat(65536)),1)`)
 await assert.rejects(f.run({operation:'calculate'},{maxOutputBytes:1024}),/output limit/)
})
test('stderr and malformed responses do not leak raw contents',async t=>{
 const f=await fixture(t,`process.stderr.write('test-secret');process.exit(2)`)
 await assert.rejects(f.run({operation:'calculate'}),e=>/failed/.test(e.message)&&!e.message.includes('test-secret'))
 const g=await fixture(t,`process.stdout.write('{"workbook":"not base64!"}')`)
 await assert.rejects(g.run({operation:'chart'}),/response/)
})
test('oversized request rejected before process and pre-abort honored',async t=>{
 const f=await fixture(t,`process.stdout.write('{}')`)
 await assert.rejects(f.run({operation:'calculate',workbook:'x'.repeat(12*1024*1024)}),/request limit/)
 const c=new AbortController();c.abort();await assert.rejects(f.run({operation:'calculate'},{signal:c.signal}),/cancelled/)
})
test('accepts bounded typed read result but refuses malformed sheet rows',async t=>{
 const value={sheets:[{name:'Sheet1',rows:[[12,true,null,{formula:'SUM(A1:A2)'}]]}],calculated:false,note:'cached only'}
 const f=await fixture(t,'process.stdout.write('+JSON.stringify(JSON.stringify(value))+')')
 assert.deepEqual(await f.run({operation:'read'}),value)
 for(const sheets of [[{name:'x',rows:'bad'}],[{name:'x',rows:[[{secret:'bad'}]]}]]){
  const g=await fixture(t,'process.stdout.write('+JSON.stringify(JSON.stringify({sheets,calculated:false}))+')')
  await assert.rejects(g.run({operation:'read'}),/response/)
 }
})
test('host-extracted non-executable worker is enabled only after integrity validation',async t=>{
 const f=await fixture(t,`process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('{"value":"ok"}'))`)
 const file=path.join(f.root,'bin',f.name);await fs.chmod(file,0o600)
 assert.deepEqual(await f.run({operation:'calculate'}),{value:'ok'})
 if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o700)
 await fs.chmod(file,0o600);await fs.appendFile(file,'\n//tampered')
 await assert.rejects(f.run({operation:'calculate'}),/integrity/)
 if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600)
})
