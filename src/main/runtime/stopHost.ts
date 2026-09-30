import { tm } from '../../shared/i18n/current.ts'
import type {HostRegistry} from '../hostRegistry.ts'
import type {StopResult} from './stopGate.ts'
/** One authoritative transaction, shared by production and process integration tests.
 * Confirmation may await; permission + lease check + fence + stop never yield.
 * Removal remains the actual host exit callback's responsibility.
 */
export async function stopHost<T>(registry:HostRegistry<T>,key:string,permitted:(host:T,refs:readonly string[])=>boolean,confirm:(host:T)=>Promise<boolean>,close:(host:T)=>void,prepare?:(host:T)=>void):Promise<StopResult>{
 const host=registry.get(key),stamp=registry.leaseSnapshot(key)
 if(!host||!stamp)return {ok:false,reason:tm('errCore.rt.hostGone')}
 if(!permitted(host,stamp.refs))return {ok:false,reason:tm('errCore.rt.unsafeRefs')}
 if(!await confirm(host))return {ok:false,reason:tm('errCore.rt.canceled')}
 const current=registry.leaseSnapshot(key)
 if(registry.get(key)!==host||!current||!permitted(host,current.refs)||current.generation!==stamp.generation||current.revision!==stamp.revision)return {ok:false,reason:tm('errCore.rt.ownershipChanged')}
 // Persist intent only after final ownership check, before the drain fence.
 // This hook must be synchronous and must not alter registry ownership.
 prepare?.(host)
 if(!registry.beginDrain(key,stamp))return {ok:false,reason:tm('errCore.rt.stateChangedNoStop')}
 close(host)
 return {ok:true}
}
