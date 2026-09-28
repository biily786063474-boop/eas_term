// 隔离实例专用：9457 renderer CDP + 9458 main inspector。
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
const out='docs/verification/retry-recovery'
fs.mkdirSync(out,{recursive:true})
try {
 const main=await connect((await list(9458))[0])
 const page=await connect((await list(9457)).find(p=>p.title==='Eas-Term'))
 assert.equal(await page.eval('window.__easVerify'),true)
 const sid='ac-retry-recovery', cwd=process.cwd()
 const tab={id:'retry-tab',title:'恢复状态验收',projectId:null,cwd,activeLeafId:'retry-leaf',root:{type:'leaf',id:'retry-leaf',pane:{kind:'agent',cli:'codex',sessionId:sid,cwd}}}
 await page.eval('(()=>{const s=window.__store.getState();window.__store.setState({viewMode:"canvas",tabs:['+JSON.stringify(tab)+'],activeTabId:"retry-tab",canvas:{...s.canvas,frames:[{id:"retry-frame",name:"恢复状态验收",x:0,y:0,w:1000,h:750,nodes:[{id:"retry-node",leafId:"retry-leaf",x:20,y:40,w:900,h:650}]}]}});window.__store.getState().setMaximizedNode({frameId:"retry-frame",nodeId:"retry-node"})})()')
 await pause(2500)
 const target="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'))"
 const emit=e=>main.eval(target+".webContents.send('agentChat:event',"+JSON.stringify({sessionId:sid,event:e})+")")
 const text=()=>page.eval('document.body.innerText')
 const shot=async name=>{const r=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
 await emit({k:'turn.start'})
 await emit({k:'retry.status',attempt:1,max:5});await pause(300)
 assert.match(await text(),/连接波动，正在恢复/);await shot('before')
 await emit({k:'session.ready',sessionId:'retry-thread',model:'',cwd});await pause(150)
 assert.match(await text(),/连接波动，正在恢复/)
 await emit({k:'text.delta',text:'连接已经恢复，继续处理当前任务。'});await pause(300)
 assert.doesNotMatch(await text(),/连接波动，正在恢复/);assert.match(await text(),/正在处理/);await shot('after')
 await emit({k:'retry.status',attempt:2,max:5});await pause(150)
 assert.match(await text(),/正在恢复（2\/5）/)
 await emit({k:'exec.start',execId:'read',label:'继续读取文件',detail:''});await pause(250)
 assert.doesNotMatch(await text(),/连接波动，正在恢复/);assert.match(await text(),/正在处理/)
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({handshakeRetainsRetry:true,textResumesProcessing:true,secondRetryVisible:true,executionResumesProcessing:true,mode:'isolated public event replay'},null,2))
 console.log('PASS: retry → handshake still retry → text resumes processing → retry again → execution resumes processing')
} finally { for(const ws of sockets)ws.close() }
