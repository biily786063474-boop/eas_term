import type {PluginConfig} from '../../shared/pluginConfig.ts'
/** Explicit mode, never a catch-and-ignore for locked vaults or corrupt configuration. */
export function startupConfiguration<T>(config:PluginConfig|undefined,connect:()=>T):T|undefined{
 if(!config||config.startup==='deferred')return undefined
 return connect()
}
