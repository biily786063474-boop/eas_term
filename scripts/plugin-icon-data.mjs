// Registry icon encoder. Pure + local: reads one file inside a plugin dir, never touches the network.
// The icon travels inside registry.json as a data: URL (renderer CSP allows data:, eas.biily.top is already allow-listed).
import fs from 'node:fs'
import path from 'node:path'
export const MAX_ICON_BYTES=32*1024
const MIME={'.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}
/** Accept only inert SVG: no script/foreignObject, no on* handlers, no javascript:, no external or data: href. Local #fragment refs are fine. */
export function svgIsSafe(text){
 if(/<\s*script/i.test(text)||/<\s*foreignObject/i.test(text))return false
 if(/\son[a-z]+\s*=/i.test(text)||/javascript\s*:/i.test(text))return false
 for(const m of text.matchAll(/(?:xlink:)?href\s*=\s*(["']?)([^"'\s>]*)\1/gi))if(!m[2].startsWith('#'))return false
 if(/url\(\s*["']?\s*(?!#)/i.test(text))return false
 return true
}
/** @returns {{dataUrl:string}|{dataUrl:undefined,reason:string}} */
export function encodePluginIcon(pluginDir,rel){
 const skip=reason=>({dataUrl:undefined,reason})
 if(typeof rel!=='string'||!rel.trim())return skip('未声明图标')
 try{
  const root=fs.realpathSync(pluginDir),abs=path.resolve(root,rel)
  const inside=p=>{const r=path.relative(root,p);return !r.startsWith('..')&&!path.isAbsolute(r)}
  if(!inside(abs))return skip('图标路径跳出插件目录')
  if(fs.lstatSync(abs).isSymbolicLink())return skip('图标不可为符号链接')
  const real=fs.realpathSync(abs)
  if(!inside(real))return skip('图标路径跳出插件目录')
  const type=MIME[path.extname(real).toLowerCase()]
  if(!type)return skip('图标类型不支持（仅 svg/png/webp/jpeg）')
  const st=fs.statSync(real)
  if(!st.isFile())return skip('图标不是文件')
  if(st.size>MAX_ICON_BYTES)return skip(`图标超过 ${MAX_ICON_BYTES/1024}KB`)
  const data=fs.readFileSync(real)
  if(type==='image/svg+xml'&&!svgIsSafe(data.toString('utf8')))return skip('svg 含脚本/事件/外链，已跳过')
  return {dataUrl:`data:${type};base64,${data.toString('base64')}`}
 }catch(e){return skip('图标读取失败：'+(e&&e.code||e))}
}
