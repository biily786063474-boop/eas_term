import { tm } from '../../shared/i18n/current.ts'
import type {FetchLike} from '@modelcontextprotocol/sdk/shared/transport.js'
import type {PluginInfo} from '../../shared/types'
import {createAuthenticatedFetch} from './authenticatedFetch.ts'
/** Reads an encrypted configuration reference, not an OAuth account or CLI credential. */
export function connectBearerConfiguration(deps:{info:PluginInfo;lease:{signal:AbortSignal;assertActive():void;dispose():void};load:()=>Record<string,string>|undefined;fetch:FetchLike}){
 const remote=deps.info.remote,field=remote?.auth==='bearer'?remote.bearer.field:undefined
 if(!remote||!field||deps.info.config?.fields.length!==1||!deps.info.config.fields.some(f=>f.id===field&&f.type==='secret'&&f.required))throw Error(tm('errPlugin.conn.e34'))
 const load=()=>{
  deps.lease.assertActive()
  const token=deps.load()?.[field]
  if(typeof token!=='string'||!token||token.length>16384||! /^[A-Za-z0-9\-._~+/]+=*$/.test(token))throw Error(tm('errPlugin.conn.e35'))
  return {access_token:token,token_type:'Bearer'}
 }
 load() // Fail before constructing a remote client if configuration is absent.
 return createAuthenticatedFetch({url:remote.url,lease:deps.lease,load,fetch:deps.fetch,refresh:async()=>{throw Error(tm('errPlugin.conn.e36'))}})
}
