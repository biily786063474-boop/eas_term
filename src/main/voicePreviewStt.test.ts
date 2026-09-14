import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {VoiceGate} from './voiceGate.ts'
function harness(){
 const source=fs.readFileSync(new URL('./stt.ts',import.meta.url),'utf8')
 const code=source.slice(source.indexOf('// 会话态')).replace('export function','function')
 const handlers:any={},events:any[]=[],sessions:any[]=[]
 const sender=Object.assign(new EventEmitter(),{id:81,isDestroyed:()=>false,send(...args:any[]){events.push(args)}})
 const open=async(_owner:any,_signal:any,_create:any,onError:any)=>{
  let text='',stops=0
  const session={ready:Promise.resolve(),completed:Promise.resolve(),stop(){stops++},push(_a:any,target:string){text=target;return true},takeText(){const value=text;text='';return Promise.resolve(value)},get stops(){return stops},onError}
  sessions.push(session);return session
 }
 const rec={createStream:()=>({}),reset(){},getResult:()=>({text:''})}
 const deps={ipcMain:{handle:(n:string,f:any)=>handlers[n]=f,on:(n:string,f:any)=>handlers[n]=f},VoiceGate,process:{platform:'linux'},readyDir:()=>'/model',MODELS:{stream:{},vad:{}},path:{join:()=>'/model'},openManagedPreview:open,createPreviewWorker:()=>{throw Error('stub open must not create real model')},loadVoicePreview:(_o:any,_s:any,load:any)=>load(),ensureRecognizer:async()=>rec,recognizer:rec,transcribeAsync:async()=>null,console}
 new Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';registerSttHandlers()')(...Object.values(deps))
 return {handlers,sender,sessions,events,event:{sender}}
}
test('actual recording uses bounded worker session, drains each editor FIFO and closes on stop',async()=>{
 const h=harness();assert.equal((await h.handlers['stt:start'](h.event,'basic')).ok,true)
 assert.equal(h.sessions.length,1,'recording start must allocate managed preview worker')
 const audio=()=>new Int16Array(2048).fill(20000).buffer
 for(let i=0;i<4;i++)h.handlers['stt:audio'](h.event,audio(),'A')
 for(let i=0;i<4;i++)h.handlers['stt:audio'](h.event,audio(),'B')
 const result=await h.handlers['stt:stop'](h.event)
 const finals=h.events.filter(e=>e[0]==='stt:final').map(e=>({text:e[1],targetId:e[2]}))
 finals.push(...(result.segments??[]).map((s:any)=>({text:s.text,targetId:s.targetId})))
 assert.deepEqual(finals,[{text:'A',targetId:'A'},{text:'B',targetId:'B'}])
 assert.equal(h.sessions[0].stops,1)
 assert.deepEqual(await h.handlers['stt:stop'](h.event),{text:''})
})
test('page loss terminates preview and permits a new recording without old callbacks stopping it',async()=>{
 const h=harness();await h.handlers['stt:start'](h.event,'basic');assert.equal(h.sessions.length,1)
 h.sender.emit('did-navigate');assert.equal(h.sessions[0].stops,1)
 assert.equal((await h.handlers['stt:start'](h.event,'basic')).ok,true)
 h.sessions[0].onError('old exit');assert.equal(h.sessions[1].stops,0)
 await h.handlers['stt:stop'](h.event);assert.equal(h.sessions[1].stops,1)
})
