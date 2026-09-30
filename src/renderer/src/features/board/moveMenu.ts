import { columnName } from './columnName.ts'
import type {CanvasMenuItem} from '../../ui/CanvasContextMenu'
import { t } from '../../i18n.ts'
export function boardMoveMenu(columns:readonly {id:string;name:string}[],status:string|undefined,move:(status:string|null)=>void):CanvasMenuItem {
 const current=columns.find(c=>c.id===status)
 const option=(label:string,id:string|null,selected:boolean):CanvasMenuItem=>({label,hint:selected?t('board.current'):undefined,disabled:selected,onClick:()=>{if(!selected)move(id)}})
 return {label:t('board.moveTo'),hint:current?columnName(current):t('board.uncategorized'),onClick:()=>{},sub:[
  ...columns.map(c=>option(columnName(c),c.id,c.id===current?.id)),
  {sep:true,label:'',onClick:()=>{}},option(t('board.uncategorized'),null,!current)
 ]}
}
