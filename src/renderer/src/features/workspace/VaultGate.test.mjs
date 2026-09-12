import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const code = (await build({entryPoints:[fileURLToPath(new URL('./VaultGate.tsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['react','react/jsx-runtime'],jsx:'automatic'})).outputFiles[0].text
function fixture(configured=false) {
 let cursor=0; const slots=[],effects=[],calls=[];let resumed=0,finish
 const st={configured,available:true,locked:true,lockedOutMs:0,count:0}
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial})},useId(){return 'fixture-code'},useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn())}}}
 const api={status:async()=>st,setup:async c=>{calls.push('setup');return{ok:true,status:{...st,configured:true,locked:false}}},unlock:c=>{calls.push('unlock');return new Promise(r=>finish=r)}}
 const module={exports:{}};const jsx=(type,props)=>({type,props})
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>n==='react'?hooks:n==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:require(n),window:{api:{secrets:api},setInterval(){return 1},clearInterval(){}},console})
 function render(){cursor=0;return module.exports.VaultGate({status:st,onUnlocked(){resumed++}})}
 function all(n){return !n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(all)]}
 function input(value){all(render()).find(n=>n.type==='input').props.onChange({target:{value}})}
 function submit(){return all(render()).find(n=>n.type==='input').props.onKeyDown}
 return {render,input,submit,calls,all,complete(){finish({ok:true,status:{...st,locked:false}})},get resumed(){return resumed},unmount(){effects.forEach(f=>f?.())}}
}
test('建柜先确认；不一致不调用setup；一致只恢复一次',async()=>{
 const f=fixture();f.input('123456');f.submit()({key:'Enter'});assert.equal(f.calls.length,0)
 f.input('654321');f.submit()({key:'Enter'});assert.equal(f.calls.length,0)
 f.input('123456');f.submit()({key:'Enter'});await new Promise(setImmediate);assert.deepEqual(f.calls,['setup']);assert.equal(f.resumed,1)
})
test('同一渲染周期的双Enter只提交一次解锁',async()=>{
 const f=fixture(true);f.input('123456');const handler=f.submit();handler({key:'Enter'});handler({key:'Enter'});assert.deepEqual(f.calls,['unlock']);f.complete();await new Promise(setImmediate);assert.equal(f.resumed,1)
})
test('关闭弹窗后迟到的解锁结果不恢复其他请求',async()=>{
 const f=fixture(true);f.input('123456');f.submit()({key:'Enter'});f.unmount();f.complete();await new Promise(setImmediate);assert.equal(f.resumed,0)
})
