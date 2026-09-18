import fs from 'node:fs'
// Shared commit gate: an acknowledged revoke cannot be followed by an older write.
// Fail closed on contention (including an abandoned lock); never guess lock ownership.
export function withEventGrantLock(file, action) {
 const lock=file+'.commit-lock'
 let fd
 try {fd=fs.openSync(lock,'wx',0o600)} catch(e) {
  if(e.code==='EEXIST')throw Error('记录授权正在提交或锁未释放，请稍后重试；持续失败需检查授权锁')
  throw e
 }
 try {return action()} finally {fs.closeSync(fd);fs.unlinkSync(lock)}
}
export function captureAuthorized(file,name,epoch,projectId,action) {
 if(!file || !epoch)return {captured:false,revoked:true}
 return withEventGrantLock(file,()=>{
  const g=JSON.parse(fs.readFileSync(file,'utf8'))[name]
  if(!g?.enabled || g.epoch!==epoch || !Array.isArray(g.excluded) || g.excluded.includes(projectId))return {captured:false,revoked:true}
  return action()
 })
}
