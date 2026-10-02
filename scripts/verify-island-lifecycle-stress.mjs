import {spawn} from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const app=path.resolve('release-island-lab/mac-arm64/Eas-Term Island Lab.app/Contents/Resources')
const bin=path.join(app,'island-native/IslandHost.app/Contents/MacOS/IslandHost'),assets=path.join(app,'island-assets')
const results=[]
function launch(g='stress'){
 const p=spawn(bin,[String(process.pid),assets,g],{stdio:'pipe'});let out=''
 p.stdout.on('data',b=>out+=b);p.stderr.resume();p.stdin.on('error',()=>{})
 const done=new Promise(r=>p.once('close',(code,signal)=>r({code,signal})))
 return {p,done,output:()=>out}
}
async function bounded(promise,ms=6000){let timer;try{return await Promise.race([promise,new Promise((_,r)=>timer=setTimeout(()=>r(Error('timeout')),ms))])}finally{clearTimeout(timer)}}
async function ready(h){await bounded((async()=>{while(!h.output().includes('"ready"')){if(h.p.exitCode!==null)throw Error('early exit');await new Promise(r=>setTimeout(r,30))}})())}
async function finish(h){h.p.stdin.end();assert.equal((await bounded(h.done)).code,0)}
for(let i=0;i<20;i++){
 const h=launch();try{await ready(h);await finish(h);results.push({test:'ready/eof '+i,pass:true})}finally{if(h.p.exitCode===null)h.p.kill('SIGKILL')}
}
const cases=[{type:'unknown'},{type:'show',generation:'old'},{type:'bounds',x:0,y:0,width:10000,height:30},{type:'ignoreMouse',value:'yes'},{v:2,type:'close'}]
for(const c of cases){const h=launch();try{h.p.stdin.end(JSON.stringify({v:1,generation:'stress',...c})+'\n');assert.equal((await bounded(h.done)).code,2);results.push({test:'reject '+JSON.stringify(c),pass:true})}finally{if(h.p.exitCode===null)h.p.kill('SIGKILL')}}
const a=launch('a'),b=launch('b');try{
 await Promise.all([ready(a),ready(b)]);a.p.kill('SIGKILL');await bounded(a.done)
 assert.equal(b.p.exitCode,null);b.p.stdin.write(JSON.stringify({v:1,generation:'b',type:'state',value:{running:[],notices:[]}})+'\n');await finish(b)
 results.push({test:'killing one owned host preserves independent host',pass:true})
}finally{for(const h of [a,b])if(h.p.exitCode===null)h.p.kill('SIGKILL')}
fs.mkdirSync('docs/verification/island-native-host-20260928/extended',{recursive:true})
fs.writeFileSync('docs/verification/island-native-host-20260928/extended/lifecycle.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(`${results.length} actual-process checks passed`)
