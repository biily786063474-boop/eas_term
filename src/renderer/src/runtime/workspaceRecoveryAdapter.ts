import {useStore} from '../store'
import {recoveryRegistry,recoveryState} from './rendererRecovery'
import {workspaceRecoveryBlockers,workspaceRecoveryKeys} from './workspaceRecovery'
import {createRecoveryState,type RecoveryStateSnapshot} from './recoveryState'
import {collectLeaves} from '../layout'
let restored=false
export const consumeRecoveryWorkspace=()=>{const value=restored;restored=false;return value}
const blockers=()=>[...workspaceRecoveryBlockers(useStore.getState()),...(document.querySelector('[role=dialog], [aria-modal=true]')?['dialog:unregistered']:[])]
export function installWorkspaceRecovery(){
 const remove=recoveryRegistry.register('workspace',{
  ready:()=>blockers().length===0,
  flush:async()=>{
   if(blockers().length)return false
   const state=useStore.getState(),snapshot:Record<string,unknown>={}
   for(const key of workspaceRecoveryKeys)snapshot[key]=(state as unknown as Record<string,unknown>)[key]
   recoveryState.write('workspace',snapshot)
   return true
  }
 })
 const unsub=useStore.subscribe((s,prev)=>{
  if(workspaceRecoveryKeys.some(key=>(s as unknown as Record<string,unknown>)[key] !== (prev as unknown as Record<string,unknown>)[key]))recoveryRegistry.changed()
 })
 return()=>{remove();unsub()}
}
export async function prepareRendererRecovery(){
 const required=['canvas','workspace']
 for(const tab of useStore.getState().tabs)for(const leaf of collectLeaves(tab.root)){
  if(leaf.pane.kind==='agent')required.push('history:'+leaf.id,'state:startup:text:'+leaf.id,'state:startup:chips:'+leaf.id,'state:images:'+leaf.id+':startup','pending:images:'+leaf.id+':startup')
 }
 const token=await recoveryRegistry.prepare(required)
 if(!token)return null
 const snapshot=recoveryState.snapshot()
 return recoveryRegistry.current(token)?{token,snapshot}:null
}
/** Must run before React mounts the replacement. Never exposed to plugins. */
export function restoreRendererRecovery(snapshot:RecoveryStateSnapshot){
 const validated=createRecoveryState();validated.restore(snapshot)
 const workspace=validated.read<Record<string,unknown>>('workspace')
 if(!workspace||workspaceRecoveryBlockers(workspace as unknown as Parameters<typeof workspaceRecoveryBlockers>[0]).length)throw Error('invalid recovery workspace')
 const patch:Record<string,unknown>={}
 for(const key of workspaceRecoveryKeys)if(Object.hasOwn(workspace,key))patch[key]=workspace[key]
 recoveryState.restore(validated.snapshot())
 useStore.setState(patch);restored=true
}
