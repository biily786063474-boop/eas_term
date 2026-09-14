/** Main-process intent. Optional synchronous storage commits before mutating intent. */
export function createManualStopLatch(storage?:{load:()=>string[];save:(keys:string[])=>void}){
 let revision=0,loaded=false;const stopped=new Map<string,number>()
 const load=()=>{if(loaded)return;const keys=storage?.load()??[];for(const key of keys)stopped.set(key,++revision);loaded=true}
 return {
  stop(key:string){load();storage?.save([...new Set([...stopped.keys(),key])]);const stamp=++revision;stopped.set(key,stamp);return stamp},
  stamp(key:string){load();return stopped.get(key)??null},
  resume(key:string,expected:number){load();if(stopped.get(key)!==expected)return false;storage?.save([...stopped.keys()].filter(k=>k!==key));stopped.delete(key);return true}
 }
}
