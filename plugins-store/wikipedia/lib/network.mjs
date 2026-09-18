import dns from 'node:dns/promises'
import https from 'node:https'
import {validatePublicAddresses} from './address-policy.mjs'
/** Direct HTTPS only, fixed Wikipedia origins. No credentials, redirects or
 * user-selected hosts; validated DNS is pinned at dial with original TLS SNI.
 * System PAC/proxy integration is not claimed for this stdio API adapter. */
export async function wikipediaJSON(raw){
 const url=new URL(raw)
 if(!['https://en.wikipedia.org','https://zh.wikipedia.org'].includes(url.origin)||url.username||url.password||url.hash||!['/w/rest.php/v1/search/page','/w/api.php'].includes(url.pathname))throw Error('Wikipedia endpoint rejected')
 const signal=AbortSignal.timeout(15000)
 const answers=await new Promise((resolve,reject)=>{
  const abort=()=>reject(Error('Wikipedia DNS timeout'))
  signal.addEventListener('abort',abort,{once:true})
  dns.lookup(url.hostname,{all:true}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
 })
 if(signal.aborted)throw Error('Wikipedia request timeout')
 validatePublicAddresses(answers.map(a=>a.address))
 return new Promise((resolve,reject)=>{
  const request=https.request({hostname:answers[0].address,servername:url.hostname,port:443,path:url.pathname+url.search,method:'GET',agent:false,signal,headers:{Host:url.hostname,Accept:'application/json','User-Agent':'Eas-Term-Wikipedia/1.0 (https://eas.biily.top)'}},response=>{
   if(response.statusCode!==200){response.resume();request.destroy();reject(Error('Wikipedia HTTP '+response.statusCode));return}
   let size=0;const chunks=[]
   response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){request.destroy(Error('Wikipedia response exceeds 1MB'));return}chunks.push(chunk)})
   response.on('error',reject)
   response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('Wikipedia returned invalid JSON'))}})
  })
  request.on('error',reject);request.end()
 })
}
