/** Only host-selected pending candidates; suggestions never become completion evidence. */
export async function adviseTimeline(runtime,{candidate,projects},{signal}={}){
 if(!candidate||typeof candidate.id!=='string'||typeof candidate.title!=='string'||candidate.review!=='pending')throw Error('Invalid pending candidate')
 if(!Array.isArray(projects)||projects.length>32||projects.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'))throw Error('Invalid authorized projects')
 const state=runtime.snapshot(),suggestions={candidateId:candidate.id,requiresReview:true}
 if(!state.enabled||!state.connected)return suggestions
 const assertActive=()=>{if(signal?.aborted)throw Error('Jev request revoked')}
 assertActive()
 const material={title:candidate.title.slice(0,240),summary:typeof candidate.summary==='string'?candidate.summary.slice(0,2000):''}
 if(state.selected.milestone){
  const result=await runtime.ask('milestone',{model:'jev-latest',state:material,questions:{worthKeeping:{type:'noul',instructions:'Does this describe a concrete outcome worth human review as a milestone? Claims of completion alone are not verification; do not judge the task accepted.'}}},{signal})
  suggestions.milestone={probability:result.answers.worthKeeping.noul,accepted:false}
 }
 assertActive()
 if(state.selected.project&&projects.length){
  const options=Object.fromEntries(projects.map((p,i)=>['p'+i,p.name.slice(0,120)]));options.unknown='Uncertain or no suitable authorized project'
  const result=await runtime.ask('project',{model:'jev-latest',state:material,questions:{project:{type:'choice',instructions:'Recommend one authorized project label based on this candidate. Choose unknown when uncertain. Do not move records or files.',criteria:options}}},{signal})
  const answer=result.answers.project,index=Object.keys(options).indexOf(answer.choice)
  suggestions.project={projectId:projects[index]?.id??null,confidence:answer.confidence}
 }
 assertActive()
 return suggestions
}
