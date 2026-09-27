import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {cardRead} from './executionPlanCardHost.ts'
import {completeReportedPlan} from './agentChat/executionPlanStop.ts'
// @ts-expect-error Bundled store is shipped as mjs.
import {createPlan,updateStep,cardForOwner,completePlan,getPlan} from '../../resources/plugins/execution-plan/lib/store.mjs'
const source=ts.createSourceFile('ipc.ts',fs.readFileSync(new URL('./executionPlanCardIpc.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='readWithCompletion')!
const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
for(const race of ['none','append','session-stop','owner-stop'])test('real host auto completion without acceptance, busy/blocked/CAS guarded: '+race,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'auto-plan-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const who={ownerKey:'node:a',sessionId:'s',turnId:'t'},owner={root,ownerKey:who.ownerKey}
 let busy=true,append=race==='append',reads=0
 const stoppingSessions=new Set<string>(),stoppingOwners=new Set<string>()
 let p=await createPlan(root,who,{title:'task',steps:[{title:'one',criterion:'done'},{title:'two',criterion:'done'}]})
 const request=async(method:string,_owner:unknown,args:any)=>{
  if(method==='host/card-read'){reads++;if(reads===2&&p.steps.every((s:any)=>s.status==='reported_done')&&!busy&&race==='session-stop')stoppingSessions.add('s');if(reads===2&&p.steps.every((s:any)=>s.status==='reported_done')&&!busy&&race==='owner-stop')stoppingOwners.add('owner-stop-key');return cardForOwner(root,who.ownerKey)}
  if(append){append=false;p=await updateStep(root,who,{planId:p.planId,expectedVersion:args.expectedVersion,append:[{title:'late',criterion:'not done'}]})}
  return completePlan(root,{...args,ownerKey:who.ownerKey})
 }
 const deps={resolve:()=>owner,request,isBusy:()=>busy}
 const read=runInNewContext(code+';readWithCompletion',{cardRead,completeReportedPlan,deps,resolve:deps.resolve,isBusy:deps.isBusy,requestExecutionPlanCard:request,stoppingSessions,stoppingOwners,stopKey:()=> 'owner-stop-key'})
 p=await updateStep(root,who,{planId:p.planId,stepId:p.steps[0].stepId,status:'reported_done',expectedVersion:p.version})
 p=await updateStep(root,who,{planId:p.planId,stepId:p.steps[1].stepId,status:'blocked',expectedVersion:p.version})
 busy=false;assert.equal((await read({senderId:1,sessionId:'s'})).kind,'active')
 p=await updateStep(root,who,{planId:p.planId,stepId:p.steps[1].stepId,status:'in_progress',expectedVersion:p.version})
 p=await updateStep(root,who,{planId:p.planId,stepId:p.steps[1].stepId,status:'reported_done',expectedVersion:p.version})
 busy=true;assert.equal((await read({senderId:1,sessionId:'s'})).kind,'active')
 busy=false;reads=0;assert.equal((await read({senderId:1,...(race==='owner-stop'?{nodeId:'a'}:{sessionId:'s'})})).kind,race==='none'?'empty':'active')
 const history=getPlan(root,p.planId);assert.equal(history.status,race==='none'?'completed':'active');assert.ok(history.steps.every((s:any)=>s.accepted===false))
})
