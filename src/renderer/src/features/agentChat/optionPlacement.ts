/** Place each reply's option cards after its last assistant segment, not after history. */
export function optionPlacement<T extends {role:string;compact?:unknown}>(turns:readonly T[]):number[][] {
 const result:number[][]=turns.map(()=>[])
 let group:number[]=[]
 const flush=()=>{if(group.length)result[group[group.length-1]]=group;group=[]}
 turns.forEach((turn,i)=>{if(turn.role==='assistant'&&!turn.compact)group.push(i);else flush()})
 flush();return result
}
