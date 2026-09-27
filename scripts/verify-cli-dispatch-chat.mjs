import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
export async function verifyCliDispatchChat(cdp,projectDir,root,waitFor){
 const out=path.join(root,'docs/verification/cli-dispatch');fs.mkdirSync(out,{recursive:true})
 const checks=[]
 for(const cli of ['claude','codex','omp']){
  const sid='dispatch-'+cli
  const tabs=[{id:'dispatch-tab',title:'错峰验收',projectId:null,cwd:projectDir,activeLeafId:sid,root:{type:'leaf',id:sid,pane:{kind:'agent',cli,cwd:projectDir,sessionId:sid}}}]
  const frames=[{id:'dispatch-frame',projectId:null,name:'错峰验收',x:0,y:0,w:900,h:760,collapsed:false,nodes:[{id:'dispatch-node',leafId:sid,x:20,y:50,w:850,h:680}]}]
  await cdp.eval("(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',tabs:"+JSON.stringify(tabs)+",activeTabId:'dispatch-tab',canvas:{...s.canvas,frames:"+JSON.stringify(frames)+"}});window.__store.getState().setMaximizedNode({frameId:'dispatch-frame',nodeId:'dispatch-node'})})()")
  await waitFor(()=>cdp.eval("!!document.querySelector('.ac-toolbar')"),{timeout:12000,desc:'toolbar'})
  const push=e=>cdp.eval('window.__agentChatTestPush('+JSON.stringify(sid)+','+JSON.stringify(e)+')')
  await push({k:'dispatch.status',queued:true,position:3,generation:1})
  await waitFor(()=>cdp.eval("document.querySelector('.ac-toolbar [role=status]')?.textContent.includes('等待调度')"),{timeout:3000,desc:'visible queue status'})
  const visible=await cdp.eval("(()=>{const e=document.querySelector('.ac-toolbar [role=status]');const r=e.getBoundingClientRect();return {text:e.textContent,width:r.width,height:r.height,display:getComputedStyle(e).display}})()")
  assert.equal(await cdp.eval("!!document.querySelector('.ac-busy-hint')"),false,'queued is not model processing')
  assert.ok(visible.width>0&&visible.height>0&&visible.display!=='none')
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,cli+'-waiting.png'),Buffer.from(shot.result.data,'base64'))
  await push({k:'dispatch.status',queued:false,position:null,generation:1})
  await waitFor(()=>cdp.eval("!document.querySelector('.ac-toolbar [role=status]')?.textContent.includes('等待调度')"),{timeout:3000,desc:'queue clears'})
  checks.push({cli,...visible})
 }
 fs.writeFileSync(path.join(out,'chat-ui.json'),JSON.stringify({passed:true,scope:'real chat components with protocol event fixtures, not online models',checks},null,2))
}
