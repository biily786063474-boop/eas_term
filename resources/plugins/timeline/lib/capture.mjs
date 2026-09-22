// Extractive heuristic only: results are review candidates, never proof of delivery.
const positive=/^(?:(?:[-*•]|\d+[.)、])\s*)?(?:\*\*)?(?:已完成|已修复|已交付|完成了|修复了|实现了|已实现|验收通过|implemented\b|delivered\b|fixed\b)/i
const uncertain=/尚未|未完成|未修复|未交付|还没|没有完成|没有修复|没有交付|未验证|待验证|计划|将会|准备|如果|假如|预计|尚需|还需|not yet|not verified|plan to/i
export function candidateFromEvent(event) {
  if(!event || typeof event!=='object')throw Error('完成事件无效')
  for(const key of ['eventId','sessionId','turnId','projectId'])if(typeof event[key]!=='string'||!event[key]||event[key].length>200)throw Error('事件来源身份无效')
  if(typeof event.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!Number.isFinite(Date.parse(event.date))||new Date(event.date).toISOString().slice(0,10)!==event.date||!Number.isFinite(Date.parse(event.completedAt)))throw Error('事件日期无效')
  if(event.outcome!=='completed'||event.recorded===true)return null
  if(typeof event.text!=='string')return null
  const summary=event.text.slice(0,4000).trim()
  // Do not infer success from future, negated, or unresolved delivery statements.
  const title=summary.split(/\r?\n/).map(s=>s.trim()).find(s=>positive.test(s)&&!uncertain.test(s))
  if(!title)return null
  return {title:title.slice(0,160),summary,date:event.date,status:'pending',evidence:[],author:'自动捕获 · 待确认',source:{eventId:event.eventId,sessionId:event.sessionId,turnId:event.turnId,projectId:event.projectId,completedAt:event.completedAt}}
}
