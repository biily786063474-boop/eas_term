import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
const bin=path.resolve('resources/island-native/bin/IslandHost.app/Contents/MacOS/IslandHost')
assert.ok(fs.existsSync(bin),'native helper must be built')
const child=spawn(bin,[String(process.pid),path.resolve('out/island-native-assets'),'test-generation'],{stdio:['pipe','pipe','pipe']})
let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x)
try{
 child.stdin.write(JSON.stringify({v:1,generation:'test-generation',type:'bounds',x:300,y:100,width:400,height:150})+'\n')
 for(let i=0;i<100&&!output.includes('"ready"');i++)await new Promise(r=>setTimeout(r,100))
 assert.ok(output.includes('"ready"'),errors+' '+output)
 child.stdin.end()
 const code=await Promise.race([new Promise(r=>child.on('exit',r)),new Promise((_,j)=>setTimeout(()=>j(Error('orphan after EOF')),3000))]);assert.equal(code,0)
 console.log('native HTML ready + parent pipe EOF cleanup passed')
}finally{if(child.exitCode===null)child.kill('SIGTERM')}
