import fs from 'node:fs'
import path from 'node:path'
/** Registered local images only. No symlink escape, remote fetch or inline markup. */
export function pluginIconData(root:string,iconPath?:string):string|undefined{
 if(!iconPath)return undefined
 try{
  const file=fs.realpathSync(iconPath),rel=path.relative(fs.realpathSync(root),file)
  if(rel.startsWith('..')||path.isAbsolute(rel))return undefined
  const mime:Record<string,string>={'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}
  const type=mime[path.extname(file).toLowerCase()]
  if(!type||!fs.statSync(file).isFile()||fs.statSync(file).size>131072)return undefined
  const data=fs.readFileSync(file)
  return data.length<=131072?'data:'+type+';base64,'+data.toString('base64'):undefined
 }catch{return undefined}
}
