import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {EventEmitter} from 'node:events'
import {runInNewContext} from 'node:vm'
import path from 'node:path'
import {observeChildClose,cleanupVerificationProfile} from './lib/verification-cleanup.mjs'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
// Run the actual verifier's finally block, not a copy of its cleanup algorithm.
const source=fs.readFileSync(new URL('./verify-builtin-capabilities.mjs',import.meta.url),'utf8')
const block=source.slice(source.indexOf('} finally {\n  // Diagnostic I/O')+11,source.lastIndexOf('\n}'))
test('verifier never removes the profile on exit before owned stdio close',async()=>{
 const app=new EventEmitter();app.exitCode=null;app.signalCode=null
 let removed=false,closed=false
 app.kill=()=>{app.exitCode=0;queueMicrotask(()=>app.emit('exit',0));return true}
 const childClosed=new Promise(resolve=>app.once('close',()=>{closed=true;resolve()}))
 const cleanup=runInNewContext('(async()=>{'+block+'})',{
  app,childClosed,ws:{close(){}},wait,logs:'fixture',output:'/output',profile:'/owned-profile',path,
  verificationError:undefined,
  cleanupVerificationProfile: (opts=>cleanupVerificationProfile({...opts,remove:async()=>{removed=true;assert.equal(closed,true)},graceMs:200,forceMs:200})),
  fs:{writeFileSync(){},rmSync(){removed=true}}
 })
 const done=cleanup();await wait(30)
 assert.equal(removed,false,'exit alone must not authorize profile removal')
 app.emit('close');await done;assert.equal(removed,true)
})

function fake(){
 const app=new EventEmitter();app.exitCode=null;app.signalCode=null
 const signals=[];app.kill=signal=>{signals.push(signal);return true}
 return {app,signals,childClosed:observeChildClose(app)}
}
test('force escalation still awaits close; early observed close is retained',async()=>{
 const f=fake();let removed=false
 f.app.kill=signal=>{f.signals.push(signal);if(signal==='SIGKILL'){f.app.signalCode=signal;f.app.emit('exit',null,signal);setTimeout(()=>f.app.emit('close'),25)}return true}
 const done=cleanupVerificationProfile({...f,profile:'/owned',graceMs:5,forceMs:100,remove:async()=>{removed=true}})
 await wait(15);assert.equal(removed,false);await done
 assert.deepEqual(f.signals,['SIGTERM','SIGKILL'])
 const early=fake();early.app.exitCode=0;early.app.emit('close')
 await cleanupVerificationProfile({...early,profile:'/owned',remove:async()=>{}})
 assert.deepEqual(early.signals,[])
})
test('unconfirmed close fails bounded without touching the profile',async()=>{
 const f=fake();let removed=false
 await assert.rejects(cleanupVerificationProfile({...f,profile:'/keep-evidence',graceMs:5,forceMs:5,remove:async()=>{removed=true}}),error=>{
  assert.match(error.message,/retained at \/keep-evidence/);assert.match(error.cause.message,/close was not observed/);return true
 })
 assert.equal(removed,false);assert.deepEqual(f.signals,['SIGTERM','SIGKILL'])
 f.app.emit('close')
})
test('transient Windows handle contention retries with finite backoff',async()=>{
 const f=fake();f.app.exitCode=0;f.app.emit('close');let attempts=0;const waits=[]
 await cleanupVerificationProfile({...f,profile:'/owned',maxRetries:3,retryDelayMs:20,pause:async ms=>{waits.push(ms)},remove:async()=>{
  attempts++;if(attempts<4)throw Object.assign(Error('busy'),{code:attempts===2?'EPERM':'EBUSY'})
 }})
 assert.equal(attempts,4);assert.deepEqual(waits,[20,40,60])
})
for(const code of ['EBUSY','EACCES'])test(code+' exhaustion or permanent error preserves evidence path and cause',async()=>{
 const f=fake();f.app.exitCode=0;f.app.emit('close');let attempts=0
 const original=Object.assign(Error('fixture '+code),{code})
 await assert.rejects(cleanupVerificationProfile({...f,profile:'/keep-evidence',maxRetries:2,pause:async()=>{},remove:async()=>{attempts++;throw original}}),error=>{
  assert.match(error.message,/retained at \/keep-evidence/);assert.equal(error.cause,original);return true
 })
 assert.equal(attempts,code==='EBUSY'?3:1)
})
test('real parent exit with inherited descendant stdio waits until descendant finishes before removal',async()=>{
 const {spawn}=await import('node:child_process'),os=await import('node:os'),{rm}=await import('node:fs/promises')
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'eas-cleanup-test-')),marker=path.join(profile,'descendant-finished')
 const descendant=`setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'done')},180)`
 const program=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});console.log('READY');setInterval(()=>{},1000)`
 const app=spawn(process.execPath,['-e',program],{stdio:['ignore','pipe','pipe']});const childClosed=observeChildClose(app)
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture did not start')),3000);app.stdout.once('data',()=>{clearTimeout(timer);resolve()});app.once('error',reject)})
  let exited=false;app.once('exit',()=>{exited=true})
  await cleanupVerificationProfile({app,childClosed,profile,remove:async(p,opts)=>{assert.equal(exited,true);assert.equal(fs.readFileSync(marker,'utf8'),'done');await rm(p,opts)}})
  assert.equal(fs.existsSync(profile),false)
 }finally{if(app.exitCode===null&&app.signalCode===null)app.kill('SIGKILL');await childClosed;await rm(profile,{recursive:true,force:true})}
})

test('verifier preserves primary, cleanup and diagnostic errors in that order',async()=>{
 const primary=Error('primary verification failure'),cleanupError=Error('cleanup failure'),writeError=Object.assign(Error('disk full'),{code:'ENOSPC'})
 const writes=[]
 const cleanup=runInNewContext('(async()=>{'+block+'})',{
  app:{},childClosed:Promise.resolve(),ws:{close(){}},logs:'fixture',output:'/output',profile:'/owned-profile',path,verificationError:primary,
  cleanupVerificationProfile:async()=>{throw cleanupError},
  fs:{writeFileSync(file){writes.push(file);if(file.endsWith('.json'))throw writeError}}
 })
 await assert.rejects(cleanup(),error=>{
  assert.equal(error.name,'AggregateError')
  assert.deepEqual([...error.errors],[primary,cleanupError,writeError]);return true
 })
 assert.equal(writes.length,2,'log evidence must still be attempted after JSON write fails')
})
test('socket and both diagnostic failures cannot skip owned cleanup',async()=>{
 const socketError=Error('socket close'),jsonError=Error('json denied'),logError=Error('log denied');let cleaned=false
 const cleanup=runInNewContext('(async()=>{'+block+'})',{
  app:{},childClosed:Promise.resolve(),ws:{close(){throw socketError}},logs:'fixture',output:'/output',profile:'/owned-profile',path,verificationError:undefined,
  cleanupVerificationProfile:async()=>{cleaned=true},fs:{writeFileSync(file){throw file.endsWith('.json')?jsonError:logError}}
 })
 await assert.rejects(cleanup(),error=>{assert.equal(error.name,'AggregateError');assert.deepEqual([...error.errors],[socketError,jsonError,logError]);return true})
 assert.equal(cleaned,true)
})
