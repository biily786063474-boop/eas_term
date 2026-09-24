import { blueprintRegions } from './blueprintGeometry'
import type { CSSProperties } from 'react'
interface Props {
 blueprint:{id:string;name:string;platform:string;slots:{block:string;note:string}[]}
 active?:string|null
 selected?:string|null
 preview?:boolean
 onInspect?:(block:string|null)=>void
 onSelect?:(block:string)=>void
}

// Schematic UI grammar: a page should be recognizable by its structure before reading labels.
// Keep every mark neutral; the enclosing region alone handles inspect/selection color.
function RegionWireframe({block,x,y,w,h,mobile}:{block:string;x:number;y:number;w:number;h:number;mobile:boolean}):JSX.Element{
 const left=x+11,right=x+w-11,top=y+21,inner=w-22
 const bar=(yy:number,width=inner,start=left)=> <path key={`${start}-${yy}`} d={`M${start} ${yy}h${width}`}/>
 const tile=(xx:number,yy:number,ww:number,hh:number)=> <rect key={`${xx}-${yy}`} x={xx} y={yy} width={ww} height={hh} rx="2"/>
 let marks:JSX.Element|JSX.Element[]|null=null
 switch(block){
  case '导航栏': marks=<><path d={`M${left+5} ${y+h-7}l-5 -4 5 -4`}/><circle cx={right-5} cy={y+h-11} r="2"/></>;break
  case '搜索': marks=<><circle cx={left+6} cy={y+h-10} r="3"/><path d={`M${left+9} ${y+h-7}l3 3`}/>{bar(y+h-10,inner-32)}</>;break
  case '首屏': marks=<>{tile(left,top,inner,h-31)}{bar(top+12,inner*.57)}{bar(top+20,inner*.38)}{tile(left,top+h-50,inner*.28,8)}</>;break
  case '轮播': marks=<>{tile(left,top,inner*.7,h-28)}{tile(left+inner*.74,top,inner*.25,h-28)}</>;break
  case '金刚区': marks=<>{[0,1,2,3].map(i=><g key={i}>{tile(left+i*inner/4+5,top,10,10)}{bar(top+17,Math.min(16,inner/4-8),left+i*inner/4+2)}</g>)}</>;break
  case '列表': marks=<>{[0,1,2].filter(i=>top+i*15+12<y+h-2).map(i=><g key={i}>{tile(left,top+i*15,12,11)}<path d={`M${left+18} ${top+i*15+4}h${inner-25}m-${inner-25} 5h${(inner-25)*.65}`}/></g>)}</>;break
  case '标签栏': marks=<>{[0,1,2,3].map(i=><circle key={i} cx={left+(i+.5)*inner/4} cy={y+h-7} r="3"/>)}</>;break
  case '图集': marks=<>{tile(left,top,inner,h-48)}{[0,1,2].map(i=>tile(left+i*(inner+4)/3,y+h-23,(inner-8)/3,10))}</>;break
  case '卡片': marks=<>{tile(left,top,inner,Math.max(9,h-31))}{bar(top+10,inner*.54)}</>;break
  case '表单': marks=<>{[0,1,2,3].filter(i=>top+i*39+26<y+h).map(i=><g key={i}>{bar(top+i*39,inner*.32)}{tile(left,top+i*39+6,inner,20)}</g>)}</>;break
  case '按钮': marks=tile(left,y+h-15,inner,9);break
  case '弹层': marks=<>{bar(top+8,inner*.48)}{bar(top+20,inner*.75)}{tile(left,Math.min(y+h-20,top+31),inner,12)}</>;break
  case '空状态': marks=<><circle cx={x+w/2} cy={top+10} r="8"/>{bar(top+27,inner*.55)}</>;break
  case '侧边栏': marks=<>{[0,1,2,3,4].map(i=>bar(top+i*23,inner*(i===0?.8:.65)))}</>;break
  case '表格': marks=<>{[0,1,2,3,4,5].map(i=><g key={i}>{bar(top+i*24,inner)}<path d={`M${left+inner*.45} ${top+i*24-7}v14`}/></g>)}</>;break
  case '页脚': marks=<>{bar(y+h-10,inner*.25)}{bar(y+h-10,inner*.18,right-inner*.18)}</>;break
  default: marks=bar(top,inner*.7)
 }
 return <g className="bp-wireframe" aria-hidden="true" data-block={block} data-platform={mobile?'mobile':'desktop'}>{marks}</g>
}

export function BlueprintDiagram({blueprint,active,selected,preview=false,onInspect,onSelect}:Props):JSX.Element{
 const mobile=blueprint.platform==='移动',regions=blueprintRegions(blueprint)
 return <svg className={preview?'bp-thumb':'bp-diagram'} viewBox="0 0 320 360"
   role={preview?undefined:'group'} aria-hidden={preview||undefined} aria-label={preview?undefined:blueprint.name+'页面位置示意图'}>
   <rect className="bp-device" x={mobile?66:7} y="12" width={mobile?188:306} height="338" rx={mobile?19:9}/>
   {!mobile&&<g className="bp-chrome"><circle cx="18" cy="20" r="2"/><circle cx="26" cy="20" r="2"/><circle cx="34" cy="20" r="2"/></g>}
   {regions.filter(r=>!r.overlay||r.block===active).map(r=><g key={r.block}
     style={{'--bp-color': `var(--bp-tone-${blueprint.slots.findIndex(s => s.block === r.block) % 7})`} as CSSProperties}
     className={'bp-region'+(active===r.block?' is-active':'')+(selected===r.block?' is-selected':'')}
     role={preview?undefined:'button'} tabIndex={preview?undefined:0}
     aria-label={preview?undefined:r.block+'：'+r.location+'；点击查看相关词条'}
     aria-pressed={preview?undefined:selected===r.block}
     onMouseEnter={()=>onInspect?.(r.block)} onMouseLeave={()=>onInspect?.(null)}
     onFocus={()=>onInspect?.(r.block)} onBlur={()=>onInspect?.(null)}
     onClick={()=>onSelect?.(r.block)}
     onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(r.block)}}}>
     <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="5"/>
     <rect className="bp-region-pulse" x={r.x+2} y={r.y+2} width={r.w-4} height={r.h-4} rx="4"/>
     <text x={r.x+r.w/2} y={r.y+Math.min(15,r.h/2+4)} textAnchor="middle">{r.block}</text>
     {!preview && r.h>23 && <RegionWireframe block={r.block} x={r.x} y={r.y} w={r.w} h={r.h} mobile={mobile}/>}
   </g>)}
 </svg>
}
