/** A running tool may use an already counted service; do not sum both as processes. */
export function runtimeCounts(sample:{services?:readonly {state:string}[];tasks?:readonly {state:string}[]}|null){
 return sample?{services:sample.services?.length??0,waiting:sample.tasks?.filter(t=>t.state==='queued').length??0}:{services:null,waiting:null}
}
