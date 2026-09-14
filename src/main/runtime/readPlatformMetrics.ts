import os from 'node:os'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { parseMacMemory, parseLinuxMemory, parseMacPressure } from './platformMetrics.ts'
const exec=promisify(execFile)
let usableCached:Promise<{stdout:string}>|null=null
/** Explicit one-shot read, never auto-started. One in-flight read per instance.
 * No user command, shell or environment copied to output; mac helper bounded 1s.
 */
export function createPlatformReader(){
 let pending:ReturnType<typeof capture>|null=null
 async function capture(){
  const total=os.totalmem()
  let used:number|null=null,method='unsupported'
  let memoryPressure:'normal'|'warning'|'critical'|null=null
  try{
   if(process.platform==='darwin'){
    const [{stdout},{stdout:usableRaw},{stdout:pressureRaw}]=await Promise.all([
     exec('/usr/bin/vm_stat',[],{timeout:1000,maxBuffer:64*1024,env:{LC_ALL:'C',LANG:'C'}}),
     usableCached??exec('/usr/sbin/sysctl',['-n','hw.memsize_usable'],{timeout:1000,maxBuffer:1024,env:{LC_ALL:'C',LANG:'C'}}).then(r=>{usableCached=Promise.resolve(r);return r}), // 硬件常量，读一次就够（2026-09-14 审查：原来每秒三次 fork）
     exec('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level'],{timeout:1000,maxBuffer:1024,env:{LC_ALL:'C',LANG:'C'}})
    ])
    memoryPressure=parseMacPressure(pressureRaw)
    const usable=/^\d+\s*$/.test(usableRaw)?Number(usableRaw.trim()):NaN
    used=parseMacMemory(stdout,total,usable);method='mac-resident-estimate'
   }else if(process.platform==='linux'){
    const parsed=parseLinuxMemory(await readFile('/proc/meminfo','utf8'))
    if(parsed&&parsed.total===total)used=parsed.used
    method='linux-memavailable'
   }else if(process.platform==='win32'){
    const free=os.freemem();if(Number.isFinite(free)&&free>=0&&free<=total)used=total-free
    method='windows-free'
   }
  }catch{used=null}
  const cpus=os.cpus()
  return Object.freeze({at:performance.now(),platform:process.platform,arch:process.arch,logicalCpus:cpus.length,totalMemoryBytes:total,memoryUsedBytes:used,memoryMethod:method,
   // Tested Darwin 25 arm64 estimate, with separate pressure signal; other platforms fail closed.
   memoryAdmissionVerified:process.platform==='darwin'&&process.arch==='arm64'&&os.release().startsWith('25.')&&used!==null&&memoryPressure!==null,memoryPressure,cpuTicks:cpus.map(c=>({...c.times}))})
 }
 return {read(){pending??=capture().finally(()=>{pending=null});return pending}}
}
