import {execFile} from 'node:child_process'
import path from 'node:path'
import type {ProcessTreeSnapshot} from '../../shared/runtimeResources.ts'

/** Numeric snapshots only. A best-effort live ancestry/RSS estimate, NOT private memory:
 * shared pages may be counted twice; daemonized/reparented services are outside scope.
 * This must never be used for authorization, process termination or admission control.
 */
export function aggregateProcessTree(raw:string,root:number,at:number,scale:number,exclude?:number):ProcessTreeSnapshot|null {
 if(!Number.isSafeInteger(root)||root<=0||!Number.isFinite(at)||![1,1024].includes(scale)||raw.length>4*1024*1024)return null
 const rows=new Map<number,{parent:number;bytes:number}>(),children=new Map<number,number[]>()
 for(const line of raw.trim().split(/\r?\n/)){
  const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
  if(!m)return null
  const pid=Number(m[1]),parent=Number(m[2]),bytes=Number(m[3])*scale
  if(![pid,parent,bytes].every(Number.isSafeInteger)||rows.has(pid))return null
  rows.set(pid,{parent,bytes});const list=children.get(parent)??[];list.push(pid);children.set(parent,list)
 }
 if(!rows.has(root))return null
 let residentBytes=0
 const seen=new Set<number>(),pending=[root]
 while(pending.length){
  const pid=pending.pop()!
  if(pid===exclude)continue
  if(seen.has(pid))return null // corrupted ancestry, do not publish a misleading partial total
  seen.add(pid);residentBytes+=rows.get(pid)!.bytes
  if(!Number.isSafeInteger(residentBytes))return null
  pending.push(...children.get(pid)??[])
 }
 return {sampledAt:at,scope:'app-process-tree',processCount:seen.size,residentBytes}
}

interface Capture {raw:string;scale:number;exclude?:number}
export function readProcessTable():Promise<Capture>{
 let file:string,args:string[],scale=1024
 if(process.platform==='darwin'||process.platform==='linux'){
  file='/bin/ps';args=['-axo','pid=,ppid=,rss=']
 }else if(process.platform==='win32'){
  // Only numeric columns; never request CommandLine, ExecutablePath, Name or credentials.
  file=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
  args=['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId,$_.ParentProcessId,$_.WorkingSetSize }"]
  scale=1
 }else return Promise.reject(Error('unsupported platform'))
 return new Promise((resolve,reject)=>{
  const child=execFile(file,args,{encoding:'utf8',timeout:2000,maxBuffer:4*1024*1024,windowsHide:true,shell:false},(error,stdout)=>{
   if(error)reject(Error('process metrics unavailable'))
   else resolve({raw:stdout,scale,exclude:child.pid})
  })
 })
}

/** Opt-in async reader; failure cached too. No timer, no diagnostic process until requested. */
export function createProcessTreeReader(now:()=>number,root:number,read:()=>Promise<Capture>=readProcessTable){
 let cached:ProcessTreeSnapshot|null=null,at:number|null=null,pending:Promise<void>|null=null
 return async():Promise<ProcessTreeSnapshot|null>=>{
  const time=now()
  if(!Number.isFinite(time))return null
  if(!pending&&(at===null||time<at||time-at>=5000)){
   pending=(async()=>{
    try {const result=await Promise.resolve().then(read);cached=aggregateProcessTree(result.raw,root,now(),result.scale,result.exclude)}
    catch{cached=null}
    finally{at=now();pending=null}
   })()
  }
  if(pending)await pending
  return cached?{...cached}:null
 }
}
