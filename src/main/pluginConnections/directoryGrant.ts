import fs from 'node:fs'
import path from 'node:path'
/** Called only on a path returned by Electron's native directory picker. */
export function createDirectoryGrant(selected:string,access:'read'|'read-write'):string{
 const root=fs.realpathSync(selected),stat=fs.statSync(root)
 if(!path.isAbsolute(root)||!stat.isDirectory())throw Error('请选择存在的目录')
 return JSON.stringify({version:1,path:root,device:String(stat.dev),inode:String(stat.ino),access})
}
export function resolveDirectoryGrant(raw:string,access:'read'|'read-write'):{path:string;access:'read'|'read-write'}{
 const g=JSON.parse(raw)
 if(!g||g.version!==1||g.access!==access||typeof g.path!=='string'||!path.isAbsolute(g.path)||Object.keys(g).some(k=>!['version','path','device','inode','access'].includes(k)))throw Error('目录授权无效')
 const stat=fs.statSync(g.path)
 if(!stat.isDirectory()||fs.realpathSync(g.path)!==g.path||String(stat.dev)!==g.device||String(stat.ino)!==g.inode)throw Error('目录已替换或移动，请重新选择授权')
 return {path:g.path,access}
}
