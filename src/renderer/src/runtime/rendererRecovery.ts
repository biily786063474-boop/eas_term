import {createRecoveryRegistry} from './recoveryRegistry'
import {createRecoveryState} from './recoveryState'
export const recoveryRegistry=createRecoveryRegistry()
export const recoveryState=createRecoveryState()
/** Only called during a validated old-window commit. Failed preparation must not
 * transfer ownership of unsent image files. Not yet connected to a main IPC. */
let transferring=false
export const recoveryTransferring=()=>transferring
export const setRecoveryTransferring=(value:boolean)=>{transferring=value}
