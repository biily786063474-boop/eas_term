import {createHash} from 'node:crypto'
export const DEFAULT_PLUGIN_CATALOG_URL='https://eas.biily.top/plugins/v2/registry.json'
/** Source-less legacy caches are left untouched, never imported with unknown provenance. */
export function catalogSource(override?:string):{url:string;cacheFile:string}{
 const url=override||DEFAULT_PLUGIN_CATALOG_URL
 return {url,cacheFile:'plugin-registry-v2-'+createHash('sha256').update(url).digest('hex')+'.json'}
}
