/** Recent is strictly user recency, not task urgency. Default retains the status list ordering. */
export function orderProjectMenu<T extends {id:string}>(projects:readonly T[],mode:'default'|'recent',projectMru:readonly string[],rows:readonly {projectId:string}[]):T[]{
 const rank=new Map(rows.map((r,i)=>[r.projectId,i]))
 const mru=new Map(projectMru.map((id,i)=>[id,i]))
 return [...projects].sort((a,b)=>mode==='recent'
  ? (mru.get(a.id)??Number.MAX_SAFE_INTEGER)-(mru.get(b.id)??Number.MAX_SAFE_INTEGER)
  : (rank.get(a.id)??Number.MAX_SAFE_INTEGER)-(rank.get(b.id)??Number.MAX_SAFE_INTEGER))
}
