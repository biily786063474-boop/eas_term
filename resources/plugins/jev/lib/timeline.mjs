/** Only host-selected pending candidates; suggestions never become completion evidence. */
export async function adviseTimeline(runtime,{candidate,projects,sourceProjectId,allowedCapabilities},{signal}={}){
 if(!candidate||typeof candidate.id!=='string'||typeof candidate.title!=='string'||candidate.review!=='pending')throw Error('Invalid pending candidate')
 if(!Array.isArray(projects)||projects.length>32||projects.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'))throw Error('Invalid authorized projects')
 const state=runtime.snapshot();if(allowedCapabilities){state.selected={...state.selected,milestone:state.selected.milestone&&allowedCapabilities.milestone===true,project:state.selected.project&&allowedCapabilities.project===true}}
 if(sourceProjectId){state.selected={...state.selected,milestone:state.selected.milestone&&state.automationScopes?.milestone.includes(sourceProjectId)===true,project:state.selected.project&&state.automationScopes?.project.includes(sourceProjectId)===true}}
 const suggestions={candidateId:candidate.id,requiresReview:true}
 if(!state.enabled||!state.connected)return suggestions
 if(signal?.aborted)throw Error('Jev request revoked')
 const material={title:candidate.title.slice(0,240),summary:typeof candidate.summary==='string'?candidate.summary.slice(0,2000):''}
 const questions={},options=Object.fromEntries(projects.map((p,i)=>['p'+i,p.name.slice(0,120)]));options.unknown='Uncertain or no suitable authorized project'
 if(state.selected.milestone)questions.worthKeeping={type:'noul',instructions:'Does this describe a concrete outcome worth human review as a milestone? Claims of completion alone are not verification; do not judge the task accepted.'}
 if(state.selected.project&&projects.length){
  if(projects.some(p=>p.id===sourceProjectId))suggestions.project={projectId:sourceProjectId,confidence:1}
  else questions.project={type:'choice',instructions:'Recommend one authorized project label based on this candidate. Choose unknown when uncertain. Do not move records or files.',criteria:options}
 }
 if(!Object.keys(questions).length)return suggestions
 const result=await runtime.ask(state.selected.milestone?'milestone':'project',{model:'jev-1.13.0',state:material,questions},{signal})
 if(signal?.aborted)throw Error('Jev request revoked')
 if(questions.worthKeeping)suggestions.milestone={probability:result.answers.worthKeeping.noul,accepted:false}
 if(questions.project){
  const answer=result.answers.project,index=Object.keys(options).indexOf(answer.choice)
  // Conservative initial threshold, not a claim of calibrated Chinese accuracy.
  suggestions.project={projectId:answer.confidence>=.85?projects[index]?.id??null:null,confidence:answer.confidence}
 }
 return suggestions
}
