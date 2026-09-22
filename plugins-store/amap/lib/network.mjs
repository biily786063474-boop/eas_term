import dns from 'node:dns/promises'
import https from 'node:https'
import {validatePublicAddresses} from './address-policy.mjs'
/** Direct HTTPS only, fixed Amap endpoints. The configured Key is sent
 * only to that endpoint in its required query parameter. No redirects or
 * user-selected hosts; validated DNS is pinned at dial with original TLS SNI.
 * System PAC/proxy integration is not claimed for this stdio API adapter. */
export async function amapJSON(raw){
 const url=new URL(raw)
 if(url.origin!=='https://restapi.amap.com'||url.username||url.password||url.hash||!['/v3/geocode/geo','/v3/place/around','/v3/direction/walking','/v3/direction/driving'].includes(url.pathname))throw Error('Amap endpoint rejected')
 const signal=AbortSignal.timeout(15000)
 const answers=await new Promise((resolve,reject)=>{
  const abort=()=>reject(Error('Amap DNS timeout'))
  signal.addEventListener('abort',abort,{once:true})
  dns.lookup(url.hostname,{all:true}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
 })
 if(signal.aborted)throw Error('Amap request timeout')
 validatePublicAddresses(answers.map(a=>a.address))
 return new Promise((resolve,reject)=>{
  const request=https.request({hostname:answers[0].address,servername:url.hostname,port:443,path:url.pathname+url.search,method:'GET',agent:false,signal,headers:{Host:url.hostname,Accept:'application/json','Accept-Encoding':'identity','User-Agent':'Eas-Term-Amap/1.0 (https://eas.biily.top)'}},response=>{
   if(response.statusCode!==200){response.resume();request.destroy();reject(Error('Amap HTTP '+response.statusCode));return}
   if(!/^application\/json(?:;|$)/i.test(String(response.headers['content-type']||''))||(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')){response.resume();request.destroy();reject(Error('Amap response type rejected'));return}
   let size=0;const chunks=[]
   response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){request.destroy(Error('Amap response exceeds 1MB'));return}chunks.push(chunk)})
   response.on('error',reject);response.on('aborted',()=>reject(Error('Amap response interrupted')))
   response.on('end',()=>{try{if(size>1024*1024)throw Error();resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))))}catch{reject(Error('Amap returned invalid JSON'))}})
  })
  request.on('error',reject);request.end()
 })
}
