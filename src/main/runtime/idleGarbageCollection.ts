interface IdleDebugger {
 isAttached():boolean
 attach(version:string):void
 detach():void
 sendCommand(method:string):Promise<unknown>
 on?(event:'detach',listener:()=>void):unknown
 removeListener?(event:'detach',listener:()=>void):unknown
}
/** A timed-out or externally replaced debugger must never strand the idle runner
 * or detach another owner. This collects unreachable objects; it never reloads. */
export async function collectIdleGarbage(debuggerApi:IdleDebugger,current:()=>boolean,timeoutMs=5000):Promise<boolean>{
 if(!current()||debuggerApi.isAttached())return false
 let owned=false,timer:ReturnType<typeof setTimeout>|undefined
 const detached=()=>{owned=false}
 try{
  debuggerApi.attach('1.3');owned=true
  debuggerApi.on?.('detach',detached)
  if(!current())return false
  await Promise.race([
   debuggerApi.sendCommand('HeapProfiler.collectGarbage'),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('idle collection timeout')),timeoutMs)})
  ])
  return owned&&current()
 }finally{
  if(timer)clearTimeout(timer)
  debuggerApi.removeListener?.('detach',detached)
  if(owned&&debuggerApi.isAttached())try{debuggerApi.detach()}catch{/* window closed */}
 }
}
