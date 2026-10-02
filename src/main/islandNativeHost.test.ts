import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {NativeIslandHost} from './islandNativeHost.ts'
function fixture(){const p=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{p.emit('exit',0);return true}});return p}
test('host validates generation and shuts down once, rejects late events',()=>{
 const p=fixture(),events:unknown[]=[],errors:string[]=[]
 const host=new NativeIslandHost({binary:'/fixture',assets:'/fixture',generation:'g',launch:()=>p as any,onEvent:e=>events.push(e),onClose:()=>{},onError:e=>errors.push(e)})
 p.stdout.write('{"v":1,"generation":"g","type":"ready"}\n');assert.equal(events.length,1)
 host.destroy();host.destroy();p.stdout.write('{"v":1,"generation":"g","type":"ready"}\n');assert.equal(events.length,1);assert.equal(host.isDestroyed(),true)
 assert.deepEqual(errors,[])
})
test('stale instance message fails closed',()=>{
 const p=fixture(),errors:string[]=[]
 const host=new NativeIslandHost({binary:'/fixture',assets:'/fixture',generation:'g',launch:()=>p as any,onEvent:()=>assert.fail(),onClose:()=>{},onError:e=>errors.push(e)})
 p.stdout.write('{"v":1,"generation":"old","type":"ready"}\n');assert.equal(host.isDestroyed(),true);assert.equal(errors.length,1)
})
test('backpressure failure closes without recursive shutdown',()=>{
 const p=fixture(),errors:string[]=[]
 Object.defineProperty(p.stdin,'writableLength',{get:()=>300000})
 const host=new NativeIslandHost({binary:'/fixture',assets:'/fixture',generation:'g',launch:()=>p as any,onEvent:()=>{},onClose:()=>{},onError:e=>errors.push(e)})
 host.showInactive();assert.equal(host.isDestroyed(),true);assert.equal(errors.length,1)
})
test('missing ready times out and owned process is killed after close grace',t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const p=fixture(),errors:string[]=[];let killed=0
 p.kill=()=>{killed++;p.emit('exit',0);p.emit('close',0);return true}
 const host=new NativeIslandHost({binary:'/fixture',assets:'/fixture',generation:'g',launch:()=>p as any,onEvent:()=>{},onClose:()=>{},onError:e=>errors.push(e)})
 t.mock.timers.tick(8000);assert.equal(host.isDestroyed(),true);assert.deepEqual(errors,['native island ready timeout'])
 t.mock.timers.tick(1000);assert.equal(killed,1)
})
