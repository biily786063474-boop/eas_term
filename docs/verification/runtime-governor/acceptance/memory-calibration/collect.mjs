// Read-only bounded calibration capture; no stress, purge, privileged APIs or process control.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import os from 'node:os'
const exec=promisify(execFile)
for(let i=0;i<5;i++){
 const before=new Date().toISOString()
 const {stdout}=await exec('/usr/bin/vm_stat',[],{timeout:1000,maxBuffer:65536,env:{LANG:'C',LC_ALL:'C'}})
 const page=Number(stdout.match(/page size of (\d+)/)?.[1]),total=os.totalmem()
 const count=name=>{const m=stdout.match(new RegExp('^'+name+':\\s+(\\d+)\\.\\s*$','m'));return m?Number(m[1]):null}
 const keys=['Pages free','Pages active','Pages inactive','Pages speculative','Pages wired down','Pages purgeable','File-backed pages','Anonymous pages','Pages occupied by compressor','Pages tag-storage','Pages tag-storage holding tags','Pages tag-storage free','Pages tag-storage non-tag pageable','Pages tag-storage non-tag wired']
 const pages=Object.fromEntries(keys.map(k=>[k,count(k)]))
 const required=['Anonymous pages','Pages wired down','Pages occupied by compressor','Pages purgeable']
 const {stdout:usableRaw}=await exec('/usr/sbin/sysctl',['-n','hw.memsize_usable'],{timeout:1000,maxBuffer:1024})
 const usable=Number(usableRaw.trim())
 const estimated=required.every(k=>pages[k]!==null)?(pages['Anonymous pages']+pages['Pages wired down']+pages['Pages occupied by compressor']-pages['Pages purgeable'])*page+(total-usable):null
 console.log(JSON.stringify({before,after:new Date().toISOString(),platform:os.release(),pageBytes:page,totalBytes:total,usableBytes:usable,estimatedUsedBytes:estimated,pages}))
 if(i<4)await new Promise(r=>setTimeout(r,1000))
}
