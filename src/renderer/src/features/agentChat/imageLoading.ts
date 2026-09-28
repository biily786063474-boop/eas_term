export type ImageLoadState={url?:string;error?:string}
/** Only a visible owner may retain pixels. Late IPC completions cannot resurrect them. */
export function createVisibleImage(read:(active:()=>boolean)=>Promise<{ok:boolean;url?:string;error?:string}>,changed:(state:ImageLoadState)=>void){
 let generation=0,shown=false,disposed=false
 const load=()=>{
  const own=++generation
  changed({})
  void read(()=>!disposed&&shown&&generation===own).then(r=>{if(!disposed&&shown&&generation===own)changed(r.ok&&r.url?{url:r.url}:{error:r.error??'图片读取失败'})},()=>{
   if(!disposed&&shown&&generation===own)changed({error:'图片读取失败，请重试'})
  })
 }
 return {
  visible(value:boolean){if(disposed||shown===value)return;shown=value;if(value)load();else{generation++;changed({})}},
  retry(){if(!disposed&&shown)load()},
  dispose(){disposed=true;shown=false;generation++;changed({})}
 }
}
