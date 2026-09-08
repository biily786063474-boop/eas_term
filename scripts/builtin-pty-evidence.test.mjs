import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {nativePtyArgs,nativePtyEvidence,shellQuote} from './builtin-pty-evidence.mjs'
const file='/tmp/中文 图片.png',tool='canvas_open_image'
const result={opened:file,as:'image',frameId:'target-frame',nodeId:'n'}
const content=[{type:'text',text:JSON.stringify(result)}]
test('PTY native evidence pairs Claude tool ID and exact fixture, ignoring model claims',()=>{
 const raw=[{type:'system',session_id:'s'},{type:'assistant',message:{content:[{type:'text',text:'DONE'},{type:'tool_use',id:'t',name:'mcp__eas-term__'+tool,input:{path:file}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'t',content}]}}].map(JSON.stringify).join('\n')
 assert.equal(nativePtyEvidence('claude',raw,file,tool).receipts.length,1)
 assert.equal(nativePtyEvidence('claude',raw,file+'wrong',tool).receipts.length,0)
 assert.equal(nativePtyEvidence('claude',JSON.stringify({type:'assistant',message:{content:[{type:'text',text:JSON.stringify(result)}]}}),file,tool).receipts.length,0)
})
test('PTY native evidence validates Codex and OMP structured execution results',()=>{
 const codex=[{type:'thread.started',thread_id:'codex-id'},{type:'item.completed',item:{id:'c',type:'mcp_tool_call',tool,arguments:{path:file},status:'completed',result:{content}}}].map(JSON.stringify).join('\n')
 assert.equal(nativePtyEvidence('codex',codex,file,tool).receipts[0].result.frameId,'target-frame')
 const omp=[{type:'session',id:'omp-id'},{type:'message_end',message:{role:'assistant',content:[{type:'toolCall',id:'o',name:'mcp__eas_term_'+tool,arguments:{path:file}}]}},{type:'tool_execution_end',toolCallId:'o',isError:false,result:{content}}].map(JSON.stringify).join('\n')
 assert.equal(nativePtyEvidence('omp',omp,file,tool).resumeId,'omp-id')
 assert.equal(nativePtyEvidence('omp',omp,file,tool).receipts.length,1)
 assert.equal(nativePtyEvidence('omp',omp.replace('"isError":false','"isError":true'),file,tool).receipts.length,0)
})
test('native arguments preserve approval policy and quote shell metacharacters as data',()=>{
 for(const cli of ['claude','codex','omp']){
  const args=nativePtyArgs(cli,'prompt','resume-id','model')
  assert.ok(args.includes('resume-id'))
  assert.ok(!args.some(arg=>/approval|bypass|yolo/.test(arg)))
 }
 const literal="中文 ' $((1+1)) `id`"
 assert.equal(execFileSync('/bin/sh',['-c','printf %s '+shellQuote(literal)],{encoding:'utf8'}),literal)
})
