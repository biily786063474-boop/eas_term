import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {createRecoveryRegistry} from './recoveryRegistry.ts'
import {createRecoveryState} from './recoveryState.ts'
const compile=(file:string,name:string,globals:Record<string,unknown>)=>runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/export /g,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'\n'+name,globals)
test('key change with identical value cannot leave a React update pending forever',async()=>{
 const registry=createRecoveryRegistry(),data=createRecoveryState()
 const slots:any[]=[],effects:any[]=[];let index=0,rerender=false
 const hook=compile('./useRecoveryState.ts','useRecoveryState',{
  recoveryRegistry:registry,recoveryState:data,recoveryTransferring:()=>false,
  useRef:(value:unknown)=>{const n=index++;return slots[n]??=( {current:value})},
  useState:(initial:any)=>{const n=index++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],(value:any)=>{const next=typeof value==='function'?value(slots[n]):value;if(!Object.is(next,slots[n])){slots[n]=next;rerender=true}}]},
  useCallback:(fn:unknown)=>{index++;return fn},
  useLayoutEffect:(fn:()=>unknown,deps:unknown[])=>{const n=index++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[n]={deps,cleanup:fn()}})}}
 })
 const render=(key:string)=>{do{rerender=false;index=0;hook(key,'');while(effects.length)effects.shift()()}while(rerender)}
 render('a');assert.ok(await registry.prepare(['state:a']))
 render('b');assert.ok(await registry.prepare(['state:b']))
})
test('image retention survives a second hook instance and protects history-owned image on removal',()=>{
 const data=createRecoveryState(),removed:string[]=[]
 const img={path:'/tmp/history-owned.png',url:'data:image/png;base64,AA==',external:false,name:'draft.png'}
 data.write('images:leaf:startup',[img])
 const hook=compile('../features/terminal/usePastedImages.ts','usePastedImages',{
  useId:()=> 'test',useRef:(v:unknown)=>({current:v}),useState:(v:unknown)=>[v,()=>{}],useEffect:()=>{},
  useRecoveryState:(key:string,initial:unknown)=>[data.read(key)??initial,(next:unknown)=>data.write(key,typeof next==='function'?next(data.read(key)??initial):next)],
  recoveryRegistry:createRecoveryRegistry(),recoveryTransferring:()=>false,
  useStore:(pick:(s:unknown)=>unknown)=>pick({lastSnapshot:null,setLastSnapshot:()=>{}}),
  window:{api:{pasteImage:{remove:(path:string)=>{removed.push(path);return Promise.resolve()}}}},track:()=>{}
 })
 const first=hook('leaf:startup');first.retainFiles([img.path])
 const second=hook('leaf:startup');second.dropImg(img)
 assert.deepEqual(removed,[])
})
