// TypeSafe HTTP contract checked 2026-09-22: https://docs.typesafe.ai/api
// No retries here: host owns budgets, cancellation, and explicit authorization.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const probability=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1
const text=v=>typeof v==='string'&&v.length>0||object(v)||Array.isArray(v)
function validateRequest(r){
 if(!object(r)||!text(r.state)||typeof r.model!=='string'||!r.model||!object(r.questions))throw Error('Invalid Jev request')
 const entries=Object.entries(r.questions)
 if(!entries.length||entries.length>32)throw Error('Invalid Jev request')
 for(const [,q]of entries){
  if(!object(q)||!text(q.instructions)||!['noul','choice','score'].includes(q.type))throw Error('Invalid Jev request')
  if(q.type==='choice'&&(!object(q.criteria)||!Object.keys(q.criteria).length||Object.keys(q.criteria).length>255))throw Error('Invalid Jev request')
  if(q.type==='choice'&&Object.values(q.criteria).some(v=>v!==null&&!text(v)))throw Error('Invalid Jev request')
  if(q.type==='noul'&&q.criteria!==undefined&&(!object(q.criteria)||Object.entries(q.criteria).some(([k,v])=>!['true','false'].includes(k)||!text(v))))throw Error('Invalid Jev request')
  if(q.type==='score'&&(!Array.isArray(q.criteria)||q.criteria.length<2||q.criteria.length>10||q.criteria.some(v=>!text(v))))throw Error('Invalid Jev request')
 }
 const body=JSON.stringify({state:r.state,model:r.model,questions:r.questions})
 if(Buffer.byteLength(body)>128000)throw Error('Jev request exceeds size limit')
 return body
}
function validateResponse(r,q){
 const bad=()=>{throw Error('Invalid Jev response')}
 if(!object(r)||typeof r.model!=='string'||!object(r.answers)||!object(r.usage))bad()
 if(Object.keys(r.answers).length!==Object.keys(q).length)bad()
 for(const k of ['input_tokens','output_tokens'])if(!Number.isSafeInteger(r.usage[k])||r.usage[k]<0)bad()
 const answers=Object.create(null)
 for(const [id,question]of Object.entries(q)){
  const a=r.answers[id]
  if(!object(a)||a.type!==question.type)bad()
  if(a.type==='noul'){if(!probability(a.noul))bad();answers[id]={type:'noul',noul:a.noul};continue}
  if(!probability(a.confidence)||!object(a.probabilities))bad()
  const keys=a.type==='choice'?Object.keys(question.criteria):question.criteria.map((_,i)=>String(i))
  if(Object.keys(a.probabilities).length!==keys.length||keys.some(k=>!Object.hasOwn(a.probabilities,k)||!probability(a.probabilities[k])))bad()
  if(Math.abs(Object.values(a.probabilities).reduce((x,y)=>x+y,0)-1)>.01)bad()
  if(a.type==='choice'&&!keys.includes(a.choice))bad()
  if(a.type==='score'&&(!Number.isFinite(a.score)||a.score<0||a.score>keys.length-1||!object(a.legend)||Object.keys(a.legend).length!==keys.length||keys.some(k=>typeof a.legend[k]!=='string')))bad()
  answers[id]={type:a.type,confidence:a.confidence,probabilities:Object.fromEntries(keys.map(k=>[k,a.probabilities[k]])),...(a.type==='choice'?{choice:a.choice}:{score:a.score,legend:Object.fromEntries(keys.map(k=>[k,a.legend[k]]))})}
 }
 return {model:r.model,answers,usage:{input_tokens:r.usage.input_tokens,output_tokens:r.usage.output_tokens}}
}
export async function evaluate(request,{key,signal,fetch:transport=globalThis.fetch}={}){
 if(typeof key!=='string'||!key.trim()||/[\r\n]/.test(key))throw Error('Missing or invalid Jev credential')
 const body=validateRequest(request)
 if(signal?.aborted)throw Error('Jev request cancelled')
 const combined=AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])
 let response
 try{response=await transport('https://api.typesafe.ai/v1/systemone',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body,signal:combined})}
 catch{throw Error(combined.aborted?'Jev request cancelled or timed out':'Jev network request failed')}
 if(!response.ok)throw Error(response.status===401?'Jev authentication failed':response.status===403?'Jev access denied':response.status===429?'Jev rate limited':'Jev service request failed')
 try{
  const reader=response.body.getReader();let size=0;const chunks=[]
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();throw Error('limit')}chunks.push(value)}
  if(combined.aborted)throw Error('abort')
  return validateResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')),request.questions)
 }catch{throw Error(combined.aborted?'Jev request cancelled or timed out':'Invalid Jev response')}
}
