// Pure plugin-side aggregation. Projects MUST come from a host-authorized snapshot,
// never from model arguments. This module does not discover directories or authorize them.
import fs from 'node:fs'
import {list,get} from './store.mjs'
function projects(input) {
  if (!Array.isArray(input) || input.length > 500) throw Error('授权项目列表无效')
  const ids = new Set()
  for (const p of input) {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || typeof p.cwd !== 'string') throw Error('授权项目身份无效')
    ids.add(p.id)
  }
  return input
}
function selection(input, ids) {
  const available = projects(input)
  if (ids === undefined) return available
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !available.some(p => p.id === id))) throw Error('项目筛选包含未授权项目')
  return available.filter(p => ids.includes(p.id))
}
function validateQuery(args) {
  const {limit=30,offset=0,month,date,query,taskKey} = args
  if (!Number.isInteger(limit) || limit<1 || limit>200 || !Number.isInteger(offset) || offset<0) throw Error('分页参数无效')
  if (month!==undefined && (typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw Error('月份格式无效')
  if (date!==undefined && (typeof date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw Error('日期无效')
  if (query!==undefined && (typeof query!=='string' || query.length>200)) throw Error('query 无效')
  if (taskKey!==undefined && (typeof taskKey!=='string' || taskKey.length>100)) throw Error('taskKey 无效')
  return {limit,offset,month,date,query,taskKey}
}
export function listGlobal(authorizedProjects,args={}) {
  const {limit,offset,...query}=validateQuery(args)
  const selected=selection(authorizedProjects,args.projectIds)
  const rows=[],errors=[],roots=new Set()
  for (const p of selected) {
    try {
      const root=fs.realpathSync(p.cwd)
      if (roots.has(root)) continue
      roots.add(root)
      // Collect summaries only. Paginate globally after union, not once per project.
      const projectRows=[]
      let next=0
      do {
        const page=list(root,{...query,limit:200,offset:next})
        projectRows.push(...page.items.map(item=>({...item,projectId:p.id,projectName:p.name})))
        next=page.nextOffset
      } while(next!==null)
      rows.push(...projectRows)
    } catch(e) { errors.push({projectId:p.id,projectName:p.name,message:'项目时间线不可读：'+e.message}) }
  }
  rows.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||a.projectId.localeCompare(b.projectId)||a.id.localeCompare(b.id))
  const days={}
  for(const row of rows)days[row.date]=(days[row.date]??0)+1
  return {total:rows.length,days,items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null,partial:errors.length>0,errors}
}
export function getGlobal(authorizedProjects,{projectId,id}) {
  const p=selection(authorizedProjects,[projectId])[0]
  if(!p)throw Error('项目未授权')
  return {...get(p.cwd,id),projectId:p.id,projectName:p.name}
}
