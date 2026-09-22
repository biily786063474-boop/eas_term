// packageRoot is supplied by the connector, never by MCP arguments/config.
// The installed package is trusted code; hashes detect corruption, not a malicious
// writer able to replace both manifest and executable. This is not an OS sandbox.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
const MAX=12*1024*1024
export async function runEngine(packageRoot,request,{signal,timeoutMs=16000,maxOutputBytes=MAX}={}) {
 if(signal?.aborted)throw Error('Excel worker cancelled')
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>16000||!Number.isInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>MAX)throw Error('Invalid worker bounds')
 const input=JSON.stringify(request)
 if(!input||Buffer.byteLength(input)>MAX)throw Error('Excel worker request limit')
 const key=process.platform+'-'+process.arch
 if(!['darwin-arm64','darwin-x64','win32-x64'].includes(key))throw Error('Unsupported Excel worker platform')
 const root=path.resolve(packageRoot),dir=path.join(root,'bin')
 if(await fs.realpath(root)!==root||await fs.realpath(dir)!==dir)throw Error('Excel worker symlink directory')
 const manifestPath=path.join(dir,'integrity.json')
 const ms=await fs.lstat(manifestPath)
 if(!ms.isFile()||ms.size>16384)throw Error('Invalid worker integrity manifest')
 const entry=JSON.parse(await fs.readFile(manifestPath,'utf8'))[key]
 if(!entry||!Number.isInteger(entry.size)||entry.size<1||entry.size>64*1024*1024||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid worker integrity manifest')
 const binary=path.join(dir,'excel-engine-'+key+(process.platform==='win32'?'.exe':''))
 const stat=await fs.lstat(binary)
 if(!stat.isFile()||stat.nlink!==1)throw Error('Excel worker must be regular non-symlink file')
 if(stat.size!==entry.size||createHash('sha256').update(await fs.readFile(binary)).digest('hex')!==entry.sha256)throw Error('Excel worker integrity mismatch')
 if(signal?.aborted)throw Error('Excel worker cancelled')
 return new Promise((resolve,reject)=>{
  // Deliberately do not inherit plugin config, tokens, PATH, proxy or loader env.
  const child=spawn(binary,[],{cwd:dir,env:{},stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false})
  let failure,bytes=0,stderrBytes=0;const chunks=[]
  const fail=message=>{if(!failure)failure=Error(message);child.kill('SIGKILL')}
  const cancel=()=>fail('Excel worker cancelled')
  const timer=setTimeout(()=>fail('Excel worker timeout'),timeoutMs)
  signal?.addEventListener('abort',cancel,{once:true})
  if(signal?.aborted)cancel()
  child.on('error',()=>{failure ||= Error('Excel worker failed to start')})
  child.stdin.on('error',()=>fail('Excel worker input failed'))
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>maxOutputBytes)fail('Excel worker output limit');else if(!failure)chunks.push(b)})
  child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>65536)fail('Excel worker output limit')})
  // close, not exit: release ownership only after stdio descriptors close.
  child.on('close',code=>{
   clearTimeout(timer);signal?.removeEventListener('abort',cancel)
   if(failure)return reject(failure)
   if(code!==0)return reject(Error('Excel worker failed ('+code+')'))
   try{
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['workbook','value','note'].includes(k))||Object.values(value).some(v=>typeof v!=='string'))throw Error()
    if(value.workbook!==undefined){
     if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value.workbook)||value.workbook.length%4!==0)throw Error()
     const b=Buffer.from(value.workbook,'base64')
     if(b.length>8*1024*1024||b.length<4||b.readUInt32LE(0)!==0x04034b50||b.toString('base64')!==value.workbook)throw Error()
    }
    resolve(value)
   }catch{reject(Error('Invalid Excel worker response'))}
  })
  child.stdin.end(input)
 })
}
