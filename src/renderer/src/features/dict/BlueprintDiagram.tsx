import { blueprintRegions } from './blueprintGeometry'
interface Props {
 blueprint:{id:string;name:string;platform:string;slots:{block:string;note:string}[]}
 active?:string|null
 preview?:boolean
 onInspect?:(block:string|null)=>void
 onSelect?:(block:string)=>void
}
export function BlueprintDiagram({blueprint,active,preview=false,onInspect,onSelect}:Props):JSX.Element{
 const mobile=blueprint.platform==='移动',regions=blueprintRegions(blueprint)
 return <svg className={preview?'bp-thumb':'bp-diagram'} viewBox="0 0 320 360"
   role={preview?undefined:'group'} aria-hidden={preview||undefined} aria-label={preview?undefined:blueprint.name+'页面位置示意图'}>
   <rect className="bp-device" x={mobile?66:7} y="12" width={mobile?188:306} height="338" rx={mobile?19:9}/>
   {!mobile&&<g className="bp-chrome"><circle cx="18" cy="20" r="2"/><circle cx="26" cy="20" r="2"/><circle cx="34" cy="20" r="2"/></g>}
   {regions.filter(r=>!r.overlay||r.block===active).map(r=><g key={r.block}
     className={'bp-region'+(active===r.block?' is-active':'')}
     role={preview?undefined:'button'} tabIndex={preview?undefined:0}
     aria-label={preview?undefined:r.block+'：'+r.location+'；点击查看相关词条'}
     aria-pressed={preview?undefined:active===r.block}
     onMouseEnter={()=>onInspect?.(r.block)} onMouseLeave={()=>onInspect?.(null)}
     onFocus={()=>onInspect?.(r.block)} onBlur={()=>onInspect?.(null)}
     onClick={()=>onSelect?.(r.block)}
     onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(r.block)}}}>
     <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="5"/>
     <rect className="bp-region-pulse" x={r.x+2} y={r.y+2} width={r.w-4} height={r.h-4} rx="4"/>
     <text x={r.x+r.w/2} y={r.y+Math.min(r.h/2+4,23)} textAnchor="middle">{r.block}</text>
     {r.h>50&&<g className="bp-wire" aria-hidden="true">
       <path d={'M'+(r.x+12)+' '+(r.y+35)+'h'+(r.w-24)+'m-'+(r.w-24)+' 9h'+Math.max(8,r.w-42)}/>
       {r.h>90&&<path d={'M'+(r.x+12)+' '+(r.y+66)+'h'+(r.w-24)+'m-'+(r.w-24)+' 9h'+Math.max(8,r.w-42)}/>}
     </g>}
   </g>)}
 </svg>
}
