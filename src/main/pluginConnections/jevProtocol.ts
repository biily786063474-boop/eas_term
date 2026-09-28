/** Protocol capabilities, not an installed version label, select opt-in v2 behavior. */
type JevInfo={name:string;requirements?:{capabilities?:string[]}}
export const supportsJevDecisionsV2=(info:JevInfo)=>info.name==='jev'&&info.requirements?.capabilities?.includes('jev.decisions.v2')===true
export function jevAutomationAllowed(info:JevInfo,state:{enabled:boolean;connected:boolean;projectIds?:string[];selected:{milestone:boolean;project:boolean}},projectId:string):boolean{
 return state.enabled&&state.connected&&(state.selected.milestone||state.selected.project)&&(!supportsJevDecisionsV2(info)||state.projectIds?.includes(projectId)===true)
}
