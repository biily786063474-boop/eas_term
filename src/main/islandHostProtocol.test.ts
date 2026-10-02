import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decodeHostEvent, allowHostAction, HostLineDecoder} from './islandHostProtocol.ts'
import type {IslandState} from '../shared/types.ts'
const line=(v:object)=>JSON.stringify({v:1,generation:'g',...v})
test('strict events reject malformed, stale, unknown and nonfinite payloads',()=>{
 assert.deepEqual(decodeHostEvent(line({type:'ready'}),'g'),{v:1,generation:'g',type:'ready'})
 for(const s of ['{broken','x'.repeat(262145),line({type:'exec'}),line({type:'hold',value:1}),line({type:'resize',w:null,h:20}),line({type:'resize',w:20,h:-1}),JSON.stringify({v:2,generation:'g',type:'ready'})])assert.equal(decodeHostEvent(s,'g'),null)
 assert.equal(decodeHostEvent(line({type:'ready'}),'old'),null)
 assert.equal(decodeHostEvent(line({type:'action',action:{type:'focus',key:1}}),'g'),null)
})
const state:IslandState={running:[{key:'a',project:'p',term:'t',startedAt:0}],notices:[{id:'a:n',kind:'approval',project:'p',term:'t',at:0,options:[{index:1,label:'yes'}]}]}
const bound:IslandState={...state,notices:[{...state.notices[0],rev:'r1'}]}
test('actions require current target; approval is bound to the rendered revision',()=>{
 assert.equal(allowHostAction({type:'focus',key:'a'},state),true)
 assert.equal(allowHostAction({type:'focus',key:'gone'},state),false)
 assert.equal(allowHostAction({type:'dismiss',key:'a:n'},state),true)
 assert.equal(allowHostAction({type:'dismiss',key:'a'},state),false)
 assert.equal(allowHostAction({type:'approve',key:'a',choice:1,rev:'r1'},bound),true)
 assert.equal(allowHostAction({type:'approve',key:'a',choice:1},bound),false)
 assert.equal(allowHostAction({type:'approve',key:'a',choice:1,rev:'r0'},bound),false)
 assert.equal(allowHostAction({type:'approve',key:'a',choice:2,rev:'r1'},bound),false)
 assert.equal(allowHostAction({type:'approve',key:'b',choice:1,rev:'r1'},bound),false)
 assert.equal(allowHostAction({type:'approve',key:'a',choice:1,rev:'r1'},state),false)
 for(const flag of ['dangerous','stale'])assert.equal(allowHostAction({type:'approve',key:'a',choice:1,rev:'r1'},{...bound,notices:[{...bound.notices[0],[flag]:true}]}),false)
 assert.equal(allowHostAction({type:'mini',key:''},state),true)
})
test('approve decode keeps a bounded revision string',()=>{
 assert.deepEqual(decodeHostEvent(line({type:'action',action:{type:'approve',key:'a',choice:1,rev:'r1'}}),'g'),{v:1,generation:'g',type:'action',action:{type:'approve',key:'a',choice:1,rev:'r1'}})
 assert.equal(decodeHostEvent(line({type:'action',action:{type:'approve',key:'a',choice:1,rev:5}}),'g'),null)
 assert.equal(decodeHostEvent(line({type:'action',action:{type:'approve',key:'a',choice:1,rev:'x'.repeat(129)}}),'g'),null)
})
test('presentation shows full approval options and revision; overlong text is never cut into an actionable prompt',async()=>{
 const {hostPresentation}=await import('./islandHostProtocol.ts')
 const shown=hostPresentation(bound).notices[0]
 assert.deepEqual(shown.options,[{index:1,label:'yes'}]);assert.equal(shown.rev,'r1')
 for(const patch of [{question:'q'.repeat(1025)},{options:[{index:1,label:'l'.repeat(257)}]}]){
  const long={...bound,notices:[{...bound.notices[0],...patch}]}
  assert.deepEqual(hostPresentation(long).notices[0].options,[])
  assert.equal(allowHostAction({type:'approve',key:'a',choice:1,rev:'r1'},long),false)
 }
})
test('stream keeps UTF-8 chunks, emits multiple lines, caps pending bytes',()=>{
 const rows:string[]=[];const d=new HostLineDecoder(s=>rows.push(s),32)
 const b=Buffer.from('你好\nsecond\n');d.push(b.subarray(0,2));d.push(b.subarray(2));assert.deepEqual(rows,['你好','second'])
 assert.throws(()=>d.push(Buffer.alloc(33)),/limit/)
 const e=new HostLineDecoder(()=>{},32);e.push(Buffer.from('partial'));assert.throws(()=>e.end(),/partial/)
})
test('oversized approval is never actionable',()=>{
 const oversized={...state,notices:[{...state.notices[0],body:'x'.repeat(8193)}]}
 assert.equal(allowHostAction({type:'approve',key:'a',choice:1},oversized),false)
})
test('presentation never truncates an approval into an actionable command',async()=>{
 const {hostPresentation}=await import('./islandHostProtocol.ts')
 const original={...state,notices:[{...state.notices[0],body:'x'.repeat(8193)}]}
 const result=hostPresentation(original)
 assert.equal(result.notices[0].body,undefined);assert.deepEqual(result.notices[0].options,[]);assert.equal(result.notices[0].dangerous,true)
 assert.ok(Buffer.byteLength(JSON.stringify(result))<250000)
 assert.equal(original.notices[0].body.length,8193)
})
test('multiple projects keep independent focus and dismiss targets as tasks expire',()=>{
 const many:IslandState={running:[{key:'project-a/task',project:'A',term:'one',startedAt:0},{key:'project-b/task',project:'B',term:'two',startedAt:1}],notices:[{id:'project-c/task:done',kind:'done',project:'C',term:'three',at:2}]}
 for(const key of ['project-a/task','project-b/task'])assert.equal(allowHostAction({type:'focus',key},many),true)
 assert.equal(allowHostAction({type:'dismiss',key:'project-c/task:done'},many),true)
 const next={...many,running:[many.running[1]],notices:[]}
 assert.equal(allowHostAction({type:'focus',key:'project-a/task'},next),false)
 assert.equal(allowHostAction({type:'focus',key:'project-b/task'},next),true)
 assert.equal(allowHostAction({type:'dismiss',key:'project-c/task:done'},next),false)
})
