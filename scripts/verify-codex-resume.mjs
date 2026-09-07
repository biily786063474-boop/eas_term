// 本机 Codex CLI + 回环假 Responses 服务；不使用真实账号或模型。
import assert from 'node:assert/strict'
import { codexAdapter } from '../src/main/agentChat/adapters/codex.ts'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'eas-resume-contract-'))
const requests=[]
const server=http.createServer((req,res)=>{ let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 const input=JSON.parse(body);requests.push(input);const n=requests.length;
 const item={id:'msg_'+n,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'fixture reply '+n,annotations:[]}]};
 const response={id:'resp_'+n,object:'response',created_at:1,status:'completed',model:'fixture-model',output:[item],usage:{input_tokens:20,output_tokens:5,total_tokens:25}};
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'fixture reply '+n},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
 res.end();
 })})
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const common=['--ignore-user-config','-c','model="fixture-model"','-c','model_provider="fixture"','-c','model_providers.fixture.name="Fixture"','-c','model_providers.fixture.base_url="http://127.0.0.1:'+port+'/v1"','-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false'];
let sid;const results=[];
try {for(let n=1;n<=3;n++){
 const built=codexAdapter.buildArgs({cwd:root,sandbox:'read-only',resumeId:sid});
 const args=[...built.args,...common,'fixture turn '+n];
 const out=await new Promise((resolve,reject)=>{ const p=spawn('codex',args,{cwd:root,env:{...process.env,CODEX_HOME:root},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.on('error',reject);p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);const timer=setTimeout(()=>p.kill(),20000);p.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})})});
 const events=out.stdout.split('\n').filter(Boolean).map(x=>JSON.parse(x));sid=events.find(e=>e.type==='thread.started')?.thread_id??sid;results.push({turn:n,code:out.code,session:sid,types:events.map(e=>e.type),error:out.code?out.stderr.slice(-600):undefined});if(out.code!==0)break;
}console.log(JSON.stringify({root,results,requests:requests.map(r=>({inputCount:r.input?.length,hasFirst:JSON.stringify(r.input).includes('fixture turn 1'),hasPriorReply:JSON.stringify(r.input).includes('fixture reply 1')}))},null,2));}
finally {server.close()}
assert.equal(results.length,3); assert.ok(results.every(r=>r.code===0 && r.session===sid));
assert.ok(requests.length===3 && requests.every(r=>JSON.stringify(r.input).includes('fixture turn 1')));
assert.ok(requests.slice(1).every(r=>JSON.stringify(r.input).includes('fixture reply 1')));

const contexts=fs.readdirSync(root,{recursive:true}).filter(p=>String(p).endsWith('.jsonl')).flatMap(p=>fs.readFileSync(path.join(root,String(p)),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))).filter(e=>e.type==='turn_context');
assert.equal(contexts.length,3); assert.ok(contexts.every(e=>e.payload.sandbox_policy.type==='read-only'));
