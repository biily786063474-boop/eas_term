/** Marketplace currently publishes numeric major.minor.patch only. Unknown or
 * prerelease versions never trigger an automatic downgrade/replacement offer. */
export function pluginVersion(value:unknown):string|undefined {
 if(typeof value!=='string'||!/^\d+\.\d+\.\d+$/.test(value)||!value.split('.').map(Number).every(Number.isSafeInteger))return
 return value
}
export function canUpdatePlugin(plugin:{cli:string;version?:string;builtin?:boolean},next:string):boolean {
 if(plugin.cli!=='eas'||plugin.builtin||!pluginVersion(plugin.version)||!pluginVersion(next))return false
 const current=plugin.version!.split('.').map(Number),candidate=next.split('.').map(Number)
 for(let i=0;i<3;i++){if(candidate[i]!==current[i])return candidate[i]>current[i]}
 return false
}

/** Unknown versions require explicit migration, not a claim that they are older. */
export function pluginUpdateAction(plugin:{cli:string;version?:string;builtin?:boolean},next:string):'update'|'migrate'|null {
 if(plugin.cli!=='eas'||!pluginVersion(next))return null
 if(!pluginVersion(plugin.version))return 'migrate'
 if(plugin.builtin)return next===plugin.version||canUpdatePlugin({...plugin,builtin:false},next)?'migrate':null
 return canUpdatePlugin(plugin,next)?'update':null
}
