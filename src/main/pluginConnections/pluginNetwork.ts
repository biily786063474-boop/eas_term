import {lookup} from 'node:dns/promises'
import {createPinnedFetch} from './pinnedFetch.ts'
import {createHttpsSender} from './httpsSender.ts'

/** Session interface keeps Electron startup ownership at the caller. Never fallback from proxy to DIRECT. */
export function createPluginNetwork(origins:readonly string[],session:{resolveProxy:(url:string)=>Promise<string>}) {
 return createPinnedFetch({
  origins,
  resolve:async hostname=>(await lookup(hostname,{all:true,verbatim:true})).map(item=>item.address),
  proxy:url=>session.resolveProxy(url),
  send:createHttpsSender()
 })
}
