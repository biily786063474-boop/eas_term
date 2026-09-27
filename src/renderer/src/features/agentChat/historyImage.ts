/** Use the existing image reader (format/size validation); never synthesize unrestricted file URLs. */
export async function historyImageSource(image:{path:string;url:string},read:(path:string)=>Promise<{ok:boolean;dataUrl?:string;error?:string}>):Promise<string>{
 if(image.url)return image.url
 try{const r=await read(image.path);return r.ok?r.dataUrl??'':''}catch{return ''}
}
