import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createVoicePreviewLink} from './voicePreviewSession.ts'
class WorkerStub extends EventEmitter {messages:any[]=[];stops=0;postMessage(m:any){this.messages.push(m)}terminate(){this.stops++;return Promise.resolve(0)}}
const tick=()=>new Promise(r=>setImmediate(r))

test('一个 lease 内：保留调用方音频、FIFO 收尾；lease 停止不杀 worker，只发 reset', async () => {
 const w=new WorkerStub(),partial:string[]=[],errors:string[]=[]
 const link=createVoicePreviewLink(w);w.emit('message',{type:'ready'});await link.ready
 const s=link.open((text)=>partial.push(text),(error)=>errors.push(error));await s.ready
 const audio=new Float32Array([1,2]);assert.equal(s.push(audio,'a'),true)
 assert.notEqual(w.messages[0].samples,audio,'offline fallback must retain its own audio buffer')
 w.emit('message',{type:'partial',id:1,text:'one',targetId:'a'});const done=s.takeText();w.emit('message',{type:'ack',id:1})
 w.emit('message',{type:'result',id:2,text:'one'});assert.equal(await done,'one');assert.deepEqual(partial,['one'])
 let ended=false;void s.completed.then(()=>ended=true);s.stop();s.stop();await tick()
 assert.equal(ended,true,'lease 结束靠 stop，不等 worker 退出');assert.equal(w.stops,0,'worker 常驻')
 assert.deepEqual(w.messages.at(-1),{type:'reset'});assert.equal(errors.length,0);assert.equal(link.alive,true)
})

test('第二个 lease 立即可用（模型已加载）；旧 lease 的迟到消息不会串到新 lease', async () => {
 const w=new WorkerStub(),link=createVoicePreviewLink(w);w.emit('message',{type:'ready'});await link.ready
 const p1:string[]=[],p2:string[]=[]
 const a=link.open(t=>p1.push(t),()=>{});a.push(new Float32Array([1]),'x');a.stop()
 const b=link.open(t=>p2.push(t),()=>{});let readyFast=false;void b.ready.then(()=>readyFast=true);await tick();assert.equal(readyFast,true)
 w.emit('message',{type:'partial',id:1,text:'late',targetId:'x'})       // 属于 a 的 id
 assert.deepEqual(p1,[]);assert.deepEqual(p2,[])
 b.push(new Float32Array([2]),'y');w.emit('message',{type:'partial',id:2,text:'fresh',targetId:'y'})
 assert.deepEqual(p2,['fresh']);b.stop();await tick();assert.equal(w.stops,0)
})

test('积压有界：未确认音频超限拒绝 take 并结束 lease，而不是悄悄丢语音', async () => {
 const w=new WorkerStub(),errors:string[]=[];const link=createVoicePreviewLink(w);w.emit('message',{type:'ready'});await link.ready
 const s=link.open(()=>{},e=>errors.push(e));await s.ready
 assert.equal(s.push(new Float32Array(16384),'a'),true);assert.equal(s.push(new Float32Array(16384),'a'),true)
 const take=s.takeText(),rejected=assert.rejects(take,/跟不上|积压/)
 assert.equal(s.push(new Float32Array(1),'a'),false);await rejected;assert.equal(errors.length,1)
 assert.equal(w.stops,0,'积压是这次录音的问题，worker 留着')
})

test('收尾后迟到的 partial 被压住，同一编辑器下一句照常显示', async () => {
 const w=new WorkerStub(),partials:string[]=[];const link=createVoicePreviewLink(w);w.emit('message',{type:'ready'});await link.ready
 const s=link.open(text=>partials.push(text),()=>{});await s.ready;s.push(new Float32Array([1]),'same')
 const result=s.takeText()
 w.emit('message',{type:'partial',id:1,text:'old sentence'})
 w.emit('message',{type:'ack',id:1});w.emit('message',{type:'result',id:2,text:'old sentence'})
 assert.equal(await result,'old sentence');assert.deepEqual(partials,[],'finalized audio must not repaint preview')
 s.push(new Float32Array([2]),'same');w.emit('message',{type:'partial',id:3,text:'new sentence'})
 assert.deepEqual(partials,['new sentence']);s.stop()
})

test('worker 崩溃：当前 lease 收到错误、link 标记死亡、exited 只认真实 exit；terminate 结束当前 lease', async () => {
 const w=new WorkerStub(),errors:string[]=[];const link=createVoicePreviewLink(w);w.emit('message',{type:'ready'});await link.ready
 const s=link.open(()=>{},e=>errors.push(e));await s.ready
 w.emit('message',{type:'fatal',error:'boom'});await tick()
 assert.deepEqual(errors,['boom']);assert.equal(link.alive,false)
 let exited=false;void link.exited.then(()=>exited=true);await tick();assert.equal(exited,false)
 w.emit('exit',1);await link.exited
 const w2=new WorkerStub(),link2=createVoicePreviewLink(w2);w2.emit('message',{type:'ready'});await link2.ready
 const t=link2.open(()=>{},()=>{});let ended=false;void t.completed.then(()=>ended=true)
 link2.terminate();await tick();assert.equal(ended,true);assert.equal(w2.stops,1);assert.equal(link2.alive,false)
})

test('模型没加载完就开 lease：lease.ready 跟随 link.ready；启动失败拒绝 ready', async () => {
 const w=new WorkerStub(),link=createVoicePreviewLink(w);const s=link.open(()=>{},()=>{})
 let ready=false;void s.ready.then(()=>ready=true);await tick();assert.equal(ready,false)
 assert.equal(s.push(new Float32Array([1]),'a'),false,'未就绪不收音频')
 w.emit('message',{type:'ready'});await s.ready;assert.equal(ready,true)
 const w2=new WorkerStub(),link2=createVoicePreviewLink(w2);const s2=link2.open(()=>{},()=>{});const rejected=assert.rejects(s2.ready,/load failed/)
 w2.emit('message',{type:'fatal',error:'load failed'});await rejected
})
