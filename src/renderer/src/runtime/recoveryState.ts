/** Ephemeral checkpoint data only: never localStorage or a new plaintext disk file. */
export interface RecoveryStateSnapshot {version:1;values:Record<string,unknown>}
export function createRecoveryState(maxBytes=16*1024*1024) {
 let values:Record<string,unknown>=Object.create(null)
 const copy=<T>(value:T):T=>{
  const json=JSON.stringify(value,(_key,v)=>{
   if(typeof v==='function'||typeof v==='symbol'||typeof v==='bigint')throw Error('unsupported recovery value')
   if(typeof v==='number'&&!Number.isFinite(v))throw Error('invalid recovery number')
   return v
  })
  if(typeof json!=='string'||new TextEncoder().encode(json).length>maxBytes)throw Error('recovery payload too large')
  return JSON.parse(json) as T
 }
 return {
  read<T>(key:string):T|undefined{return Object.hasOwn(values,key)?copy(values[key]) as T:undefined},
  write(key:string,value:unknown){
   if(!key||key.length>512||['__proto__','prototype','constructor'].includes(key))throw Error('invalid recovery key')
   const next={...values,[key]:copy(value)};copy(next);values=next
  },
  remove(key:string){delete values[key]},
  snapshot():RecoveryStateSnapshot{return {version:1,values:copy(values)}},
  restore(input:unknown){
   if(!input||typeof input!=='object')throw Error('invalid checkpoint')
   const s=input as RecoveryStateSnapshot
   if(s.version!==1||!s.values||typeof s.values!=='object'||Array.isArray(s.values))throw Error('invalid checkpoint')
   for(const key of Object.keys(s.values))if(!key||key.length>512||['__proto__','prototype','constructor'].includes(key))throw Error('invalid recovery key')
   values=copy(s.values)
  }
 }
}
