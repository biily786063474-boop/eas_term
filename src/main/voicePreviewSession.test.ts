import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createVoicePreviewSession} from './voicePreviewSession.ts'
class WorkerStub extends EventEmitter {messages:any[]=[];stops=0;postMessage(m:any){this.messages.push(m)}terminate(){this.stops++;return Promise.resolve(0)}}
test('preview session preserves caller audio and waits for FIFO result and real worker exit',async()=>{
 const w=new WorkerStub(),partial:string[]=[],errors:string[]=[]
 const s=createVoicePreviewSession(w,(text)=>partial.push(text),(error)=>errors.push(error))
 w.emit('message',{type:'ready'});await s.ready
 const audio=new Float32Array([1,2]);assert.equal(s.push(audio,'a'),true)
 assert.notEqual(w.messages[0].samples,audio,'offline fallback must retain its own audio buffer')
 w.emit('message',{type:'partial',id:1,text:'one',targetId:'a'});const done=s.takeText();w.emit('message',{type:'ack',id:1})
 w.emit('message',{type:'result',id:2,text:'one'});assert.equal(await done,'one');assert.deepEqual(partial,['one'])
 let exited=false;void s.completed.then(()=>exited=true);s.stop();s.stop();await new Promise(r=>setImmediate(r));assert.equal(exited,false);assert.equal(w.stops,1)
 w.emit('exit',0);await s.completed;assert.equal(errors.length,0)
})
test('preview session bounds unacknowledged audio and rejects pending take instead of silently dropping speech',async()=>{
 const w=new WorkerStub(),errors:string[]=[];const s=createVoicePreviewSession(w,()=>{},e=>errors.push(e))
 w.emit('message',{type:'ready'});await s.ready
 assert.equal(s.push(new Float32Array(16384),'a'),true);assert.equal(s.push(new Float32Array(16384),'a'),true)
 const take=s.takeText(),rejected=assert.rejects(take,/跟不上|积压/)
 assert.equal(s.push(new Float32Array(1),'a'),false);await rejected;assert.equal(errors.length,1);assert.equal(w.stops,1)
 w.emit('exit',0);await s.completed
})
test('sentence drain suppresses delayed partials even when next sentence uses the same editor',async()=>{
 const w=new WorkerStub(),partials:string[]=[];const s=createVoicePreviewSession(w,text=>partials.push(text),()=>{})
 w.emit('message',{type:'ready'});await s.ready;s.push(new Float32Array([1]),'same')
 const result=s.takeText()
 w.emit('message',{type:'partial',id:1,text:'old sentence'})
 w.emit('message',{type:'ack',id:1});w.emit('message',{type:'result',id:2,text:'old sentence'})
 assert.equal(await result,'old sentence');assert.deepEqual(partials,[],'finalized audio must not repaint preview')
 s.push(new Float32Array([2]),'same');w.emit('message',{type:'partial',id:3,text:'new sentence'})
 assert.deepEqual(partials,['new sentence']);s.stop();w.emit('exit',0);await s.completed
})
