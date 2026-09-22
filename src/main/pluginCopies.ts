import type {PluginInfo} from '../shared/types'

/** Preserve user choice; expose masking instead of silently switching executables. */
export function mergePluginCopies(user:PluginInfo[],builtin:PluginInfo[]):PluginInfo[]{
 const bundled=new Map(builtin.map(p=>[p.name,p]))
 const taken=new Set(user.map(p=>p.name))
 return [...user.map(p=>{
  const other=bundled.get(p.name)
  return other?{...p,shadowedBuiltin:`当前使用用户安装副本，覆盖同名内置副本（${other.version?'v'+other.version:'版本未知'}）；升级主程序不会替换此副本。`}:p
 }),...builtin.filter(p=>!taken.has(p.name))]
}
