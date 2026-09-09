import {app,ipcMain,BrowserWindow,webContents,protocol,net} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {mergeFavoriteCatalog,validateFavorites,freshFavorites,applyFavoriteChange,safeSiteUrl,type Favorites,type FavoriteChange} from '../shared/browserFavorites'
import routes from '../shared/browserRoutes.json'
import {realResolve} from './fsGuard'
const root=()=>path.join(app.getPath('userData'),'browser-favorites')
/** Narrow app-owned cache guard, never accepts a path from IPC. Do not widen fsGuard roots. */
function file(name:string):string{
 if(!/^(favorites\.json|favorites\.tmp|[a-f0-9-]+\.jpg)$/.test(name))throw Error('Invalid cache filename')
 const base=root(),target=path.join(base,name)
 if(fs.existsSync(base)&&realResolve(base)!==path.join(realResolve(app.getPath('userData')),'browser-favorites'))throw Error('收藏目录不能是软链接')
 if(fs.lstatSync(target,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('收藏文件不能是软链接')
 return target
}
function read():Favorites{
 const target=file('favorites.json');if(!fs.existsSync(target))return freshFavorites()
 const s=validateFavorites(JSON.parse(fs.readFileSync(target,'utf8')))
 for(const item of s.sites)if(item.preview)file(item.preview)
 return mergeFavoriteCatalog(s)
}
function snapshot(s:Favorites):Favorites{return {...s,sites:s.sites.map(item=>({...item,preview:item.preview?'eas-favorite-preview://local/'+item.preview:undefined}))}}
function owner(event:Electron.IpcMainInvokeEvent):void{
 if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw Error('Only workbench renderer may access favorites')
}
let queue:Promise<unknown>=Promise.resolve()
export function registerFavoritePreviewScheme():void {
 protocol.registerSchemesAsPrivileged([{scheme:'eas-favorite-preview',privileges:{standard:true,secure:true,supportFetchAPI:true}}])
}
export function registerBrowserFavorites():void{
 // Default workbench session only; never install this reader in persist:browser.
 protocol.handle('eas-favorite-preview',request=>{
  try{const u=new URL(request.url),name=u.pathname.slice(1);if(u.hostname!=='local'||!/^[-a-f0-9]+\.jpg$/.test(name))return new Response('',{status:404});const target=file(name);if(!fs.existsSync(target))return new Response('',{status:404});return net.fetch(pathToFileURL(target).href)}catch{return new Response('',{status:404})}
 })
 ipcMain.handle('browser:favorites',event=>{owner(event);return snapshot(read())})
 ipcMain.handle('browser:routes',event=>{owner(event);return {catalog:routes,entryUrl:'eas-favorites://home',htmlPath:path.join(app.isPackaged?process.resourcesPath:path.join(app.getAppPath(),'resources'),'browser','index.html')}})
 ipcMain.handle('browser:favoriteChange',(event,op:FavoriteChange)=>{
 owner(event)
 const task=queue.then(async()=>{
 const old=read(),id=randomUUID(),next=applyFavoriteChange(old,op,id)
 let warning:string|undefined
 if(op.type==='save'&&op.capture){
 try{
 const guest=webContents.fromId(Number(op.guestId))
 if(!guest||guest.isDestroyed()||guest.getType()!=='webview'||guest.hostWebContents!==event.sender||safeSiteUrl(guest.getURL())!==safeSiteUrl(op.url))throw Error('页面已改变或不属于当前窗口')
 const captured=await guest.capturePage()
 if(guest.isDestroyed()||guest.hostWebContents!==event.sender||safeSiteUrl(guest.getURL())!==safeSiteUrl(op.url))throw Error('页面已改变')
 const size=captured.getSize(),scale=Math.min(640/size.width,480/size.height,1)
 if(captured.isEmpty())throw Error('空白截图')
 const image=captured.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'good'}).toJPEG(72)
 if(image.byteLength>350_000)throw Error('预览超过大小限制')
 fs.mkdirSync(root(),{recursive:true});const name=id+'.jpg';fs.writeFileSync(file(name),image,{flag:'wx'})
 next.sites.find(s=>s.id===id)!.preview=name
 }catch{warning='网站已收藏，预览未保存（页面变动或捕获失败）'}
 }
 fs.mkdirSync(root(),{recursive:true});fs.writeFileSync(file('favorites.tmp'),JSON.stringify(next));fs.renameSync(file('favorites.tmp'),file('favorites.json'))
 const used=new Set(next.sites.map(s=>s.preview).filter(Boolean))
 for(const name of fs.readdirSync(root()))if(/^[a-f0-9-]+\.jpg$/.test(name)&&!used.has(name))fs.unlinkSync(file(name))
 // Bound cache to 30MB; missing thumbnails fall back gracefully without deleting bookmarks.
 const cache=next.sites.filter(s=>s.preview).map(s=>({site:s,path:file(s.preview!)}))
 let bytes=cache.reduce((n,c)=>n+(fs.existsSync(c.path)?fs.statSync(c.path).size:0),0)
 for(const c of cache){if(bytes<=30_000_000)break;if(fs.existsSync(c.path)){bytes-=fs.statSync(c.path).size;fs.unlinkSync(c.path)}}
 const data=snapshot(next)
 for(const w of BrowserWindow.getAllWindows())w.webContents.send('browser:favoritesChanged',data)
 return {data,warning}
 })
 queue=task.catch(()=>{});return task
 })
}
