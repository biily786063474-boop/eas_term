/** Event-scoped ownership: no panel dependency and no permanent keep-alive. */
export async function withJevAutomation<T,R>(deps:{acquire:()=>Promise<T>;release:()=>void;run:(host:T)=>Promise<R>}):Promise<R>{
 const host=await deps.acquire()
 try{return await deps.run(host)}finally{deps.release()}
}
