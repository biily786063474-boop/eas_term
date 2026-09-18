import https from 'node:https'
import {Readable,Transform} from 'node:stream'
import type {ConnectionOptions} from 'node:tls'
import {HttpsProxyAgent} from 'https-proxy-agent'
import type {ConnectionPlan} from './networkPlan.ts'

/** Low-level sender: plan must come from planConnection. ca is only a main-process trust input. */
export function createHttpsSender(trust:Pick<ConnectionOptions,'ca'>={},headerTimeoutMs=60_000) {
 return async(plan:ConnectionPlan,init:RequestInit):Promise<Response>=>new Promise((resolve,reject)=>{
  const controller=new AbortController()
  const forwardAbort=()=>controller.abort(init.signal?.reason)
  init.signal?.addEventListener('abort',forwardAbort,{once:true})
  if(init.signal?.aborted)forwardAbort()
  const timer=setTimeout(()=>controller.abort(Error('远程响应头超时；执行结果可能未知')),headerTimeoutMs)
  const cleanup=()=>{clearTimeout(timer);init.signal?.removeEventListener('abort',forwardAbort)}
  const agent=plan.proxy?new HttpsProxyAgent(plan.proxy,{keepAlive:false,...trust,signal:controller.signal}):new https.Agent({keepAlive:false,...trust})
  const headers=Object.fromEntries(new Headers(init.headers).entries())
  const req=https.request({hostname:plan.address,port:plan.url.port||443,servername:plan.servername,path:plan.url.pathname+plan.url.search,method:init.method||'GET',headers,agent,...trust,signal:controller.signal},res=>{
   clearTimeout(timer)
   const responseHeaders=new Headers()
   for(const [k,v] of Object.entries(res.headers)){if(v!==undefined){for(const item of Array.isArray(v)?v:[v])responseHeaders.append(k,item)}}
   let bytes=0
   const limit=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(bytes>16*1024*1024)callback(Error('远程响应超过16MB上限'));else callback(null,chunk)}})
   res.on('error',error=>limit.destroy(error))
   limit.on('error',()=>{res.destroy();req.destroy()})
   limit.on('close',()=>{cleanup();res.destroy();agent.destroy()})
   const status=res.statusCode||502
   if([204,205,304].includes(status)){res.resume();res.once('end',()=>{cleanup();agent.destroy()});resolve(new Response(null,{status,headers:responseHeaders}));return}
   res.pipe(limit)
   resolve(new Response(Readable.toWeb(limit) as ReadableStream<Uint8Array>,{status,headers:responseHeaders}))
  })
  req.setTimeout(60_000,()=>req.destroy(Error('远程连接空闲超时；执行结果可能未知')))
  req.once('error',error=>{cleanup();controller.abort(error);agent.destroy();reject(error)})
  if(init.body!=null)req.write(String(init.body))
  req.end()
 })
}
