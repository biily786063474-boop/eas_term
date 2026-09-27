#!/usr/bin/env node
// macOS-only fallback for Electron's missing CDP Browser window domain.
// Operates ONLY on the verified soak launcher's descendant app PID and named window.
import {assertPortOwned} from './lib/diagnostic-safety.mjs'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
const out=path.resolve('docs/verification/memory-soak'),port=Number(process.argv[2]||9463)
assert.equal(process.platform,'darwin')
const result={scope:'native minimize/restore of isolated soak app only',passed:false,samples:[]}
const sample=async label=>{assertPortOwned(port,pid);const expression='(async()=>{if(!window.__easVerify)throw Error("Not isolated");const m=await window.api.runtimeMonitor(true);return {processTree:m.processTree,processes:m.processes}})()';const s=JSON.parse(execFileSync(process.execPath,['scripts/eval-in-app.mjs',expression,'--port',String(port)],{encoding:'utf8',timeout:20000}));result.samples.push({label,at:new Date().toISOString(),...s})}
let pid,restored=false
const ax=code=>execFileSync('/usr/bin/osascript',['-e','tell application "System Events" to tell (first application process whose unix id is '+pid+') to tell window "Eas-Term" to '+code],{encoding:'utf8',timeout:15000}).trim()
try{
 for(let i=0;i<400;i++){const r=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));if(r.error||r.cleanup)throw Error('soak ended before native window test');if(r.samples.at(-1)?.phase==='final-idle')break;if(i===399)throw Error('final idle wait timed out');await sleep(3000)}
 const soak=Number(fs.readFileSync(path.join(out,'RUNNING.local'),'utf8'))
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).split('\n').map(l=>l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m=>({pid:+m[1],parent:+m[2],comm:m[3]}))
 const owned=new Set([soak]);for(let i=0;i<12;i++)for(const r of rows)if(owned.has(r.parent))owned.add(r.pid)
 const candidates=rows.filter(r=>owned.has(r.pid)&&r.comm===path.join(process.cwd(),'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
 assert.equal(candidates.length,1,'exactly one owned Electron app');pid=candidates[0].pid
 await sample('before');ax('set value of attribute "AXMinimized" to true');assert.equal(ax('get value of attribute "AXMinimized"'),'true')
 await sleep(18000);await sample('minimized');assert.equal(ax('get value of attribute "AXMinimized"'),'true')
 ax('set value of attribute "AXMinimized" to false');restored=true;assert.equal(ax('get value of attribute "AXMinimized"'),'false');await sleep(18000);await sample('restored')
 result.passed=true
}catch(e){result.error=String(e);process.exitCode=1}
finally{if(pid&&!restored)try{ax('set value of attribute "AXMinimized" to false');restored=true}catch{};result.restored=restored;fs.writeFileSync(path.join(out,'window-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
