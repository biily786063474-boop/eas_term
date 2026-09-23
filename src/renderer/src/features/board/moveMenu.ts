import type {CanvasMenuItem} from '../../ui/CanvasContextMenu'
export function boardMoveMenu(columns:readonly {id:string;name:string}[],status:string|undefined,move:(status:string|null)=>void):CanvasMenuItem {
 const current=columns.find(c=>c.id===status)
 const option=(label:string,id:string|null,selected:boolean):CanvasMenuItem=>({label,hint:selected?'当前':undefined,disabled:selected,onClick:()=>{if(!selected)move(id)}})
 return {label:'移动到看板区',hint:current?.name??'未分类',onClick:()=>{},sub:[
  ...columns.map(c=>option(c.name,c.id,c.id===current?.id)),
  {sep:true,label:'',onClick:()=>{}},option('未分类',null,!current)
 ]}
}
