#!/usr/bin/env node
// Opt-in only. Run against a separately started EAS_VERIFY instance, never production.
// node scripts/verify-low-memory.mjs --port 9446 --phase idle --seconds 180
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1]}
const phase=arg('--phase','idle'),seconds=Number(arg('--seconds','180')),port=Number(arg('--port','9446'))
if(!['cold','idle','first-message','three-frames','media','media-closed'].includes(phase)||!Number.isInteger(seconds)||seconds<0||seconds>1800||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid phase, duration or local port')
const expression=`(async()=>{if(!window.__easVerify)throw Error('Isolated verification instance required');const m=await window.api.runtimeMonitor(true);return {sampledAt:m.sampledAt,totalMemoryBytes:m.totalMemoryBytes,memoryUsedBytes:m.memoryUsedBytes,cpuPercent:m.cpuPercent,metricsAvailable:m.metricsAvailable,processes:m.processes}})()`
const samples=[]
for(let i=0;i<=Math.floor(seconds/5);i++){
 if(i)await sleep(5000)
 samples.push(JSON.parse(execFileSync(process.execPath,['scripts/eval-in-app.mjs',expression,'--port',String(port)],{encoding:'utf8',timeout:15000})))
}
const rss=samples.flatMap(s=>typeof s.processes?.workingSetBytes==='number'?[s.processes.workingSetBytes]:[])
const report={phase,platform:os.platform(),arch:os.arch(),physicalMemoryBytes:os.totalmem(),durationSeconds:seconds,scope:'Electron-owned browser/render/GPU/utility only; external CLI/plugin memory excluded',sampledPeakWorkingSetBytes:rss.length?Math.max(...rss):null,samples}
const out=path.resolve('docs/verification/low-memory');fs.mkdirSync(out,{recursive:true})
const file=path.join(out,phase+'-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2))
console.log('Saved '+samples.length+' aggregate samples: '+file)
