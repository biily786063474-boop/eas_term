import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
test('adding a project records MRU; cancel/reselect never creates fake recency',async()=>{
 const module={exports:{} as any},touches:string[]=[]
 let returned=[{id:'old'},{id:'new'}],state:any={projects:[{id:'old'}],touchProject:(id:string)=>touches.push(id)}
 const code=transformSync(fs.readFileSync(new URL('./projectsSlice.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code
 runInNewContext(code,{module,exports:module.exports,require:()=>({}),window:{api:{projects:{addViaDialog:async()=>returned}}}})
 const slice=module.exports.createProjectsSlice((patch:any)=>{state={...state,...(typeof patch==='function'?patch(state):patch)}},()=>state)
 await slice.addProject();assert.deepEqual(touches,['new']);assert.equal(state.activeProjectId,'new')
 await slice.addProject();assert.deepEqual(touches,['new'])
})
