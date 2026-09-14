import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createAcpLive,type AcpProcess} from './transport.ts'
test('cancel while asynchronous admission is pending prevents handshake and retires late process',async()=>{
 let resolve!:(r:{ok:true;proc:AcpProcess})=>void,signal!:AbortSignal,killed=0,writes=0
 const events:any[]=[]
 const proc:AcpProcess={write(){writes++},onLine(){},onStderr(){},onExit(){},kill(){killed++}}
 const live=createAcpLive({open(){throw Error('must use managed open')},openAsync:(_cwd,s)=>{signal=s;return new Promise(r=>resolve=r)},emit:e=>events.push(e),log(){},clientVersion:'test',mcpServers:()=>[],now:()=>0},'/fixture',{idPrefix:'test'})
 live.deliver('never send');assert.equal(live.phase(),'opening');assert.equal(writes,0)
 assert.equal(live.interrupt(),true);assert.equal(signal.aborted,true)
 resolve({ok:true,proc});await new Promise(r=>setImmediate(r));assert.equal(killed,1);assert.equal(writes,0);assert.equal(live.phase(),'dead')
 assert.ok(events.some(e=>e.k==='turn.done'))
})

test('admission failure settles the turn and does not replay a rejected message',async()=>{
 const events:any[]=[];let opens=0
 const live=createAcpLive({open(){throw Error('sync open forbidden')},async openAsync(){opens++;throw Error('cancelled')},emit:e=>events.push(e),log(){},clientVersion:'test',mcpServers:()=>[],now:()=>0},'/fixture',{idPrefix:'test'})
 live.deliver('old');await new Promise(r=>setImmediate(r))
 assert.equal(live.phase(),'dead');assert.equal(opens,1)
 assert.ok(events.some(e=>e.k==='turn.done'))
 assert.ok(events.some(e=>e.k==='error'&&e.fatal===false&&e.message.includes('不会自动重试')))
})

test('setup refusal after admission settles the pending turn',async()=>{
 const events:any[]=[]
 const live=createAcpLive({open(){throw Error('sync open forbidden')},async openAsync(){return {ok:false,message:'fixture setup missing',setup:true}},emit:e=>events.push(e),log(){},clientVersion:'test',mcpServers:()=>[],now:()=>0},'/fixture',{idPrefix:'test'})
 live.deliver('old');await new Promise(r=>setImmediate(r))
 assert.equal(live.phase(),'dead');assert.ok(events.some(e=>e.k==='error'&&e.kind==='setup'))
 assert.ok(events.some(e=>e.k==='turn.done'))
})

test('closing pending admission aborts it and kills only its late process',async()=>{
 let resolve!:(r:{ok:true;proc:AcpProcess})=>void,signal!:AbortSignal,killed=0
 const proc:AcpProcess={write(){throw Error('must not handshake')},onLine(){},onStderr(){},onExit(){},kill(){killed++}}
 const live=createAcpLive({open(){throw Error('sync open forbidden')},openAsync:(_cwd,s)=>{signal=s;return new Promise(r=>resolve=r)},emit(){},log(){},clientVersion:'test',mcpServers:()=>[],now:()=>0},'/fixture',{idPrefix:'test'})
 live.deliver('old');live.close();assert.equal(signal.aborted,true)
 resolve({ok:true,proc});await new Promise(r=>setImmediate(r));assert.equal(killed,1);assert.equal(live.phase(),'dead')
})

test('closing an admitted ACP connection retires its actual owned process',async()=>{
 let killed=0
 const proc:AcpProcess={write(){},onLine(){},onStderr(){},onExit(){},kill(){killed++}}
 const live=createAcpLive({open:()=>({ok:true,proc}),emit(){},log(){},clientVersion:'test',mcpServers:()=>[],now:()=>0},'/fixture',{idPrefix:'test'})
 live.deliver('old');live.close();live.close();await new Promise(r=>setImmediate(r))
 assert.equal(killed,1);assert.equal(live.phase(),'dead')
})

test('a retired handshake cannot reset a newly opened connection',async()=>{
 let opens=0
 const live=createAcpLive({open:()=>{opens++;return {ok:true,proc:{write(){},onLine(){},onStderr(){},onExit(){},kill(){}}}},emit(){},log(){},clientVersion:'test',mcpServers:()=>[],now:()=>0},'/fixture',{idPrefix:'test'})
 live.deliver('old');live.close();live.deliver('new');await new Promise(r=>setImmediate(r))
 assert.equal(opens,2);assert.equal(live.phase(),'opening');live.close()
})
