export type PluginPermissionChanges={added:string[];removed:string[]}
/** Compare only declared access; this is not a sandbox or a claim of runtime behavior. */
export function permissionChanges(before:readonly string[],after:readonly string[]):PluginPermissionChanges{
 const a=new Set(before),b=new Set(after)
 return {added:[...b].filter(x=>!a.has(x)),removed:[...a].filter(x=>!b.has(x))}
}
