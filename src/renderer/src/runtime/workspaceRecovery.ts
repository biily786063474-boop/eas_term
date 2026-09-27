/** Explicit whitelist, not JSON.stringify(store): functions, credentials and
 * unknown extension state must never be implicitly transferred. */
export const workspaceRecoveryKeys:readonly string[]=[
 'projects','activeProjectId','tabs','activeTabId','activeTabByProject','paneSaveTick',
 'maximizedNode','maxScale','canvasSel','canvas','viewMode','viewModePicked','canvasCommittedScale','canvasUndo','undoReady'
]
type Pane={kind?:string;sessionId?:string;initialMessage?:string;owner?:string}
type Node={id?:string;leafId?:string;pane?:Pane;component?:unknown}
type Layout={type?:string;id?:string;pane?:Pane;children?:Layout[]}
export function workspaceRecoveryBlockers(s:{tabs:{root:Layout}[];canvas:{frames:{nodes:Node[]}[];freeNodes:Node[]};pendingConfirm:unknown;editingSticky:unknown}):string[]{
 const blockers:string[]=[],leaves=new Set<string>()
 const checkPane=(p?:Pane)=>{
  if(!p||p.kind!=='agent')blockers.push('pane:'+(p?.kind??'unknown'))
  else if(p.sessionId||p.initialMessage||p.owner)blockers.push('agent:owned-or-pending')
 }
 const walk=(n:Layout)=>{
  if(n.type==='split'&&n.children?.length===2)n.children.forEach(walk)
  else if(n.type==='leaf'&&n.id){leaves.add(n.id);checkPane(n.pane)}
  else blockers.push('layout:unknown')
 }
 s.tabs.forEach(t=>walk(t.root))
 for(const n of [...s.canvas.frames.flatMap(f=>f.nodes),...s.canvas.freeNodes]){
  if(n.component)blockers.push('component:unregistered')
  else if(n.pane)checkPane(n.pane)
  else if(!n.leafId||!leaves.has(n.leafId))blockers.push('node:unresolved')
 }
 if(s.pendingConfirm)blockers.push('dialog:pending')
 if(s.editingSticky)blockers.push('editor:sticky')
 return blockers
}
