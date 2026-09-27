// Real project/menu and owner-checked plan IPC/store. Folder choice and model updates are fixtures.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createPlan,updateStep,getPlan} from '../resources/plugins/execution-plan/lib/store.mjs'
export async function verifyDetails(cdp,projectDir,root,waitFor){
 const out=path.join(root,'docs/verification/recent-auto-plan');fs.mkdirSync(out,{recursive:true})
 const pause=()=>new Promise(r=>setTimeout(r,400))
 const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.result.data,'base64'))}
 await cdp.eval("(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',tabs:[],maximizedNode:null,canvas:{...s.canvas,frames:[],viewport:{x:0,y:0,scale:1}}});s.setProjectMenuSort('recent');s.touchProject('t8-verify-project')})()");await pause()
 const dbl=async()=>{for(const count of [1,2]){await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:800,y:480,button:'left',clickCount:count});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:800,y:480,button:'left',clickCount:count})}await pause()}
 await dbl()
 await cdp.clickElement("[...document.querySelectorAll('.cctx-item')].find(e=>e.textContent.includes('添加项目文件夹'))",'add a new project')
 await waitFor(()=>cdp.eval("window.__store.getState().projects.some(p=>p.name==='new-project')"),{timeout:12000,desc:'real project registration'})
 const mru=await cdp.eval("({newId:window.__store.getState().projects.find(p=>p.name==='new-project').id,mru:window.__store.getState().projectMru})")
 assert.equal(mru.mru[0],mru.newId)
 await cdp.eval("(()=>{const s=window.__store.getState();window.__store.setState({canvas:{...s.canvas,frames:[]},tabs:[{id:'old-status',projectId:'t8-verify-project',root:{type:'leaf',id:'old-leaf',pane:{kind:'terminal',ptyId:'old-running'}}}],runningPtys:['old-running']})})()")
 await pause();await dbl()
 const labels=await cdp.eval("[...document.querySelectorAll('.canvas-ctxmenu .cctx-label')].map(e=>e.textContent)")
 assert.equal(labels[0],'new-project');await shot('new-project-first')
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
 const who={sessionId:'fixture-model',turnId:'t',ownerKey:'node:auto-plan-node'}
 let plan=await createPlan(projectDir,who,{title:'自动完成与收尾',steps:[{title:'已完成的步骤',criterion:'真实状态更新成功'},{title:'等待处理的步骤',criterion:'完成后自动归档'}]})
 plan=await updateStep(projectDir,who,{planId:plan.planId,stepId:plan.steps[0].stepId,status:'reported_done',expectedVersion:plan.version,evidence:'fixture verified'})
 const pane={kind:'agent',cli:'codex',cwd:projectDir},tab={id:'plan-tab',projectId:'t8-verify-project',cwd:projectDir,activeLeafId:'plan-leaf',root:{type:'leaf',id:'plan-leaf',pane}}
 const frame={id:'plan-frame',name:'自动收尾验收',projectId:'t8-verify-project',x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:'auto-plan-node',leafId:'plan-leaf',x:20,y:50,w:850,h:680}]}
 const mount=async()=>{
  await cdp.eval("(()=>{const s=window.__store.getState();window.__store.setState({tabs:[],runningPtys:[],canvas:{...s.canvas,frames:[]}})})()");await pause()
  await cdp.eval('window.api.canvas.save('+JSON.stringify({version:1,viewMode:'canvas',viewport:{x:0,y:0,scale:1},frames:[{...frame,nodes:frame.nodes.map(n=>({...n,pane}))}]})+')')
  await cdp.eval("(()=>{const s=window.__store.getState();window.__store.setState({tabs:["+JSON.stringify(tab)+"],activeTabId:'plan-tab',canvas:{...s.canvas,frames:["+JSON.stringify(frame)+"]}});s.setMaximizedNode({frameId:'plan-frame',nodeId:'auto-plan-node'})})()")
 }
 await mount()
 await waitFor(()=>cdp.eval("!!document.querySelector('.ac-plan-card')"),{timeout:12000,desc:'real plan card'})
 const card=await cdp.eval("({text:document.querySelector('.ac-plan-card').textContent,checks:[...document.querySelectorAll('.ac-plan-card-check')].map(e=>e.textContent),manual:document.querySelectorAll('button.ac-plan-card-check').length})")
 assert.equal(card.manual,0);assert.equal(card.checks[0],'✓');assert.ok(card.text.includes('1/2'));assert.ok(!card.text.includes('验收'));await shot('automatic-check')
 plan=await updateStep(projectDir,who,{planId:plan.planId,stepId:plan.steps[1].stepId,status:'blocked',expectedVersion:plan.version})
 await mount();await waitFor(()=>cdp.eval("document.querySelector('.ac-plan-card')?.textContent.includes('受阻')"),{timeout:12000,desc:'blocked remains'})
 assert.equal(getPlan(projectDir,plan.planId).status,'active')
 plan=await updateStep(projectDir,who,{planId:plan.planId,stepId:plan.steps[1].stepId,status:'in_progress',expectedVersion:getPlan(projectDir,plan.planId).version})
 plan=await updateStep(projectDir,who,{planId:plan.planId,stepId:plan.steps[1].stepId,status:'reported_done',expectedVersion:plan.version})
 await mount()
 await waitFor(()=>getPlan(projectDir,plan.planId).status==='completed',{timeout:12000,desc:'real host auto completion without acceptance'})
 await waitFor(()=>cdp.eval("!!document.querySelector('.ac-empty')&&!document.querySelector('.ac-plan-card')"),{timeout:12000,desc:'completed card cleared'})
 assert.ok(getPlan(projectDir,plan.planId).steps.every(s=>s.accepted===false));await shot('automatic-clear')
 const result={passed:true,scope:'real UI/project IPC/plan host and plugin; native folder choice and model updates fixture-controlled; no live model request',checks:['new project enters MRU immediately','recent overrides old running status','model completion shows check without acceptance buttons','blocked task remains','idle automatically completes through real host/plugin CAS','completed card disappears; history retained; acceptance not fabricated']}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('Details UI PASS',result.checks)
}
