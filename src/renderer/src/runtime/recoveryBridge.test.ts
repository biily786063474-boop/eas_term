import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
const src=fs.readFileSync(new URL('./recoveryBridge.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'')
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
async function fixture(){
 let handler:any,current=true,seals=0,transferring=false;const replies:unknown[]=[],exports:any={}
 const api={candidate:false,onActivate:()=>{},onRequest:(fn:any)=>{handler=fn},reply:async(_id:string,value:unknown)=>{replies.push(value)},seal:()=>{seals++;return false},activity:async()=>{}}
 runInNewContext(code,{exports,window:{api:{idleRecovery:api}},document:{addEventListener:()=>{}},performance,prepareRendererRecovery:async()=>({token:{},snapshot:{values:{}}}),restoreRendererRecovery:()=>{},recoveryRegistry:{current:()=>current,changed:()=>{current=false}},setRecoveryTransferring:(b:boolean)=>{transferring=b},setTimeout})
 await exports.bootWithRecovery(()=>{})
 const request=async(action:string)=>{handler({action,attempt:'one',id:action});await new Promise(r=>setImmediate(r))}
 return {request,replies,seals:()=>seals,transferring:()=>transferring,edit:()=>{current=false}}
}
test('late renderer edits reject seal before synchronous main handover',async()=>{const f=await fixture();await f.request('prepare');f.edit();await f.request('seal');assert.equal(f.seals(),0);assert.equal(f.replies.at(-1),false)})
test('seal performs synchronous handover and cancel restores attachment ownership on refusal',async()=>{const f=await fixture();await f.request('prepare');await f.request('seal');assert.equal(f.seals(),1);assert.equal(f.transferring(),true);await f.request('cancel');assert.equal(f.transferring(),false)})
