// Renderer-only candidate contract. No transport commands, IO or store mutations here.
import type { DictChip } from './chips.ts'
export type Category = 'all' | 'dict' | 'file' | 'folder' | 'skill' | 'plugin' | 'app' | 'browser' | 'common' | 'native'
export const CATEGORY_LABELS: Record<Category,string> = {all:'全部',dict:'辞典',file:'文件',folder:'文件夹',skill:'技能',plugin:'插件',app:'应用',browser:'浏览器标签',common:'通用操作',native:'当前端口命令'}
export interface Candidate { id:string; category:Exclude<Category,'all'>; name:string; description:string; insert:string; aliases?:string[]; chip?:DictChip; preloaded?:boolean; disabled?:string }
export interface Trigger {mode:'@'|'/';query:string;start:number;end:number}
export function triggerAt(text:string, caret:number, end=caret):Trigger|null {
  if(caret!==end) return null
  const before=text.slice(0,caret)
  if(/^\/[^\s/]*$/.test(before) && !/\S/.test(text.slice(caret))) return {mode:'/',query:before.slice(1),start:0,end:caret}
  const m=/(?:^|[\s（(，,。:：])@([^\s@]*)$/.exec(before)
  if(!m) return null
  return {mode:'@',query:m[1],start:caret-m[1].length-1,end:caret}
}
export function insertCandidate(text:string,t:Trigger,c:Candidate):{text:string;caret:number} {
  const value=c.insert
  const suffix=text.slice(t.end)
  const space=/^\s/.test(suffix)?'':' '
  return {text:text.slice(0,t.start)+value+space+suffix,caret:t.start+value.length+space.length}
}
export function filterCandidates(all:readonly Candidate[],query:string,category:Category):Candidate[] {
  const q=query.trim().toLowerCase()
  return all.filter(c=>category==='all'||c.category===category).map((c,i)=>{
    const fields=[c.name,...c.aliases??[]].map(s=>s.toLowerCase())
    const score=!q?0:fields.some(s=>s.startsWith(q))?0:fields.some(s=>s.includes(q))?1:c.description.toLowerCase().includes(q)?2:3
    return {c,score,i}
  }).filter(x=>x.score<3).sort((a,b)=>a.score-b.score||Number(!!b.c.preloaded)-Number(!!a.c.preloaded)||a.i-b.i).map(x=>x.c)
}
export interface DictEntry {id:string;zh:string;en:string;keywords:string[];prompt?:string;logic:string}
export function dictCandidates(chips:readonly DictChip[],terms:readonly DictEntry[]):Candidate[] {
  const byId=new Map(terms.map(t=>[t.id,t]))
  const ids=new Set(chips.map(c=>c.id))
  const make=(chip:DictChip,preloaded:boolean,t?:DictEntry):Candidate=>({id:`dict:${chip.id}`,category:'dict',name:chip.label,description:t?.en||chip.text,aliases:t?[t.en,...t.keywords]:[],insert:`@${chip.label}`,chip,preloaded})
  return [...chips.map(c=>make(c,true,byId.get(c.id))),...[...byId.values()].filter(t=>!ids.has(t.id)).map(t=>make({id:t.id,label:t.zh,text:t.prompt||t.logic||t.en},false,t))]
}
export function commandCandidates(available:{model:boolean;effort:boolean;compact:boolean}):Candidate[] {
  return [ ['mention','打开引用候选'],...(available.model?[['model','聚焦模型选择器；使用现有模型清单']]:[]),...(available.effort?[['effort','聚焦思考强度控件']]:[]),...(available.compact?[['compact','打开压缩确认；确认后才执行']]:[]) ].map(([name,description])=>({id:`common:${name}`,category:'common',name,description,insert:`/${name}`}))
}
export function popupPosition(r:{left:number;right:number;top:number;bottom:number;width:number;height:number},vw:number,vh:number):{left:number;width:number;top?:number;bottom?:number;maxHeight:number}|null {
  if(r.width<10||r.height<5||r.bottom<0||r.top>vh||r.right<0||r.left>vw) return null
  const width=Math.min(Math.max(420,r.width),vw-16)
  const above=r.top-12,below=vh-r.bottom-12
  const up=above>=340||above>below
  const room=Math.max(0,up?above:below)
  if(room<100) return null
  return {left:Math.max(8,Math.min(r.left,vw-width-8)),width,...(up?{bottom:vh-r.top+6}:{top:r.bottom+6}),maxHeight:Math.min(420,room)}
}
