// Offline artifact renderer; Electron -ApplePersistenceIgnoreState YES
const {app,BrowserWindow,session}=require('electron');
const fs=require('fs'),path=require('path');
const root=process.env.DESIGN_BACKUP_ROOT;
if(!root||!process.env.DESIGN_INDEX)throw new Error('Set DESIGN_BACKUP_ROOT and DESIGN_INDEX');
const rows=JSON.parse(fs.readFileSync(process.env.DESIGN_INDEX));
const out=path.join(process.cwd(),'src/renderer/public/design-covers');fs.mkdirSync(out,{recursive:true});
app.setPath('userData','/tmp/eas-cover-render-profile2');
app.on('window-all-closed',()=>{});
console.log("boot"); app.whenReady().then(async()=>{console.log("ready");
 const ses=session.fromPartition('cover-render');
 ses.webRequest.onBeforeRequest((d,cb)=>{
  if(d.url.startsWith('https://cdn.vechooool.com/')){const f=path.join(root,'cdn-mirror',new URL(d.url).pathname);if(fs.existsSync(f))return cb({redirectURL:require('url').pathToFileURL(f).href});}
  cb({cancel:/^https?:/.test(d.url)});
 });
 const manifestPath=path.join(process.cwd(),'src/renderer/src/features/dict/design-previews.json');
 const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):{};
 const w=new BrowserWindow({width:1200,height:800,show:false,webPreferences:{offscreen:true,partition:'cover-render',sandbox:true,contextIsolation:true,nodeIntegration:false}});
 for(const [i,r] of rows.entries()){
  if(manifest[r.slug])continue;
  try{
   console.log("loading",r.slug); await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{w.webContents.stop();resolve()},5000);
    w.loadFile(path.resolve(root,'design-library',r.previewHtml)).then(resolve,e=>{if(e.errno===-3)resolve();else reject(e)}).finally(()=>clearTimeout(timer));
   });
   await new Promise(r=>setTimeout(r,1200));
   console.log("capture",r.slug); const img=await w.webContents.capturePage();fs.writeFileSync(path.join(out,r.slug+'.jpg'),img.resize({width:600}).toJPEG(80));
   const metaPath=path.join(root,'projects',r.slug,'meta.json');
   const meta=fs.existsSync(metaPath)?JSON.parse(fs.readFileSync(metaPath)):{previewHtmlSrc:r.previewHtml.replace('../cdn-mirror/','https://cdn.vechooool.com/')};
   manifest[r.slug]={cover:'design-covers/'+r.slug+'.jpg',previewUrl:meta.previewHtmlSrc};
   console.log(i+1,r.slug);
  }catch(e){console.log('FAIL',r.slug,e.message)}finally{fs.writeFileSync(path.join(process.cwd(),'src/renderer/src/features/dict/design-previews.json'),JSON.stringify(manifest,null,2))}
 }
 fs.writeFileSync(path.join(process.cwd(),'src/renderer/src/features/dict/design-previews.json'),JSON.stringify(manifest,null,2));w.destroy();app.quit();
});
