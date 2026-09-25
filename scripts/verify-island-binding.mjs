// 隔离实例专用：9447 renderer CDP + 9448 main inspector。
// 回放公共事件，不启动真实 CLI、不修改生产源码。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const sockets=[]
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const list=async port=> (await fetch('http://127.0.0.1:'+port+'/json/list')).json()
async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws)
 await new Promise(r=>ws.onopen=r)
 let id=0;const requests=new Map()
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error(JSON.stringify(m));if(m.id){requests.get(m.id)?.(m);requests.delete(m.id)}}
 const send=async(method,params={})=>{
  const n=++id;const m=await new Promise(r=>{requests.set(n,r);ws.send(JSON.stringify({id:n,method,params}))})
  if(m.error)throw Error(JSON.stringify(m.error));return m.result
 }
 return {send,eval:async expression=>{
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value
 }}
}
const out='docs/verification/island-binding'
fs.mkdirSync(out,{recursive:true})
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'eas-island-source-'))
const transcriptDir=path.join(os.homedir(),'.claude/projects',fixture.replace(/[^a-zA-Z0-9]/g,'-'))
try{
 const main=await connect((await list(9448))[0])
 const page=await connect((await list(9447)).find(p=>p.title==='Eas-Term'))
 const electron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
 assert.equal(await page.eval('window.__easVerify'),true)
 await page.send('Runtime.enable')
 await page.eval('(()=>{const s=window.__store.getState();window.__store.setState({tabs:[],runningPtys:[],attentionPtys:[],canvas:{...s.canvas,frames:[]}})})()')
 await pause(400)
 const ids=['ac-island-a-'+Date.now(),'ac-island-b-'+Date.now()]
 const tabs=ids.map((id,i)=>({id:'tab-'+i,title:'对话'+i,projectId:'p-test',cwd:fixture,activeLeafId:'leaf-'+i,
  root:{type:'leaf',id:'leaf-'+i,pane:{kind:'agent',cli:'codex',resumeCli:'codex',sessionId:id,cwd:fixture}}}))
 const nodes=ids.map((id,i)=>({id:'node-'+i,leafId:'leaf-'+i,name:i?'AI 模块 B':'AI 模块 A',x:20+i*460,y:50,w:440,h:550}))
 await page.eval(`(()=>{const s=window.__store.getState();window.__store.setState({viewMode:'canvas',projects:[{id:'p-test',name:'同项目隔离验证',path:${JSON.stringify(fixture)},addedAt:1}],tabs:${JSON.stringify(tabs)},activeTabId:'tab-0',canvas:{...s.canvas,viewport:{x:0,y:0,scale:1},frames:[{id:'frame-test',projectId:'p-test',name:'同项目隔离验证',x:0,y:0,w:960,h:650,nodes:${JSON.stringify(nodes)}}]}})})()`)
 await pause(2200)
 await page.eval('window.api.prefs.set("island",true)')
 const emit=async(id,event)=>main.eval(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('agentChat:event',${JSON.stringify({sessionId:id,event})})`)
 await main.eval(`${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).minimize()`)
 for(const [i,id] of ids.entries()){
  await emit(id,{k:'turn.start'})
  await emit(id,{k:'text.done',text:'中间过程不应显示 '+i})
  await emit(id,{k:'exec.start',execId:'tool-'+i,label:'工具调用',detail:'private-process'})
  await emit(id,{k:'exec.done',execId:'tool-'+i,ok:true,output:'工具输出不应显示'})
  await emit(id,{k:'text.done',text:i?'B 的独立最终结果':'A 的独立最终结果'})
  await emit(id,{k:'turn.done',usage:{input:1,output:1}})
 }
 await pause(2200)
 console.log(await page.eval('JSON.stringify({r:window.__store.getState().runningPtys,a:window.__store.getState().attentionPtys})'))
 const islandTarget=(await list(9447)).find(p=>p.url.includes('island'))
 assert.ok(islandTarget,'island must open')
 const island=await connect(islandTarget)
 await island.eval('window.__states=[];window.island.onState(s=>window.__states.push(s));window.island.ready()')
 await pause(200)
 const snapshot=await island.eval('window.__states.at(-1)')
 console.log(JSON.stringify(snapshot));assert.equal(snapshot.notices.length,2)
 for(const [i,id]of ids.entries()){
  const n=snapshot.notices.find(n=>n.id.startsWith(id+':'))
  assert.equal(n.term,i?'AI 模块 B':'AI 模块 A')
  assert.equal(n.answer,i?'B 的独立最终结果':'A 的独立最终结果')
  assert.equal(n.paneKind,'agent')
 }
 const shot=await island.send('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(path.join(out,'two-modules.png'),Buffer.from(shot.data,'base64'))
 await emit(ids[1],{k:'turn.start'})
 await pause(350)
 let next=await island.eval('window.__states.at(-1)')
 assert.ok(!next.notices.some(n=>n.id.startsWith(ids[1]+':')))
 await emit(ids[1],{k:'text.done',text:'B 第二轮结果'})
 await emit(ids[1],{k:'turn.done',usage:{input:1,output:1}})
 await pause(450)
 next=await island.eval('window.__states.at(-1)')
 assert.equal(next.notices.find(n=>n.id.startsWith(ids[1]+':')).answer,'B 第二轮结果')
 assert.equal(next.notices.find(n=>n.id.startsWith(ids[0]+':')).answer,'A 的独立最终结果')
 await island.eval(`window.island.action({type:'focus',key:${JSON.stringify(ids[1])}})`)
 await pause(250)
 const focused=await page.eval('({tab:window.__store.getState().activeTabId,selected:window.__store.getState().canvas.selected})')
 assert.equal(focused.tab,'tab-1')
 fs.mkdirSync(transcriptDir)
 const now=Date.now()
 const transcript=answer=>[
  {type:'user',uuid:'u',timestamp:new Date(now-1000).toISOString(),message:{content:'本轮任务'}},
  {type:'assistant',timestamp:new Date(now-100).toISOString(),message:{content:[{type:'text',text:answer}]}}
 ].map(JSON.stringify).join('\n')
 fs.writeFileSync(path.join(transcriptDir,'terminal-a.jsonl'),transcript('终端 A 精确结果'))
 fs.writeFileSync(path.join(transcriptDir,'terminal-b.jsonl'),transcript('终端 B 精确结果'))
 const terminal=await page.eval(`Promise.all(['terminal-a','terminal-b','missing',undefined].map(id=>window.api.session.last(${JSON.stringify(fixture)},id)))`)
 assert.equal(terminal[0].answer,'终端 A 精确结果')
 assert.equal(terminal[1].answer,'终端 B 精确结果')
 assert.equal(terminal[2].found,false);assert.equal(terminal[3].found,false)
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({snapshot,next,focused,terminal},null,2))
 console.log('PASS: two AI modules, second round isolation, exact focus, bound terminal IPC and missing binding rejection')
}finally{
 for(const ws of sockets)ws.close()
 fs.rmSync(transcriptDir,{recursive:true,force:true})
 fs.rmSync(fixture,{recursive:true,force:true})
}
