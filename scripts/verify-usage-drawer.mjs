import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-usage-verify-'))
const now=Date.now(),root=process.cwd()
const projects=[{id:'usage-fixture-a',name:'用量验收 · 测试项目 A',path:root,addedAt:1},{id:'usage-fixture-b',name:'用量验收 · 测试项目 B',path:path.join(dir,'project-b'),addedAt:1}]
fs.mkdirSync(projects[1].path)
fs.writeFileSync(path.join(dir,'projects.json'),JSON.stringify(projects))
const rows=Array.from({length:235},(_,i)=>({id:'fixture-'+i,session:'fixture-session-'+Math.floor(i/12),project:projects[i%2].path,projectName:projects[i%2].name,cli:['claude','codex','omp'][i%3],model:'测试模型（非账单）',startedAt:now-(i+1)*35*60000,endedAt:now-i*35*60000,status:i%13===0?'interrupted':'completed',...(i%11?{meter:{input:10000+(i%20)*3500,output:800+i*7,cacheRead:6000,cacheWrite:2000}}:{}),...(i%3===0?{costUsd:.012}:{}),stage:i%4===0?'回归测试':i%4===1?'界面实现':undefined}))
fs.writeFileSync(path.join(dir,'usage-ledger.json'),JSON.stringify({version:1,since:now-6*86400000,rows}))
console.log('TEST DATA ONLY userData='+dir)
const child=spawn(path.join(root,'node_modules/.bin/electron'),['.','--remote-debugging-port=9452','--user-data-dir='+dir],{stdio:'inherit',env:{...process.env,EAS_VERIFY:'1'}})
console.log('Owned PID='+child.pid)
process.on('SIGINT',()=>child.kill('SIGTERM'))
child.on('exit',code=>{fs.rmSync(dir,{recursive:true,force:true});process.exit(code??0)})
