import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
const safety=()=>import('./lib/diagnostic-safety.mjs')
test('ownership rejects unrelated or absent listeners',async()=>{const {assertOwnedListeners}=await safety();const rows=[[10,1],[11,10],[12,11],[20,1]];assert.doesNotThrow(()=>assertOwnedListeners([12],10,rows));for(const pids of [[],[20],[12,20]])assert.throws(()=>assertOwnedListeners(pids,10,rows));assert.throws(()=>assertOwnedListeners([12],undefined,rows))})
test('occupied diagnostic port fails closed and owns no unrelated process',async()=>{const {assertPortFree,assertPortOwned}=await safety();const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const port=s.address().port;assert.throws(()=>assertPortFree(port));assert.throws(()=>assertPortOwned(port,99999999));assert.doesNotThrow(()=>assertPortOwned(port,process.pid))}finally{await new Promise(r=>s.close(r))}})
test('reports do not write to another hard-coded checkout',()=>{for(const n of ['report-native-engine','report-pressure-recovery'])assert.doesNotMatch(fs.readFileSync(new URL(n+'.mjs',import.meta.url),'utf8'),/\/Users\/biily/)})
test('queue threshold matches advertised seventy seconds',()=>assert.match(fs.readFileSync(new URL('verify-pressure-queue.mjs',import.meta.url),'utf8'),/elapsedMs>=70000/))

test('interrupt propagates through widget and A/B launchers without child leftovers', {timeout:60000}, async()=>{
 const {spawn}=await import('node:child_process'),os=await import('node:os'),path=await import('node:path')
 const engine=path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
 for(const outer of [false,true]){
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'eas-signal-test-'))
  const args=outer?['scripts/verify-engine-ab.mjs','--candidate',engine,'--out',out]:['scripts/verify-widget-lifecycle.mjs','--out',out,'--tag','signal']
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']}),exit=new Promise((yes,no)=>{child.once('exit',code=>yes(code));child.once('error',no)})
  let text='',sent=false;const timer=setTimeout(()=>child.kill('SIGTERM'),20000)
  const onData=b=>{text+=b.toString();if(!sent&&text.includes('"phase":"open"')){sent=true;child.kill('SIGTERM')}};child.stdout.on('data',onData);child.stderr.on('data',b=>{text+=b.toString()})
  try{assert.equal(await exit,1,text);const r=JSON.parse(fs.readFileSync(path.join(out,outer?'ab-a-1.json':'signal.json'),'utf8'));assert.equal(r.passed,false);assert.equal(r.failure,'interrupted');assert.equal(r.remainingOwnedCount,0);assert.equal(r.retainedProfile,undefined)}finally{clearTimeout(timer);fs.rmSync(out,{recursive:true,force:true})}
 }
})
