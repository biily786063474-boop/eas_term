import test from 'node:test'
import assert from 'node:assert/strict'
import {pauseJevSafely} from './jevPause.ts'
// @ts-expect-error standalone plugin module
import {createRuntime} from '../../../resources/plugins/jev/lib/runtime.mjs'
test('failed preference write blocks proof before process stops; restart cannot restore',async()=>{
 let saved:unknown,proof=true,stopped=false,fail=false
 const preferences={load:()=>saved,save:(v:unknown)=>{if(fail)throw Error('disk full');saved=structuredClone(v)}}
 const r=createRuntime({preferences});r.connect('fixture');r.enable();fail=true
 await assert.rejects(pauseJevSafely({pause:async()=>r.pause(),blockRecovery:()=>{proof=false},stop:()=>{assert.equal(proof,false);stopped=true}}),/自动恢复/)
 const resumed=createRuntime({preferences});if(proof)resumed.connect('fixture')
 assert.equal(stopped,true);assert.equal(resumed.snapshot().enabled,false)
})
test('successful pause preserves recovery proof',async()=>{
 let blocks=0
 assert.equal(await pauseJevSafely({pause:async()=>42,blockRecovery:()=>{blocks++},stop:()=>{throw Error('unexpected')}}),42)
 assert.equal(blocks,0)
})
test('if recovery proof cannot be deleted, warning does not falsely claim durable blocking',async()=>{
 let stopped=false
 await assert.rejects(pauseJevSafely({pause:async()=>{throw Error('disk full')},blockRecovery:()=>{throw Error('read only')},stop:()=>{stopped=true}}),/无法阻断自动恢复/)
 assert.equal(stopped,true)
})
