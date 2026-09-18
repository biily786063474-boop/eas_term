import {ResultSchema} from '@modelcontextprotocol/sdk/types.js'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {validateRemoteEndpoint} from './endpointPolicy.ts'

type Options = {
 url: string
 approvedOrigins: readonly string[]
 version: string
 /** Mandatory network boundary. No global fetch fallback; host integration must provide a safe adapter. */
 fetch: NonNullable<ConstructorParameters<typeof StreamableHTTPClientTransport>[1]>['fetch']
}
/** Protocol layer only. Not yet registered with pluginHost or advertised as a supported capability. */
export class RemotePluginClient {
 private readonly client: Client
 private readonly transport: StreamableHTTPClientTransport
 private connected=false
 private closed=false
 private connecting:Promise<void>|undefined
 onNotification:((method:string,params:unknown)=>void)|null=null
 onClose:(()=>void)|null=null
 private finished=false
 private finishConnection!:()=>void
 readonly connectionClosed=new Promise<void>(resolve=>{this.finishConnection=resolve})
 private tracked=new Set<(reason:'response'|'connection-closed'|'not-started')=>void>()
 get alive(){return this.connected&&!this.closed}
 private finishClose(){
  if(this.finished)return;this.finished=true
  this.closed=true;this.connected=false
  for(const finish of this.tracked)finish('connection-closed')
  this.tracked.clear();this.finishConnection();this.onClose?.()
 }
 constructor(options:Options) {
  if (!options.fetch) throw Error('远程连接缺少安全网络适配器')
  const endpoint=validateRemoteEndpoint(options.url,options.approvedOrigins)
  this.client=new Client({name:'eas-term',version:options.version},{capabilities:{}})
  this.transport=new StreamableHTTPClientTransport(endpoint,{fetch:options.fetch,reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}})
  this.client.onclose=()=>this.finishClose()
  this.client.fallbackNotificationHandler=async notification=>{this.onNotification?.(notification.method,notification.params)}
 }
 connect():Promise<void> {
  if(this.closed)return Promise.reject(Error('远程插件连接已关闭'))
  if(this.connected)return Promise.resolve()
  if(this.connecting)return this.connecting
  this.connecting=(async()=>{
   try {
    await this.client.connect(this.transport)
    if(this.closed)throw Error('远程插件连接已关闭')
    this.connected=true
   } catch(error){await this.close();throw error}
   finally {this.connecting=undefined}
  })()
  return this.connecting
 }
 private requireConnected():void {if(!this.connected||this.closed)throw Error('远程插件未连接')}
 async listTools() {
  this.requireConnected()
  const tools=[]
  const seen=new Set<string>()
  let cursor:string|undefined
  for(let page=0;page<100;page++){
   const result=await this.client.listTools(cursor?{cursor}:{},{timeout:30_000})
   tools.push(...result.tools)
   if(tools.length>2000)throw Error('远程插件工具数量超限')
   cursor=result.nextCursor
   if(!cursor)return tools
   if(seen.has(cursor))throw Error('远程插件工具分页循环')
   seen.add(cursor)
  }
  throw Error('远程插件工具分页超限')
 }
 async callTool(name:string,args:Record<string,unknown>,signal?:AbortSignal) {
  this.requireConnected()
  // Do not retry writes after disconnect, timeout or 401. Upstream execution may already have happened.
  return this.client.callTool({name,arguments:args},undefined,{timeout:60_000,signal})
 }
 async initialize(_version:string){await this.connect()}
 async request(method:string,params:unknown,timeoutMs=30_000):Promise<unknown>{
  this.requireConnected()
  if(params!==undefined&&(typeof params!=='object'||params===null||Array.isArray(params)))throw Error('MCP参数必须为对象')
  return this.client.request({method,params:params as Record<string,unknown>|undefined},ResultSchema,{timeout:timeoutMs})
 }
 requestTracked(method:string,params:unknown,timeoutMs=30_000){
  const controller=new AbortController()
  let finish!:(reason:'response'|'connection-closed'|'not-started')=>void
  const completed=new Promise<'response'|'connection-closed'|'not-started'>(resolve=>{finish=resolve})
  if(!this.alive||this.tracked.size>=128||!Number.isFinite(timeoutMs)||timeoutMs<=0){
   finish('not-started');return {result:Promise.reject(Error('远程连接不可用或请求数超限')),completed,cancel:()=>{}}
  }
  this.tracked.add(finish)
  const result=new Promise<unknown>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('远程调用超时；上游执行结果未知，请勿自动重试')),timeoutMs)
   // Keep tracking beyond caller timeout. Abort is advisory, not remote completion proof.
   this.client.request({method,params:params as Record<string,unknown>},ResultSchema,{timeout:Math.max(timeoutMs,600_000),signal:controller.signal})
    .then(value=>{clearTimeout(timer);this.tracked.delete(finish);finish('response');resolve(value)},()=>{clearTimeout(timer);reject(Error('远程请求中断；上游执行结果未知'))})
  })
  return {result,completed,cancel:()=>controller.abort()}
 }
 async close():Promise<void> {
  if(this.closed)return
  this.closed=true;this.connected=false
  try{await this.client.close()}finally{this.finishClose()}
 }
}
