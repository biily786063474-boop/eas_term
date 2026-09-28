import {createPolicy} from './policy.mjs'
import {evaluate as defaultEvaluate} from './client.mjs'
/** Internal service, NOT an RPC surface. Only the trusted host may connect/enable. */
export function createRuntime({evaluate=defaultEvaluate,maxConcurrent=2,maxCalls=100,preferences,usage}={}){
 if(!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||!Number.isSafeInteger(maxCalls)||maxCalls<1)throw Error('Invalid runtime limits')
 const saved=preferences?.load()
 const policy=createPolicy(saved?.selected),active=new Set()
 let automationScopes=saved?.automationScopes??{milestone:[],project:[]}
 let projectIds=[...new Set(Object.values(automationScopes).flat())]
 let enabledIntent=saved?.enabledIntent===true
 const persist=(intent=enabledIntent,selected=policy.snapshot().selected)=>preferences?.save({version:2,enabledIntent:intent,selected,projectIds,automationScopes})
 let key='',calls=0,connectionIssue=null
 const abort=()=>{for(const c of active)c.abort()}
 return {
  snapshot:()=>({...policy.snapshot(),enabledIntent,connectionIssue,automationScopes:structuredClone(automationScopes),projectIds:[...projectIds],calls,pending:active.size,usage:usage?.snapshot()}),
  // Host must supply a verified credential. This method itself is not a connection test.
  connect(verifiedKey){if(typeof verifiedKey!=='string'||!verifiedKey.trim())throw Error('Invalid credential');abort();policy.setConnected(true);key=verifiedKey;connectionIssue=null;if(enabledIntent)policy.enable()},
  enable(){if(!policy.snapshot().connected)throw Error('No verified connection');persist(true);enabledIntent=true;policy.enable()},
  pause(){enabledIntent=false;policy.pause();abort();persist(false)},
  disconnect(){policy.setConnected(false);key='';abort()},
  authorizeProjects(ids,capability){if(!Array.isArray(ids)||ids.length>32||ids.some(id=>typeof id!=='string'))throw Error('Invalid authorized projects');if(!['milestone','project','all'].includes(capability))throw Error('Invalid automation capability');for(const k of ['milestone','project'])if(capability==='all'||k===capability)automationScopes[k]=[...new Set(ids)];projectIds=[...new Set(Object.values(automationScopes).flat())];policy.pause();abort();persist();if(enabledIntent&&policy.snapshot().connected)policy.enable()},
  select(capability,value){const next={...policy.snapshot().selected};if(!Object.hasOwn(next,capability))throw Error('Unknown capability');next[capability]=value===true;persist(enabledIntent,next);policy.select(capability,value);abort()},
  selectAll(value){const next=Object.fromEntries(Object.keys(policy.snapshot().selected).map(key=>[key,value===true]));persist(enabledIntent,next);policy.selectAll(value);abort()},
  async ask(capability,request,{signal}={}){
   if(signal?.aborted)throw Error('Jev request revoked')
   const ticket=policy.begin(capability)
   if(active.size>=maxConcurrent||(!usage&&calls>=maxCalls))throw Error('Jev runtime limit reached')
   const requestId=usage?.reserve(capability)
   const c=new AbortController();const cancel=()=>c.abort();signal?.addEventListener('abort',cancel,{once:true});active.add(c);calls++
   try{
    const result=await evaluate(request,{key,signal:c.signal})
    if(!policy.valid(ticket)||c.signal.aborted)throw Error('Jev request revoked')
    connectionIssue=null
    if(requestId)usage.finish(requestId,'success',result.usage)
    return result
   }catch(error){
    connectionIssue=['Jev authentication failed','Jev access denied','Jev network request failed','Jev rate limited','Jev request cancelled or timed out'].includes(error?.message)?error.message:null
    if(connectionIssue==='Jev authentication failed'||connectionIssue==='Jev access denied'){enabledIntent=false;policy.setConnected(false);key='';abort();persist(false)}
    if(requestId)usage.finish(requestId,c.signal.aborted?'revoked':'failed');throw error}finally{signal?.removeEventListener('abort',cancel);active.delete(c)}
  }
 }
}
