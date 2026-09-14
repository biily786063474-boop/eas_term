import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {observeSharedWindow} from './sharedWindowLifecycle.ts'
test('shared references release on every navigation, crash and destruction without duplicate listeners',()=>{
 const wc=Object.assign(new EventEmitter(),{id:7}),released:number[]=[]
 observeSharedWindow(wc,id=>released.push(id));observeSharedWindow(wc,id=>released.push(id))
 wc.emit('did-navigate');wc.emit('did-navigate');wc.emit('render-process-gone');wc.emit('destroyed')
 assert.deepEqual(released,[7,7,7,7]);assert.equal(wc.listenerCount('did-navigate'),1)
})
