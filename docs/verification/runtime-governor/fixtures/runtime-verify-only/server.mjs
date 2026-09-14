import readline from 'node:readline'
const pending=new Map()
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n')
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line)
 if(m.method==='notifications/cancelled'){
  const id=m.params?.requestId,t=pending.get(id)
  if(t){clearTimeout(t);pending.delete(id);reply(id,{content:[{type:'text',text:'cancelled'}]})}return
 }
 if(m.id===undefined)return
 if(m.method==='tools/call'){pending.set(m.id,setTimeout(()=>{pending.delete(m.id);reply(m.id,{content:[{type:'text',text:'completed'}]})},120000));return}
 const result=m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'runtime-verify-only',version:'1'}}:m.method==='tools/list'?{tools:[{name:'verify_wait',description:'Local cancellable wait; no external effects',inputSchema:{type:'object',properties:{}}}]}:{}
 reply(m.id,result)
})
setTimeout(()=>process.exit(0),600000).unref()
