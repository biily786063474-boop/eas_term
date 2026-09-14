/** Metadata only. A missing project must remain unknown, not inferred from cwd. */
export function projectServiceOwners(refs:readonly string[],owners:ReadonlyMap<string,string>){
 const known=new Set<string>();let unknownRefs=0
 for(const ref of refs){const project=owners.get(ref);if(project)known.add(project);else unknownRefs++}
 return {projectIds:[...known].sort(),unknownRefs}
}
/** Only the current workbench's known panel refs can be stopped through its UI. */
export function canStopHostRefs(refs:readonly string[],windows:ReadonlyMap<string,number>,caller:number):boolean{
 return Number.isSafeInteger(caller)&&caller>0&&refs.every(ref=>windows.get(ref)===caller)
}
