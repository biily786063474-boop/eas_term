import {createHash} from 'node:crypto'
/** Digest is only stored inside the existing encrypted, scope-bound credential store. */
export const configurationDigest=(environment:string)=>createHash('sha256').update(environment).digest('hex')
/** One coordinator per hosted process; revoke is terminal for that process. */
export function createJevRecovery(deps:{restore:()=>Promise<void>;stop:()=>void}){
 let revoked=false,pending:Promise<void>|undefined
 return {
  recover():Promise<void>{
   if(revoked)return Promise.resolve()
   if(pending)return pending
   pending=deps.restore().then(()=>{if(revoked)deps.stop()}).finally(()=>{pending=undefined})
   return pending
  },
  revoke(){revoked=true;deps.stop()}
 }
}
