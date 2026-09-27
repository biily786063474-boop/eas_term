import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {setTimeout as sleep} from 'node:timers/promises'
export async function verifyNodeSize(cdp,projectDir,root,waitFor){
 const out=path.join(root,'docs/verification/chat-node-size');fs.mkdirSync(out,{recursive:true})
 const results=[]
 for(const size of [{width:1440,height:900,scale:1},{width:700,height:500,scale:1},{width:1000,height:700,scale:2}]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:1,mobile:false})
  await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:[],activeTabId:null,canvas:{...s.canvas,viewport:{x:0,y:0,scale:'+size.scale+'},frames:[{id:"size-frame",projectId:null,name:"新建 AI 对话 · 默认尺寸",x:0,y:0,w:300,h:200,collapsed:false,nodes:[]}]}})})()')
  await sleep(200)
  await cdp.eval('window.__store.getState().addAgentNode("size-frame",{cli:"codex",cwd:'+JSON.stringify(projectDir)+'})')
  await waitFor(()=>cdp.eval('!!document.querySelector(".agent-chat-view")'),{timeout:12000,desc:'new chat node'})
  const state=await cdp.eval('(()=>{const s=window.__store.getState();const n=s.canvas.frames[0].nodes[0];const v=document.querySelector(".canvas-viewport");s.focusCanvasNode("size-frame",n.id);return {n,vw:v.clientWidth,vh:v.clientHeight}})()')
  assert.equal(state.n.w,Math.min(768,Math.floor((state.vw-32)/size.scale-32)))
  assert.equal(state.n.h,Math.min(456,Math.floor((state.vh-32)/size.scale-100)))
  await sleep(350)
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'size-'+size.width+'-'+size.scale+'.png'),Buffer.from(shot.result.data,'base64'))
  await cdp.eval('window.__store.getState().addAgentNode("size-frame",{cli:"codex",cwd:'+JSON.stringify(projectDir)+'})')
  const existing=await cdp.eval('window.__store.getState().canvas.frames[0].nodes[0]')
  assert.deepEqual(existing,state.n,'adding a chat preserves existing geometry')
  results.push({...size,...state})
 }
 // Full active toolbar must remain within narrow new nodes, not just the node shell.
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false})
 const caps={contextUsage:true,approval:[],models:[{id:'test-model',label:'A long model label for responsive verification'}],effortLevels:[{id:'low',label:'低'},{id:'high',label:'高'}],compact:'slash'}
 await cdp.eval('window.__agentChatTestSetup('+JSON.stringify({clis:[{id:'codex',displayName:'Codex',available:true,chatSupported:true,capabilities:caps}]})+')')
 const sid='node-size-active'
 const tabs=[{id:'active-tab',projectId:null,title:'窄屏输入控件',cwd:projectDir,activeLeafId:sid,root:{type:'leaf',id:sid,pane:{kind:'agent',cwd:projectDir,cli:'codex',sessionId:sid}}}]
 await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({tabs:'+JSON.stringify(tabs)+',activeTabId:"active-tab",canvas:{...s.canvas,viewport:{x:200,y:30,scale:1},frames:[{id:"active-frame",projectId:null,name:"窄屏输入控件",x:0,y:0,w:484,h:680,collapsed:false,nodes:[{id:"active-node",leafId:"node-size-active",x:16,y:50,w:452,h:600}]}]}})})()')
 await waitFor(()=>cdp.eval('!!document.querySelector(".ac-composer-bar")'),{timeout:12000,desc:'active narrow composer'})
 await cdp.eval('window.__agentChatTestPush("node-size-active",{k:"session.ready",sessionId:"node-size-active",capabilities:'+JSON.stringify(caps)+'})')
 await sleep(500)
 const controls=await cdp.eval(`(()=>{const bar=document.querySelector('.ac-composer-bar'),b=bar.getBoundingClientRect();return {wrap:getComputedStyle(bar).flexWrap,children:[...bar.querySelectorAll('button,select,.ac-effort-slider')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.className,inside:r.left>=b.left-1&&r.right<=b.right+1}})}})()`)
 assert.equal(controls.wrap,'wrap','narrow composer must wrap controls')
 assert.ok(controls.children.length>=3,'model/effort/action controls present')
 assert.ok(controls.children.every(c=>c.inside),JSON.stringify(controls))
 const narrowShot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'narrow-controls.png'),Buffer.from(narrowShot.result.data,'base64'))
 results.push({narrowControls:controls})
 await cdp.eval('(()=>{const s=window.__store.getState();window.__store.setState({tabs:s.tabs.map(t=>({...t,activeLeafId:"size-startup",root:{...t.root,id:"size-startup",pane:{kind:"agent",cli:"codex",cwd:'+JSON.stringify(projectDir)+'}}})),canvas:{...s.canvas,frames:s.canvas.frames.map(f=>({...f,nodes:f.nodes.map(n=>({...n,leafId:"size-startup"}))}))}})})()')
 await waitFor(()=>cdp.eval('!!document.querySelector(".ac-startup-controls")'),{timeout:12000,desc:'narrow startup controls'})
 assert.equal(await cdp.eval('getComputedStyle(document.querySelector(".ac-startup-controls")).flexWrap'),'wrap','startup narrow controls wrap')

 await cdp.send('Emulation.clearDeviceMetricsOverride')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,results},null,2))
}
