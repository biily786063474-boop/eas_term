import routes from './browserRoutes.json' with {type:'json'}
export const STICKERS=['✦','♥','★','☕','✿','☁','♫','⌘','⚡','▤','▶'] as const
export interface FavoriteFolder {id:string;name:string;sticker:string;builtin?:boolean}
export interface FavoriteSite {id:string;folderId:string;name:string;url:string|null;description:string;preview?:string;builtin?:boolean}
export interface Favorites {version:1;catalogIds?:string[];folders:FavoriteFolder[];sites:FavoriteSite[]}
export type FavoriteChange =
 |{type:'folder';id?:string;name:string;sticker:string}
 |{type:'save';folderId:string;name:string;url:string;description?:string;guestId?:number;capture?:boolean}
 |{type:'remove';id:string}
 |{type:'removePreview';id:string}
export function safeSiteUrl(value:unknown):string{
 if(typeof value!=='string'||value.length>4096)throw Error('网址过长或无效')
 const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('只接受不含账号密码的 HTTP(S) 网址')
 return u.href
}
const clean=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw Error('名称不能为空或过长');return v.trim()}
export function freshFavorites():Favorites{return {version:1,catalogIds:routes.sites.map(s=>s.id),folders:routes.categories.map((c,i)=>({id:c.id,name:c.name,sticker:['⚡','✿','▤','☁','▶'][i],builtin:true})),sites:routes.sites.map(s=>({id:s.id,folderId:s.category,name:s.name,url:s.url,description:s.description,builtin:true}))}}
export function applyFavoriteChange(old:Favorites,op:FavoriteChange,id:string):Favorites{
 const state:Favorites=structuredClone(old)
 if(op.type==='folder'){
 const name=clean(op.name,40);if(!STICKERS.includes(op.sticker as typeof STICKERS[number]))throw Error('无效贴纸')
 if(state.folders.some(f=>f.id!==op.id&&f.name===name))throw Error('已有同名文件夹')
 if(op.id){const f=state.folders.find(f=>f.id===op.id);if(!f)throw Error('文件夹不存在');f.name=name;f.sticker=op.sticker}
 else {if(state.folders.length>=50)throw Error('最多50个文件夹');state.folders.push({id,name,sticker:op.sticker})}
 }else if(op.type==='save'){
 if(!state.folders.some(f=>f.id===op.folderId))throw Error('文件夹不存在')
 const url=safeSiteUrl(op.url),name=clean(op.name,120)
 if(state.sites.some(s=>s.folderId===op.folderId&&s.url&&safeSiteUrl(s.url)===url))throw Error('此文件夹已收藏该网址')
 if(state.sites.length>=500)throw Error('最多500个收藏')
 state.sites.push({id,folderId:op.folderId,name,url,description:typeof op.description==='string'?op.description.slice(0,300):''})
 }else if(op.type==='remove'){state.sites=state.sites.filter(s=>s.id!==op.id)}
 else if(op.type==='removePreview'){const site=state.sites.find(s=>s.id===op.id);if(site)delete site.preview}
 else throw Error('未知收藏操作')
 return state
}
export function parseFavoriteRoute(raw:string):{folder:string;save:boolean;url:string;name:string}|null{
 if(!raw.startsWith('eas-favorites:'))return null
 const u=new URL(raw);if(!['home','save'].includes(u.hostname))throw Error('无效收藏路由')
 const url=u.searchParams.get('url')||''
 return {folder:u.searchParams.get('folder')||'',save:u.hostname==='save',url:url?safeSiteUrl(url):'',name:(u.searchParams.get('name')||'').slice(0,120)}
}

/** Reject corrupt data without overwriting the original file. Paths remain main-owned. */
export function validateFavorites(value:unknown):Favorites {
 if(!value||typeof value!=='object')throw Error('收藏数据损坏，已保留原文件')
 const s=value as Favorites
 if(s.version!==1||!Array.isArray(s.folders)||!Array.isArray(s.sites)||s.folders.length>50||s.sites.length>500)throw Error('收藏数据损坏，已保留原文件')
 if(s.catalogIds!==undefined&&(!Array.isArray(s.catalogIds)||s.catalogIds.length>1000||s.catalogIds.some(id=>typeof id!=='string')))throw Error('收藏版本信息损坏')
 const ids=new Set<string>(),folders=new Set<string>()
 for(const f of s.folders){if(!f||typeof f.id!=='string'||!f.id||ids.has(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>40||!STICKERS.includes(f.sticker as typeof STICKERS[number]))throw Error('收藏目录损坏');ids.add(f.id);folders.add(f.id)}
 for(const item of s.sites){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!folders.has(item.folderId)||typeof item.name!=='string'||!item.name.trim()||item.name.length>120||typeof item.description!=='string'||item.description.length>300)throw Error('收藏数据损坏');ids.add(item.id);if(item.url!==null)safeSiteUrl(item.url);if(item.preview!==undefined&&(typeof item.preview!=='string'||!/^[-a-f0-9]+\.jpg$/.test(item.preview)))throw Error('收藏预览损坏')}
 return s
}

export function mergeFavoriteCatalog(old:Favorites,defaults:Favorites=freshFavorites()):Favorites {
 const state=structuredClone(old)
 // Pre-ledger v1 cannot distinguish a removed preset from a new one. Preserve
 // user choices, start tracking now; never resurrect an intentionally removed URL.
 const known=new Set(state.catalogIds??defaults.sites.map(s=>s.id))
 for(const folder of defaults.folders)if(!state.folders.some(f=>f.id===folder.id)&&state.folders.length<50)state.folders.push(folder)
 for(const site of defaults.sites){
  if(known.has(site.id))continue
  if(state.sites.length>=500||!state.folders.some(f=>f.id===site.folderId))continue
  if(!state.sites.some(s=>s.id===site.id||(s.folderId===site.folderId&&s.url&&s.url===site.url)))state.sites.push(site)
  known.add(site.id)
 }
 state.catalogIds=[...known];return state
}
