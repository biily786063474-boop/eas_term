/** A native confirmation authorizes exactly one immutable call, not future model input. */
export async function approveJevDecision(params:unknown,deps:{valid:()=>boolean;confirm:(preview:string)=>Promise<boolean>}):Promise<{name:string;arguments:{state:unknown;questions:Record<string,unknown>}}>{
 const encoded=JSON.stringify(params)
 if(!encoded||Buffer.byteLength(encoded)>16000)throw Error('判断材料过长，请分批预览确认（上限 16KB）')
 const copy=JSON.parse(encoded)
 if(!copy||!['jev_decide','jev_triage','jev_docs','jev_eval','jev_route','jev_custom'].includes(copy.name)||!copy.arguments||typeof copy.arguments!=='object'||Array.isArray(copy.arguments)||Object.keys(copy.arguments).some(k=>!['state','questions'].includes(k)))throw Error('判断参数无效')
 if(!deps.valid())throw Error('原会话或授权已失效')
 const preview=JSON.stringify({model:'jev-1.13.0',state:copy.arguments.state,questions:copy.arguments.questions},null,2)
 if(!await deps.confirm(preview))throw Error('已取消材料发送')
 if(!deps.valid())throw Error('原会话或授权已失效')
 return copy
}
