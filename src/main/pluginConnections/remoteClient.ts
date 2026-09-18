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
 constructor(options:Options) {
  if (!options.fetch) throw Error('远程连接缺少安全网络适配器')
  const endpoint=validateRemoteEndpoint(options.url,options.approvedOrigins)
  this.client=new Client({name:'eas-term',version:options.version},{capabilities:{}})
  this.transport=new StreamableHTTPClientTransport(endpoint,{fetch:options.fetch,reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}})
  this.client.onclose=()=>{this.connected=false}
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
 async close():Promise<void> {
  if(this.closed)return
  this.closed=true;this.connected=false
  await this.client.close()
 }
}
