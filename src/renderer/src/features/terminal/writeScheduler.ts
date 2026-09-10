/** 数据解析与绘制分离：后台绝不依赖 rAF；xterm write 回调是解析完成，不是屏幕绘制完成。 */
export function createWriteScheduler(io: {
 background:()=>boolean
 frame:(cb:()=>void)=>number
 cancelFrame:(id:number)=>void
 write:(data:string,done:()=>void)=>void
}) {
 let chunks:string[]=[];let offset=0;let head=0;let pending=0;let raf=0;let writing=false;let disposed=false;let last=0
 const take=():string=>{
  let remaining=Math.min(pending,65536);const parts:string[]=[]
  while(remaining>0){
   const piece=chunks[head];const n=Math.min(remaining,piece.length-offset)
   parts.push(piece.slice(offset,offset+n));offset+=n;remaining-=n;pending-=n
   if(offset===piece.length){head++;offset=0}
  }
  if(head){chunks=chunks.slice(head);head=0}
  return parts.join('')
 }
 const schedule=():void=>{
  if(disposed||writing||!pending)return
  if(io.background()){flush();return}
  if(!raf)raf=io.frame(()=>{
   raf=0
   if(disposed)return
   if(Date.now()-last<16){schedule();return}
   flush()
  })
 }
 const flush=():void=>{
  if(disposed||writing||!pending)return
  last=Date.now();writing=true
  io.write(take(),()=>{writing=false;schedule()})
 }
 return {
  push(data:string){if(disposed||!data)return;chunks.push(data);pending+=data.length;schedule()},
  visibilityChanged(){if(raf){io.cancelFrame(raf);raf=0}schedule()},
  dispose(){disposed=true;if(raf)io.cancelFrame(raf);raf=0;chunks=[];pending=0},
  pendingChars(){return pending}
 }
}
