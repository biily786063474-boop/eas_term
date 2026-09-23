import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from './client.mjs'
const request={state:'fixture',model:'jev-latest',questions:{check:{type:'noul',instructions:'Is this a fixture?'}}}
test('no credential or invalid input never sends',async()=>{
 let calls=0;const fetch=async()=>{calls++;throw Error('unexpected')}
 await assert.rejects(evaluate(request,{key:'',fetch}),/credential/)
 await assert.rejects(evaluate({...request,questions:{}},{key:'secret',fetch}),/request/)
 assert.equal(calls,0)
})
test('fixed destination and no redirects; valid answer returns',async()=>{
 const result=await evaluate(request,{key:'secret',fetch:async(url,init)=>{
 assert.equal(url,'https://api.typesafe.ai/v1/systemone')
 assert.equal(init.redirect,'error')
 assert.equal(init.headers.Authorization,'Bearer secret')
 return new Response(JSON.stringify({model:'fixture',answers:{check:{type:'noul',noul:.8}},usage:{input_tokens:10,output_tokens:1}}))
 }})
 assert.equal(result.answers.check.noul,.8)
})
test('provider and network failures never disclose raw diagnostics',async()=>{
 await assert.rejects(evaluate(request,{key:'secret',fetch:async()=>new Response('secret',{status:401})}),e=>e.message==='Jev authentication failed')
 await assert.rejects(evaluate(request,{key:'secret',fetch:async()=>{throw Error('secret')}}),e=>e.message==='Jev network request failed')
})
test('missing, wrong-type, out-of-range and invented choices rejected',async()=>{
 for(const answer of [{type:'noul',noul:2},{type:'choice',choice:'x'},null]){
 await assert.rejects(evaluate(request,{key:'s',fetch:async()=>new Response(JSON.stringify({model:'m',answers:{check:answer},usage:{input_tokens:1,output_tokens:0}}))}),/response/)
 }
})
test('pre-aborted request is never sent',async()=>{
 const abort=new AbortController();abort.abort();let calls=0
 await assert.rejects(evaluate(request,{key:'s',signal:abort.signal,fetch:async()=>{calls++;return new Response()}}),/cancelled/)
 assert.equal(calls,0)
})

test('choice and score contracts accept complete distributions and drop unrecognized response fields',async()=>{
 for(const question of [{type:'choice',instructions:'Choose',criteria:{a:null,b:'B'}},{type:'score',instructions:'Rate',criteria:['Low','High']}]){
  const answer=question.type==='choice'?{type:'choice',choice:'b',probabilities:{a:.1,b:.9},confidence:.8,debug:'private'}:{type:'score',score:.9,probabilities:{0:.1,1:.9},legend:{0:'Low',1:'High'},confidence:.8,debug:'private'}
  const result=await evaluate({...request,questions:{q:question}},{key:'fixture',fetch:async()=>new Response(JSON.stringify({model:'m',answers:{q:answer},usage:{input_tokens:1,output_tokens:1}}))})
  assert.equal(JSON.stringify(result).includes('private'),false)
  delete answer.probabilities[Object.keys(answer.probabilities)[0]]
  await assert.rejects(evaluate({...request,questions:{q:question}},{key:'fixture',fetch:async()=>new Response(JSON.stringify({model:'m',answers:{q:answer},usage:{input_tokens:1,output_tokens:1}}))}),/response/)
 }
})
