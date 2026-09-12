import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {ownCodexLauncher,stopAgentProcess} from '../../mcp/owned-launcher-control.mjs'

test('owned launcher receives soft and hard controls without an outer process kill',async()=>{
 const p=spawn(process.execPath,['-e',`const seen=[];process.on('message',m=>{seen.push(m);if(seen.length===2){console.log(JSON.stringify(seen));process.disconnect()}});console.log('READY')`],{stdio:['ignore','pipe','pipe','ipc']})
 ownCodexLauncher(p)
 let out='';p.stdout.on('data',c=>out+=c)
 const exited=new Promise(resolve=>p.once('exit',resolve))
 await new Promise(resolve=>p.stdout.once('data',resolve))
 stopAgentProcess(p);stopAgentProcess(p,'SIGKILL');await exited
 assert.equal(p.killed,false)
 assert.deepEqual(JSON.parse(out.trim().split('\n')[1]),[{type:'eas:codex:cancel',signal:'SIGTERM'},{type:'eas:codex:cancel',signal:'SIGKILL'}])
})
test('unowned Claude/POSIX/OMP process retains direct signal semantics',async()=>{
 const p=spawn(process.execPath,['-e',"console.log('READY');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']})
 const exited=new Promise(resolve=>p.once('exit',resolve));await new Promise(resolve=>p.stdout.once('data',resolve))
 stopAgentProcess(p);await exited;assert.equal(p.killed,true)
})
test('failed owned IPC write disconnects channel, never force kills outer process',()=>{
 let disconnected=false
 const p={connected:true,exitCode:null,signalCode:null,send(_m,cb){cb(new Error('closed'))},disconnect(){disconnected=true;this.connected=false},kill(){throw new Error('unsafe outer kill')}}
 ownCodexLauncher(p);stopAgentProcess(p,'SIGKILL');assert.equal(disconnected,true)
 stopAgentProcess(p) // already disconnected is not a reason to kill the owner
})
test('production app shutdown and window cleanup route both soft/hard passes through owned control',()=>{
 const source=ts.createSourceFile('session.ts',readFileSync(new URL('./agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const names=new Set(['killAllAgentChatSessions','killAgentChatSessionsForWebContents'])
 const code=ts.transpileModule(source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(source).replace(/^export /,'')).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const messages=[],timers=[],accounted=[]
 const proc={connected:true,exitCode:null,signalCode:null,send(m,cb){messages.push(m);cb(null)},disconnect(){},kill(){throw new Error('unsafe outer kill')}}
 ownCodexLauncher(proc)
 const sessions=new Map([['s',{wcId:7,rec:{id:'s'},proc}]])
 const api=runInNewContext(code+'\n({killAllAgentChatSessions,killAgentChatSessionsForWebContents})',{sessions,stopAgentProcess,interruptUsage(rec){accounted.push(rec.id)},revokeCapabilitySession(){},forgetPty(){},transcripts:{drop(){}},setTimeout(fn){timers.push(fn);return {unref(){}}}})
 api.killAllAgentChatSessions();api.killAllAgentChatSessions(true);api.killAgentChatSessionsForWebContents(7);timers.forEach(fn=>fn())
 assert.deepEqual(messages.map(m=>m.signal),['SIGTERM','SIGKILL','SIGTERM','SIGKILL']);assert.equal(sessions.size,0);assert.deepEqual(accounted,['s','s','s'])
})
