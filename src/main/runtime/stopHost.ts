import type {HostRegistry} from '../hostRegistry.ts'
import type {StopResult} from './stopGate.ts'
/** One authoritative transaction, shared by production and process integration tests.
 * Confirmation may await; permission + lease check + fence + stop never yield.
 * Removal remains the actual host exit callback's responsibility.
 */
export async function stopHost<T>(registry:HostRegistry<T>,key:string,permitted:(host:T,refs:readonly string[])=>boolean,confirm:(host:T)=>Promise<boolean>,close:(host:T)=>void,prepare?:(host:T)=>void):Promise<StopResult>{
 const host=registry.get(key),stamp=registry.leaseSnapshot(key)
 if(!host||!stamp)return {ok:false,reason:'服务已退出或实例已改变'}
 if(!permitted(host,stamp.refs))return {ok:false,reason:'存在归属不明或其他窗口的引用，不能安全关闭'}
 if(!await confirm(host))return {ok:false,reason:'已取消'}
 const current=registry.leaseSnapshot(key)
 if(registry.get(key)!==host||!current||!permitted(host,current.refs)||current.generation!==stamp.generation||current.revision!==stamp.revision)return {ok:false,reason:'服务归属已变化，请重新确认'}
 // Persist intent only after final ownership check, before the drain fence.
 // This hook must be synchronous and must not alter registry ownership.
 prepare?.(host)
 if(!registry.beginDrain(key,stamp))return {ok:false,reason:'服务状态已变化，未执行关闭'}
 close(host)
 return {ok:true}
}
