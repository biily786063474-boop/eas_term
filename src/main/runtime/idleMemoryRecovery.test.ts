import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {EventEmitter} from 'node:events'
import {createIdleRecoveryPolicy} from './idleRecoveryPolicy.ts'
const source=fs.readFileSync(new URL('./idleMemoryRecovery.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('export function','function')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
function fixture(){
 let now=0,focused=false,idle=true,enabled=true,generation=0,attached=false,calls=0,fail=false,interval:(()=>void)|undefined
 const app=new EventEmitter()
 const wc={getType:()=> 'window',isDestroyed:()=>false,debugger:{isAttached:()=>attached,attach:()=>{attached=true},detach:()=>{attached=false},sendCommand:async()=>{calls++;if(fail)throw Error('fixture')}}}
 const win={isFocused:()=>focused,webContents:wc}
 const install=runInNewContext(code+'\ninstallIdleMemoryRecovery',{app,BrowserWindow:{getAllWindows:()=>[win]},webContents:{getAllWebContents:()=>[wc]},createIdleRecoveryPolicy,performance:{now:()=>now},Date,setInterval:(fn:()=>void)=>{interval=fn;return {unref(){}}},clearInterval:()=>{interval=undefined}})
 const recovery=install({idle:()=>idle,enabled:()=>enabled,generation:()=>generation})
 const tick=async()=>{interval?.();await new Promise(r=>setImmediate(r))}
 return {recovery,app,wc,tick,step:async()=>{now+=30000;await tick()},calls:()=>calls,attached:()=>attached,set:(s:{focused?:boolean;idle?:boolean;enabled?:boolean;generation?:number;fail?:boolean})=>{focused=s.focused??focused;idle=s.idle??idle;enabled=s.enabled??enabled;generation=s.generation??generation;fail=s.fail??fail}}
}
test('one hour continuous background idle collects once, without reload or process kill',async()=>{
 const f=fixture();await f.tick();for(let i=0;i<119;i++)await f.step();assert.equal(f.calls(),0);await f.step();assert.equal(f.calls(),1);assert.equal(f.attached(),false);await f.step();assert.equal(f.calls(),1);f.recovery.dispose()
})
test('activity, foreground, disabled and attached debugger veto collection',async()=>{
 for(const state of [{focused:true},{idle:false},{enabled:false}]){const f=fixture();f.set(state);for(let i=0;i<125;i++)await f.step();assert.equal(f.calls(),0);f.recovery.dispose()}
 const f=fixture();f.wc.debugger.attach();for(let i=0;i<125;i++)await f.step();assert.equal(f.calls(),0);assert.equal(f.attached(),true);f.recovery.dispose()
})
test('failed collection detaches only owned debugger and exposes failure',async()=>{
 const f=fixture();f.set({fail:true});await f.tick();for(let i=0;i<120;i++)await f.step();assert.equal(f.calls(),1);assert.equal(f.attached(),false);assert.equal(f.recovery.status().lastError,true);f.app.emit('before-quit')
})
