import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {setTimeout as sleep} from 'node:timers/promises'
export async function verifyProjectMenu(cdp, root, waitFor) {
 const out=path.join(root,'docs/verification/project-menu-priority');fs.mkdirSync(out,{recursive:true})
 const ids=['idle','runA','approval','runB','done']
 const projects=ids.map(id=>({id,name:id,path:'/tmp/menu-'+id}))
 const tabs=['runA','approval','runB','done'].map(id=>({id:'tab-'+id,projectId:id,title:id,root:{type:'leaf',id:'leaf-'+id,pane:{kind:'terminal',ptyId:'pty-'+id}}}))
 // mixed project: waiting for approval in one pane, running in another
 tabs.push({id:'mixed',projectId:'runA',title:'mixed',root:{type:'leaf',id:'mixed-leaf',pane:{kind:'terminal',ptyId:'pty-mixed'}}})
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
 await cdp.eval('(()=>{const s=window.__store.getState();const patch='+JSON.stringify({projects,tabs,viewMode:'canvas',maximizedNode:null,runningPtys:['pty-runA','pty-runB'],attentionPtys:['pty-approval','pty-done','pty-mixed'],ptyApproval:{'pty-approval':true,'pty-mixed':true},projectMru:['done','runB','idle'],canvas:{frames:[],shapes:[],viewport:{x:0,y:0,scale:1}}})+';patch.canvas={...s.canvas,...patch.canvas};window.__store.setState(patch)})()')
 const labels=()=>cdp.eval("[...document.querySelectorAll('.canvas-ctxmenu .cctx-label')].map(e=>e.textContent).filter(t=>!t.includes('添加项目'))")
 const open=async(mode)=>{
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
  await cdp.eval('window.__store.getState().setProjectMenuSort('+JSON.stringify(mode)+')');await sleep(200)
  for(const count of [1,2]) for(const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,x:800,y:400,button:'left',clickCount:count})
  await waitFor(()=>cdp.eval("!!document.querySelector('.cctx-search')"),{timeout:5000,desc:'project menu'})
 }
 await open('default');assert.deepEqual(await labels(),['runA','runB','idle','approval','done'])
 await cdp.clickElement("document.querySelectorAll('.cctx-act')[1]",'recent sort');await sleep(250);assert.deepEqual(await labels(),['runB','runA','done','idle','approval'])
 await cdp.clickElement("document.querySelector('.cctx-search')",'search projects')
 await cdp.send('Input.insertText',{text:'run'});await sleep(200)
 assert.deepEqual(await labels(),['runB','runA'])
 await open('recent')
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'running-first.png'),Buffer.from(shot.result.data,'base64'))
 await cdp.eval("window.__store.setState({runningPtys:['pty-runA']})");await sleep(300)
 assert.deepEqual(await labels(),['runA','done','runB','idle','approval'])
 await cdp.eval("window.__store.setState({runningPtys:[]})");await sleep(300)
 assert.deepEqual(await labels(),['done','runB','idle','runA','approval'])
 await cdp.eval("window.__store.setState({runningPtys:['pty-runB']})");await sleep(300)
 assert.deepEqual(await labels(),['runB','done','idle','runA','approval'])
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
 const result={passed:true,checks:['default running first','recent running first, group recency','mixed running/approval project pinned','open menu updates after stop','no running returns to normal order','newly running moves to top live','header click changes sort','search preserves running order'],scope:'real renderer with controlled task-state fixture, no model calls'}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(result)
}
