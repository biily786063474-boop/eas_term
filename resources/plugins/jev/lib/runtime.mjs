import {createPolicy} from './policy.mjs'
import {evaluate as defaultEvaluate} from './client.mjs'
/** Internal service, NOT an RPC surface. Only the trusted host may connect/enable. */
export function createRuntime({evaluate=defaultEvaluate,maxConcurrent=2,maxCalls=100,preferences,usage}={}){
 if(!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||!Number.isSafeInteger(maxCalls)||maxCalls<1)throw Error('Invalid runtime limits')
 const policy=createPolicy(preferences?.load()),active=new Set()
 let key='',calls=0
 const abort=()=>{for(const c of active)c.abort()}
 return {
  snapshot:()=>({...policy.snapshot(),calls,pending:active.size,usage:usage?.snapshot()}),
  // Host must supply a verified credential. This method itself is not a connection test.
  connect(verifiedKey){if(typeof verifiedKey!=='string'||!verifiedKey.trim())throw Error('Invalid credential');abort();policy.setConnected(true);key=verifiedKey},
  enable(){policy.enable()},
  pause(){policy.pause();abort()},
  disconnect(){policy.setConnected(false);key='';abort()},
  select(capability,value){const next={...policy.snapshot().selected};if(!Object.hasOwn(next,capability))throw Error('Unknown capability');next[capability]=value===true;preferences?.save(next);policy.select(capability,value);abort()},
  selectAll(value){const next=Object.fromEntries(Object.keys(policy.snapshot().selected).map(key=>[key,value===true]));preferences?.save(next);policy.selectAll(value);abort()},
  async ask(capability,request,{signal}={}){
   if(signal?.aborted)throw Error('Jev request revoked')
   const ticket=policy.begin(capability)
   if(active.size>=maxConcurrent||calls>=maxCalls)throw Error('Jev runtime limit reached')
   const requestId=usage?.reserve(capability)
   const c=new AbortController();const cancel=()=>c.abort();signal?.addEventListener('abort',cancel,{once:true});active.add(c);calls++
   try{
    const result=await evaluate(request,{key,signal:c.signal})
    if(!policy.valid(ticket)||c.signal.aborted)throw Error('Jev request revoked')
    if(requestId)usage.finish(requestId,'success',result.usage)
    return result
   }catch(error){if(requestId)usage.finish(requestId,c.signal.aborted?'revoked':'failed');throw error}finally{signal?.removeEventListener('abort',cancel);active.delete(c)}
  }
 }
}
