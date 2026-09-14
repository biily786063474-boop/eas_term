/** Renderer intent tracking only; main owns admission and validates cancellation ownership. */
export function createPendingPaneStarts(){
 const owners=new Map<string,Set<{cancel:()=>void;cancelled:boolean}>>()
 return {
  async run<T>(owner:string,create:()=>Promise<T>,cancel:()=>void):Promise<T|null>{
   const entry={cancel,cancelled:false};let group=owners.get(owner)
   if(!group){group=new Set();owners.set(owner,group)}
   group.add(entry)
   try{return await create()}catch(error){if(entry.cancelled)return null;throw error}
   finally{group.delete(entry);if(!group.size&&owners.get(owner)===group)owners.delete(owner)}
  },
  cancel(owner:string){for(const entry of owners.get(owner)??[]){if(entry.cancelled)continue;entry.cancelled=true;entry.cancel()}},
 }
}
export const pendingPaneStarts=createPendingPaneStarts()
