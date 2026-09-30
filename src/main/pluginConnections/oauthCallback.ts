import { tm } from '../../shared/i18n/current.ts'
import http from 'node:http'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import type {AddressInfo} from 'node:net'

interface Options {issuer:string;resource:string;timeoutMs?:number}
interface AuthorizationCode {code:string;issuer:string;resource:string;redirectUri:string}
/** Main-process-only primitive. Caller owns the attempt and must cancel on lock/unload.
 * Does not open a browser, exchange/store tokens, or establish provider trust.
 * Requires issuer identification in the response; unsupported providers fail closed.
 */
export async function startOAuthCallback(options:Options) {
 const {issuer,resource,timeoutMs=180_000}=options
 const state=randomBytes(32).toString('base64url')
 const path='/oauth/callback/'+randomBytes(16).toString('hex')
 let redirectUri='',settled=false
 let timer:ReturnType<typeof setTimeout>|undefined
 let resolve!:(value:AuthorizationCode)=>void,reject!:(error:Error)=>void
 const result=new Promise<AuthorizationCode>((yes,no)=>{resolve=yes;reject=no})
 // A browser-launch failure can precede caller awaiting result; still return the rejecting promise.
 void result.catch(()=>{})
 const stop=()=>{clearTimeout(timer);server.close();server.closeAllConnections()}
 const cancel=()=>{if(settled)return;settled=true;stop();reject(Error(tm('errPlugin.conn.e28')))}
 const server=http.createServer({maxHeaderSize:8192},(req,res)=>{
  const reply=(status:number,text:string)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','connection':'close','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end(text)}
  if(settled){reply(410,tm('errPlugin.conn.e71'));return}
  if(req.method!=='GET'||req.headers.host!==new URL(redirectUri).host||!req.url?.startsWith(path+'?')||req.url.length>8192){reply(400,tm('errPlugin.conn.e72'));return}
  const url=new URL(req.url,redirectUri),q=url.searchParams
  if(url.pathname!==path||[...q.keys()].some(key=>q.getAll(key).length!==1)){reply(400,tm('errPlugin.conn.e72'));return}
  const received=Buffer.from(q.get('state')||'')
  if(received.length!==state.length||!timingSafeEqual(received,Buffer.from(state))||q.get('iss')!==issuer){reply(400,tm('errPlugin.conn.e73'));return}
  const code=q.get('code'),error=q.get('error')
  if((!code&&!error)||(code&&error)){reply(400,tm('errPlugin.conn.e74'));return}
  settled=true;clearTimeout(timer)
  // Close listening immediately; let this response flush before destroying remaining sockets.
  server.close()
  res.once('finish',()=>server.closeAllConnections())
  if(error){reply(400,tm('errPlugin.conn.e75'));reject(Error(tm('errPlugin.conn.e76')));return}
  reply(200,tm('errPlugin.conn.e77'))
  resolve({code:code!,issuer,resource,redirectUri})
 })
 server.requestTimeout=10_000;server.headersTimeout=10_000;server.setTimeout(10_000,socket=>socket.destroy())
 await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',no);yes()})})
 redirectUri='http://127.0.0.1:'+(server.address() as AddressInfo).port+path
 timer=setTimeout(()=>{if(settled)return;settled=true;stop();reject(Error(tm('errPlugin.conn.e78')))},timeoutMs)
 return {state,redirectUri,result,cancel}
}
