import dns from 'node:dns/promises'
import https from 'node:https'
import {validateRemoteEndpoint,validatePublicAddresses} from './address-policy.mjs'
export function validatePageURL(raw){
 if(typeof raw!=='string'||raw.length>4096)throw Error('网页URL无效')
 const url=new URL(raw),endpoint=new URL(url)
 // Query is page input, not an authorization endpoint. All host/address restrictions stay identical.
 endpoint.search='';validateRemoteEndpoint(endpoint.href,[endpoint.origin])
 return url
}
export async function fetchPage(raw){
 const signal=AbortSignal.timeout(15000)
 async function read(url){
  const answers=await new Promise((resolve,reject)=>{
   const abort=()=>reject(Error('网页DNS超时'));signal.addEventListener('abort',abort,{once:true})
   if(signal.aborted){signal.removeEventListener('abort',abort);abort();return}
   dns.lookup(url.hostname,{all:true}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
  })
  if(signal.aborted)throw Error('网页请求超时')
  validatePublicAddresses(answers.map(a=>a.address))
  return new Promise((resolve,reject)=>{
   const req=https.request({hostname:answers[0].address,servername:url.hostname,port:443,path:url.pathname+url.search,method:'GET',agent:false,signal,headers:{Host:url.hostname,Accept:'text/html,text/plain','Accept-Encoding':'identity','User-Agent':'Eas-Term-WebFetch/1.0 (https://eas.biily.top)'}},res=>{
    if([301,302,303,307,308].includes(res.statusCode)){res.resume();req.destroy();resolve({redirect:res.headers.location});return}
    if(res.statusCode!==200){res.resume();req.destroy();reject(Error('网页HTTP '+res.statusCode));return}
    const type=String(res.headers['content-type']||''),encoding=res.headers['content-encoding']
    if(!/^text\/(html|plain)(?:;|$)/i.test(type)||(encoding&&encoding!=='identity')){res.resume();req.destroy();reject(Error('不支持的网页类型或压缩编码'));return}
    let size=0;const chunks=[]
    res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){req.destroy(Error('网页超过2MB'));return}chunks.push(chunk)})
    res.on('error',reject);res.on('aborted',()=>reject(Error('网页响应中断')))
    res.on('end',()=>{try{
     if(size>2*1024*1024)throw Error('网页超过2MB')
     const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(type)?.[1]||'utf-8'
     resolve({url:url.href,contentType:type,body:new TextDecoder(charset,{fatal:true}).decode(Buffer.concat(chunks))})
    }catch{reject(Error(size>2*1024*1024?'网页超过2MB':'网页字符编码无效'))}})
   });req.on('error',reject);req.end()
  })
 }
 let url=validatePageURL(raw)
 for(let redirects=0;redirects<=5;redirects++){
  const result=await read(url)
  if(!Object.hasOwn(result,'redirect'))return result
  if(typeof result.redirect!=='string'||!result.redirect||redirects===5)throw Error('网页重定向无效或过多')
  url=validatePageURL(new URL(result.redirect,url).href)
 }
 throw Error('网页重定向过多')
}
