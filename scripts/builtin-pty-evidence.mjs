export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'"
export function nativePtyArgs(cli, prompt, resumeId, model) {
  const select = model ? ['--model', model] : []
  if (cli === 'claude') return ['-p', '--verbose', '--output-format', 'stream-json', ...select, ...(resumeId ? ['--resume', resumeId] : []), prompt]
  if (cli === 'codex') return ['exec', ...(resumeId ? ['resume'] : []), '--json', '--skip-git-repo-check', ...select, ...(resumeId ? [resumeId] : []), prompt]
  if (cli === 'omp') return ['--print', '--mode', 'json', ...select, ...(resumeId ? ['--resume', resumeId] : []), prompt]
  throw new Error('Unknown native CLI')
}
const textReceipt = value => {
  if (typeof value === 'string') { try { return textReceipt(JSON.parse(value)) } catch { return undefined } }
  if (!value || typeof value !== 'object') return undefined
  if (typeof value.opened === 'string' && typeof value.frameId === 'string') return { opened:value.opened,frameId:value.frameId,as:value.as,nodeId:value.nodeId }
  for (const part of Array.isArray(value) ? value : [value.content,value.result,value.text]) {
    const found=textReceipt(part);if(found)return found
  }
}
/** Extract only fixture-specific native tool receipts, never arbitrary output or credentials. */
export function nativePtyEvidence(cli, raw, file, tool) {
  const rows=[]
  for(const line of raw.split(/\r?\n/)){try{rows.push(JSON.parse(line))}catch{}}
  const calls=new Map(),done=new Map();let resumeId
  const match = name => name===tool || name?.endsWith('_'+tool)
  for(const row of rows){
    if(row.type==='thread.started')resumeId=row.thread_id
    if(typeof row.session_id==='string')resumeId=row.session_id
    if(row.type==='session'&&typeof row.id==='string')resumeId=row.id
    const item=row.item
    if(item?.type==='mcp_tool_call'&&match(item.tool)&&item.arguments?.path===file){
      calls.set(item.id,{id:item.id,tool:item.tool,path:file});if(row.type==='item.completed'&&item.status==='completed')done.set(item.id,textReceipt(item.result))
    }
    const message=row.message??(row.type==='message_end'?row.message:undefined)
    for(const part of message?.content??[]){
      if((part.type==='tool_use'||part.type==='toolCall')&&match(part.name)&&(part.input??part.arguments)?.path===file)calls.set(part.id,{id:part.id,tool:part.name,path:file})
      if(part.type==='tool_result'&&!part.is_error)done.set(part.tool_use_id,textReceipt(part.content))
    }
    if(message?.role==='toolResult'&&!message.isError)done.set(message.toolCallId,textReceipt(message.content))
    if(row.type==='tool_execution_end'&&!row.isError)done.set(row.toolCallId,textReceipt(row.result))
  }
  return {resumeId,receipts:[...calls.values()].filter(call=>done.get(call.id)?.opened===file).map(call=>({...call,result:done.get(call.id)}))}
}
