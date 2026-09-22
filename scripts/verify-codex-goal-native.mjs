// Real installed Codex + deterministic localhost Responses server. No real account/model.
import {runCodexTaskBridge} from '../mcp/codex-task-bridge.mjs'
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';import assert from 'node:assert/strict'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'eas-goal-native-'));let requests=0,threadId,child;const emitted=[],rpcWrites=[]
const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
 requests++;const n=requests
 if(n>2){res.writeHead(500);res.end();return}
 if(n===2)child.stdin.write(JSON.stringify({id:99002,method:'thread/goal/set',params:{threadId,status:'complete'}})+'\n')
 setTimeout(()=>{
 const item={id:'msg_'+n,type:'message',role:'assistant',phase:'final_answer',status:'completed',content:[{type:'output_text',text:'native goal step '+n,annotations:[]}]};const response={id:'resp_'+n,object:'response',created_at:1,status:'completed',model:'fixture-model',output:[item],usage:{input_tokens:20,output_tokens:5,total_tokens:25}};
 res.writeHead(200,{'Content-Type':'text/event-stream'});for(const e of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');res.end()
 },200)
})})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
const args=['app-server','-c','model="fixture-model"','-c','model_provider="fixture"','-c','model_providers.fixture.name="Fixture"','-c',`model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false']
child=spawn('codex',args,{cwd:home,env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b)
const write=child.stdin.write.bind(child.stdin);child.stdin.write=(chunk,...rest)=>{const m=JSON.parse(String(chunk));rpcWrites.push(m.method);const result=write(chunk,...rest);if(m.method==='turn/start')write(JSON.stringify({id:99001,method:'thread/goal/set',params:{threadId:m.params.threadId,objective:'Fixture: run exactly two native goal turns'}})+'\n');return result}
const timeout=setTimeout(()=>child.kill(),30000)
try {
 await runCodexTaskBridge({proc:child,cwd:home,prompt:'fixture start',sandbox:'read-only',emit:e=>{emitted.push(e);if(e.type==='thread.started')threadId=e.thread_id}})
 assert.equal(requests,2);assert.equal(rpcWrites.filter(x=>x==='turn/start').length,1);assert.equal(emitted.filter(e=>e.type==='turn.completed').length,1);assert.deepEqual(emitted.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text),['native goal step 1','native goal step 2'])
 console.log(JSON.stringify({passed:true,requests,userTurnStarts:1,nativeTurns:2,emitted,realCli:true,realModel:false},null,2))
}catch(e){console.error(stderr.slice(-2000));throw e}finally{clearTimeout(timeout);child.kill();await new Promise(r=>child.once('exit',r));server.close();fs.rmSync(home,{recursive:true,force:true})}
