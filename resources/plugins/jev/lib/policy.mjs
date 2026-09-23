// Pure policy only. Host authentication and credential lifecycle are separate gates.
const defaults=Object.freeze({milestone:false,project:false,triage:true,docs:true,eval:true,route:true,custom:true})
export function createPolicy(initial){
 let connected=false,enabled=false,generation=0
 const selected={...defaults}
 if(initial){for(const key of Object.keys(selected)){if(typeof initial[key]!=='boolean')throw Error('Invalid preferences');selected[key]=initial[key]}}
 const known=key=>{if(!Object.hasOwn(selected,key))throw Error('Unknown capability')}
 return {
  snapshot:()=>({connected,enabled,generation,selected:{...selected}}),
  setConnected(value){connected=value===true;enabled=false;generation++},
  enable(){if(!connected)throw Error('No verified connection');enabled=true},
  pause(){enabled=false;generation++},
  select(key,value){known(key);selected[key]=value===true;generation++},
  selectAll(value){for(const key of Object.keys(selected))selected[key]=value===true;generation++},
  begin(key){known(key);if(!connected||!enabled||!selected[key])throw Error('Capability disabled');return Object.freeze({key,generation})},
  valid(ticket){return !!ticket&&connected&&enabled&&Object.hasOwn(selected,ticket.key)&&selected[ticket.key]&&ticket.generation===generation}
 }
}
