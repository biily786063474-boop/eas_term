import {spawn} from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'
const bin=path.resolve('resources/island-native/bin/IslandHost.app/Contents/MacOS/IslandHost'),assets=path.resolve('out/island-native-assets')
for(const [name,payload,code] of [['bad version',JSON.stringify({v:2,generation:'g',type:'show'})+'\n',2],['oversize','x'.repeat(262145),2],['partial EOF','{"v":',2],['clean EOF','',0]]){
 const p=spawn(bin,[String(process.pid),assets,'g'],{stdio:['pipe','pipe','pipe']});p.stdout.resume();p.stderr.resume()
 const done=new Promise(r=>p.once('exit',r));p.stdin.on('error',()=>{});p.stdin.end(payload)
 let timer
 try{assert.equal(await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+' orphan')),4000)})]),code);console.log('PASS',name)}finally{clearTimeout(timer);if(p.exitCode===null)p.kill('SIGKILL')}
}
