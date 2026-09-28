/** Bounded metadata parsing only: never allocate decoded pixels in Electron main. */
export function imageDimensions(b:Buffer,mime:string):{width:number;height:number}{
 let width=0,height=0
 const bad=()=>{throw Error('图片格式无效或不支持安全预览')}
 if(mime==='image/png'){
  if(b.length<24||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.toString('ascii',12,16)!=='IHDR')return bad()
  width=b.readUInt32BE(16);height=b.readUInt32BE(20)
 }else if(mime==='image/gif'){
  if(b.length<10||!['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)))return bad()
  width=b.readUInt16LE(6);height=b.readUInt16LE(8)
 }else if(mime==='image/jpeg'){
  if(b.length<4||b[0]!==255||b[1]!==216)return bad()
  let i=2
  while(i+4<=b.length){
   if(b[i++]!==255)return bad()
   while(b[i]===255)i++
   const marker=b[i++]
   if(marker===217||marker===218)break
   if(marker===1||(marker>=208&&marker<=215))continue
   if(i+2>b.length)return bad()
   const length=b.readUInt16BE(i)
   if(length<2||i+length>b.length)return bad()
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(length<8)return bad()
    height=b.readUInt16BE(i+3);width=b.readUInt16BE(i+5);break
   }
   i+=length
  }
 }else if(mime==='image/webp'){
  if(b.length<30||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP')return bad()
  const kind=b.toString('ascii',12,16)
  if(kind==='VP8X'){width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3)}
  else if(kind==='VP8 '&&b.toString('hex',23,26)==='9d012a'){width=b.readUInt16LE(26)&16383;height=b.readUInt16LE(28)&16383}
  else if(kind==='VP8L'&&b[20]===47){const bits=b.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1}
  else return bad()
 }else return bad()
 if(!width||!height)return bad()
 if(width*height>16_000_000||width>16384||height>16384)throw Error('图片像素过大，已保留原文件但不自动解码预览')
 return {width,height}
}
