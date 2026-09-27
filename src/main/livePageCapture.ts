/** Chromium performs screenshot compression asynchronously, not nativeImage on the
 * Electron main thread. Only a bounded base64/JPEG header is inspected here. */
interface DebuggerLike {
  isAttached(): boolean
  attach(version: string): void
  detach(): void
  sendCommand(method: string, params?: any): Promise<any>
  on?(event: 'detach', listener: () => void): unknown
  removeListener?(event: 'detach', listener: () => void): unknown
}
export interface CapturedFrame { frame?: string; notice?: string }
const MAX_BYTES = 8_000_000
const MAX_EDGE = 4096
const MAX_PIXELS = 9_000_000
const FAILURE = '预览画面暂不可用，正在自动重试；可在独立窗口查看原网页。'

export function jpegDimensions(bytes: Buffer): {width:number;height:number} | null {
  if (bytes[0] !== 255 || bytes[1] !== 216) return null
  let offset = 2
  while (offset + 4 <= bytes.length && offset < 65536) {
    if (bytes[offset++] !== 255) return null
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if ([0xc0,0xc1,0xc2].includes(marker) && length >= 7) {
      return {height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)}
    }
    offset += length
  }
  return null
}

export async function captureBoundedFrame(debuggerApi: DebuggerLike, current:()=>boolean): Promise<CapturedFrame> {
  if (!current()) return {}
  if (debuggerApi.isAttached()) return {notice:'页面正在被调试，实时预览已暂停；关闭调试器后自动恢复。'}
  let owned = false
  const detached = ():void => { owned = false }
  const command = async (method:string,params?:any):Promise<any> => {
    let timer:ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([debuggerApi.sendCommand(method,params),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(Error('capture timeout')),4000);timer.unref()
      })])
    } finally { if(timer)clearTimeout(timer) }
  }
  try {
    debuggerApi.attach('1.3');owned=true
    debuggerApi.on?.('detach',detached)
    const metrics=await command('Page.getLayoutMetrics')
    const css=metrics.cssLayoutViewport, pixels=metrics.layoutViewport
    if(!css || !pixels || ![css.clientWidth,css.clientHeight,pixels.clientWidth,pixels.clientHeight].every(v=>Number.isFinite(v)&&v>0&&v<=131072))throw Error('invalid viewport')
    const baseScale=Math.min(1,MAX_EDGE/Math.max(pixels.clientWidth,pixels.clientHeight),Math.sqrt((MAX_PIXELS-10000)/(pixels.clientWidth*pixels.clientHeight)))
    const attempts=[{quality:90,scale:baseScale},{quality:75,scale:baseScale},{quality:75,scale:baseScale/2}]
    for(let i=0;i<attempts.length;i++) {
      if(!current() || !owned)return {}
      const attempt=attempts[i]
      const result=await command('Page.captureScreenshot',{
        format:'jpeg',quality:attempt.quality,fromSurface:true,captureBeyondViewport:false,
        clip:{x:css.pageX||0,y:css.pageY||0,width:css.clientWidth,height:css.clientHeight,scale:attempt.scale}
      })
      if(!current() || !owned)return {}
      if(typeof result.data!=='string' || result.data.length>Math.ceil(MAX_BYTES/3)*4)continue
      const bytes=Buffer.from(result.data,'base64')
      const size=jpegDimensions(bytes)
      if(!size || bytes.length>MAX_BYTES || size.width<1 || size.height<1 || Math.max(size.width,size.height)>MAX_EDGE || size.width*size.height>MAX_PIXELS)continue
      return {frame:'data:image/jpeg;base64,'+result.data,...(i>0 || baseScale<1?{notice:'复杂画面已降低预览画质，原网页不受影响。'}:{})}
    }
    return {notice:'画面超过预览预算，已暂停显示并自动重试；可在独立窗口查看原网页。'}
  } catch { return current()?{notice:FAILURE}:{} }
  finally {
    // A foreign debugger may attach after ours was externally detached. Never detach it.
    debuggerApi.removeListener?.('detach',detached)
    if(owned && debuggerApi.isAttached())try{debuggerApi.detach()}catch{/* closing */}
  }
}
