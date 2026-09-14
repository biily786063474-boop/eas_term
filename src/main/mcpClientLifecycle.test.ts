import {test} from 'node:test'
import assert from 'node:assert/strict'
import {McpClient} from './mcpClient.ts'
function fixture(){
 return new McpClient({name:'lifecycle-test',command:process.execPath,args:['-e',`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;if(m.method==='hang')return;setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:'done'})+'\\n'),m.method==='slow'?150:0)})`],env:{},cwd:process.cwd()})
}
test('tracked timeout rejects caller but retains lifetime until late response',async()=>{
 const c=fixture();const exit=new Promise<void>(r=>{c.onExit=()=>r()})
 try{
  await c.request('ready',{},3000)
  const call=c.requestTracked('slow',{},20);let finished=false
  void call.completed.then(()=>{finished=true})
  await assert.rejects(call.result,/超时/)
  assert.equal(finished,false)
  assert.equal(await call.completed,'response')
 }finally{c.close();await exit}
})
test('cancel notification does not invent completion; actual exit releases lifetime',async()=>{
 const c=fixture();const exit=new Promise<void>(r=>{c.onExit=()=>r()})
 try{
  await c.request('ready',{},3000)
  const call=c.requestTracked('hang',{},20);let finished=false
  void call.completed.then(()=>{finished=true})
  call.cancel();await assert.rejects(call.result,/超时/)
  assert.equal(finished,false)
  c.close();assert.equal(await call.completed,'exit')
 }finally{c.close();await exit}
})
test('serialization failure does not enqueue or leak tracked lifetime',async()=>{
 const c=fixture();const exit=new Promise<void>(r=>{c.onExit=()=>r()})
 try{
  const bad:any={};bad.self=bad
  const call=c.requestTracked('slow',bad,20)
  await assert.rejects(call.result,/circular/i)
  assert.equal(await call.completed,'not-started')
 }finally{c.close();await exit}
})
test('timed-out tracked requests are bounded and refusal never dispatches',async()=>{
 const c=fixture();const exit=new Promise<void>(r=>{c.onExit=()=>r()})
 try{
  await c.request('ready',{},3000)
  const calls=Array.from({length:128},()=>c.requestTracked('hang',{},10))
  await Promise.all(calls.map(call=>assert.rejects(call.result,/超时/)))
  const denied=c.requestTracked('hang',{},10)
  await assert.rejects(denied.result,/过多/)
  assert.equal(await denied.completed,'not-started')
  c.close();await Promise.all(calls.map(async call=>assert.equal(await call.completed,'exit')))
 }finally{c.close();await exit}
})

// 2026-09-13：插件服务器进程要接启动准入，预算只能在**真实退出**时释放。
// onExit 是回调、只能挂一个；准入那条路需要一个可 await 的承诺，且起不来（无 pid）也要落定。
test('exited 在进程真实退出时落定；起不来（无 pid）同样落定',async()=>{
 const ok=new McpClient({name:'exit-test',command:process.execPath,args:['-e','process.exit(0)'],env:process.env as Record<string,string>,cwd:process.cwd()})
 await Promise.race([ok.exited,new Promise((_,rej)=>setTimeout(()=>rej(Error('exited 没有在 5s 内落定')),5000))])
 assert.equal(ok.alive,false)
 const bad=new McpClient({name:'missing-test',command:'/nonexistent/eas-missing-binary',args:[],env:process.env as Record<string,string>,cwd:process.cwd()})
 await Promise.race([bad.exited,new Promise((_,rej)=>setTimeout(()=>rej(Error('起不来时 exited 没有落定')),5000))])
 assert.equal(bad.alive,false)
})
