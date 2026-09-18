import {planConnection,type ConnectionPlan} from './networkPlan.ts'
import {validateRemoteEndpoint} from './endpointPolicy.ts'
interface Dependencies {
 preparationTimeoutMs?:number
 origins:readonly string[]
 resolve:(hostname:string)=>Promise<string[]>
 proxy:(url:string)=>Promise<string>
 send:(plan:ConnectionPlan,init:RequestInit)=>Promise<Response>
}
/** Policy boundary. Sender must use plan.address without resolving the destination again. */
export function createPinnedFetch(deps:Dependencies) {
 return async(input:string|URL|Request,init:RequestInit={}):Promise<Response>=>{
  if(input instanceof Request)throw Error('远程插件网络不接受隐式 Request 凭证/请求体')
  const url=validateRemoteEndpoint(String(input),deps.origins)
  if(init.signal?.aborted)throw Error('远程请求已取消')
  const headers=new Headers(init.headers)
  for(const name of ['cookie','cookie2','proxy-authorization','host','connection','transfer-encoding','content-length']) {
   if(headers.has(name))throw Error('远程插件请求包含受限头：'+name)
  }
  if(init.body!==undefined && init.body!==null && typeof init.body!=='string' && !(init.body instanceof URLSearchParams))throw Error('远程插件请求体类型不支持')
  const body=init.body==null?undefined:String(init.body)
  if(body && Buffer.byteLength(body)>1024*1024)throw Error('远程插件请求体超限')
  // OS DNS/PAC APIs cannot be cancelled here. Detach their result on cancellation;
  // importantly, no send continuation is attached to those underlying operations.
  const [addresses,proxy]=await new Promise<[string[],string]>((resolve,reject)=>{
   const signal=init.signal
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
   const abort=()=>{cleanup();reject(Error('远程请求已取消'))}
   const timer=setTimeout(()=>{cleanup();reject(Error('远程 DNS/代理解析超时'))},deps.preparationTimeoutMs??15_000)
   signal?.addEventListener('abort',abort,{once:true})
   if(signal?.aborted){abort();return}
   Promise.all([Promise.resolve().then(()=>deps.resolve(url.hostname)),Promise.resolve().then(()=>deps.proxy(url.href))])
    .then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)})
  })
  if(init.signal?.aborted)throw Error('远程请求已取消')
  const plan=planConnection(url.href,deps.origins,addresses,proxy)
  headers.set('host',url.host)
  const response=await deps.send(plan,{...init,body,headers,redirect:'manual',credentials:'omit'})
  if(response.status>=300 && response.status<400){await response.body?.cancel();throw Error('远程插件请求禁止自动跳转')}
  return response
 }
}
