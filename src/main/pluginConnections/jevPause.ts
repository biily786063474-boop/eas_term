/** If plugin intent cannot persist, remove only its recovery proof before stopping. */
export async function pauseJevSafely<T>(deps:{pause:()=>Promise<T>;blockRecovery:()=>void;stop:()=>void}):Promise<T>{
 try{return await deps.pause()}
 catch{
  try{deps.blockRecovery()}catch{throw Error('暂停状态未保存且无法阻断自动恢复；当前连接已停止。请修复磁盘权限后重新暂停，修复前不要重启软件。')}finally{deps.stop()}
  throw Error('暂停状态未能保存，已阻断 Jev 自动恢复；请检查磁盘后重新连接。')
 }
}
