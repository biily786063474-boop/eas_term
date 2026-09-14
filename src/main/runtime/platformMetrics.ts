/** Parsing only. macOS value is an estimate, NOT OS memory-pressure state.
 * Anonymous + wired + physical compressor - purgeable avoids counting file cache
 * as wholly unavailable. Must remain labeled estimated until platform calibration.
 */
export function parseMacMemory(raw:string,total:number,usable:number=total):number|null{
 const size=Number(/page size of (\d+) bytes/.exec(raw)?.[1])
 if(!Number.isSafeInteger(size)||size<=0||!Number.isSafeInteger(total)||total<=0)return null
 const read=(name:string)=>{
  const line=raw.split('\n').find(l=>l.startsWith(name+':'))
  const m=line&&/^\s*(\d+)\.?\s*$/.exec(line.slice(name.length+1))
  return m?Number(m[1]):NaN
 }
 if(!Number.isSafeInteger(usable)||usable<=0||usable>total)return null
 const anonymous=read('Anonymous pages'),wired=read('Pages wired down'),compressed=read('Pages occupied by compressor'),purgeable=read('Pages purgeable')
 if(![anonymous,wired,compressed,purgeable].every(n=>Number.isSafeInteger(n)&&n>=0)||purgeable>anonymous)return null
 const resident=(anonymous+wired+compressed-purgeable)*size
 if(resident>usable)return null
 // hw.memsize includes physical carveouts; hw.memsize_usable excludes them.
 // Count unavailable physical capacity once, not the entire tag-storage region.
 const used=resident+(total-usable)
 return Number.isSafeInteger(used)&&used>=0&&used<=total?used:null
}
export function parseLinuxMemory(raw:string):{total:number;used:number}|null{
 const field=(key:string)=>{const m=new RegExp('^'+key+':\\s+(\\d+) kB\\s*$','m').exec(raw);return m?Number(m[1])*1024:NaN}
 const total=field('MemTotal'),available=field('MemAvailable')
 return Number.isSafeInteger(total)&&total>0&&Number.isSafeInteger(available)&&available>=0&&available<=total?{total,used:total-available}:null
}
/** sysctl exports dispatch flags, not the internal 0-based memorystatus enum.
 * Apple XNU kern_memorystatus_notify.c converts before SYSCTL_OUT.
 */
export function parseMacPressure(raw:string):'normal'|'warning'|'critical'|null{
 switch(raw.trim()){case '1':return 'normal';case '2':return 'warning';case '4':return 'critical';default:return null}
}
