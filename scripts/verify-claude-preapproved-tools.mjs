// Isolated app terminal -> managed `claude` launch. A fake `claude` on PATH records the argv
// it actually received; no account, model or installed app involved.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {observeChildClose,cleanupVerificationProfile} from './lib/verification-cleanup.mjs'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eas-claude-allow-'))
const home=path.join(temp,'home'),profile=path.join(temp,'profile'),cwd=path.join(temp,'project'),bin=path.join(temp,'bin'),log=path.join(temp,'argv.jsonl')
const output=path.join(root,'docs/verification/claude-preapproved-tools')
for(const d of [home,profile,cwd,bin,output,path.join(home,'.claude')])fs.mkdirSync(d,{recursive:true})
fs.writeFileSync(path.join(bin,'claude'),`#!${process.execPath}\nconst a=process.argv.slice(2);if(a.includes('--version')){console.log('2.1.283 (Claude Code)');process.exit(0)}\nif(a[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}));process.exit(0)}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');console.log('FAKE-CLAUDE-ARGS-RECORDED')\n`)
fs.chmodSync(path.join(bin,'claude'),0o755)
fs.writeFileSync(path.join(profile,'projects.json'),JSON.stringify([{id:'allow',name:'放行验收',path:cwd}]))
fs.writeFileSync(path.join(profile,'prefs.json'),JSON.stringify({autoUpdateCheck:false,telemetry:false,island:false}))
fs.writeFileSync(path.join(profile,'skill-prefs.json'),JSON.stringify({muted:true}))
const env={...process.env,HOME:home,EAS_VERIFY:'1',PATH:bin+':'+process.env.PATH}
for(const k of Object.keys(env))if(k.startsWith('EAS_TERM_')||k.startsWith('EAS_CAPABILITY_')||k.startsWith('CLAUDE')||/TOKEN|SECRET|API_KEY|PASSWORD/.test(k))delete env[k]
let app,closed,logs='';const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn,n=300){for(let i=0;i<n;i++){const v=await fn();if(v)return v;await wait(100)}throw Error('timeout')}
try{
 app=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[root,'--remote-debugging-port=0','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe']})
 closed=observeChildClose(app);app.stdout.on('data',b=>logs+=b);app.stderr.on('data',b=>logs+=b)
 const port=await until(()=>{try{return +fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return null}})
 const target=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page'&&x.title==='Eas-Term'&&x.url.startsWith('file:'))}catch{return null}})
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pend=new Map()
 ws.onmessage=e=>{const m=JSON.parse(e.data);pend.get(m.id)?.(m);pend.delete(m.id)}
 const ev=expr=>new Promise((res,rej)=>{const k=++id;pend.set(k,m=>m.result?.exceptionDetails?rej(Error(m.result.exceptionDetails.exception?.description)):res(m.result?.result?.value));ws.send(JSON.stringify({id:k,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}))})
 await until(()=>ev('!!window.api?.pty'))
 const pty=await ev(`window.api.pty.create({cwd:${JSON.stringify(cwd)},cols:120,rows:36})`)
 await ev(`window.__out='';window.api.pty.onData(${JSON.stringify(pty.id)},d=>{window.__out+=d});true`)
 await wait(1500)
 await ev(`window.api.pty.write(${JSON.stringify(pty.id)},"claude 帮我出一份汇报页\\r")`)
 const launched=()=>fs.existsSync(log)&&fs.readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l)).find(x=>x.at(-1)==='帮我出一份汇报页')
 await until(launched,300)
 const argv=launched()
 const at=argv.indexOf('--allowedTools')
 assert.ok(at>=0,'受管启动应带 --allowedTools：'+JSON.stringify(argv))
 assert.equal(argv[at+1],'mcp__eas-term__canvas_publish_report')
 assert.ok(argv[at+2].startsWith('--'),'变长参数后必须紧跟另一个选项')
 assert.equal(argv.at(-1),'帮我出一份汇报页','用户的提问必须原样留在最后')
 assert.equal(argv.filter(a=>a.startsWith('mcp__')).length,1)
 const settings=path.join(home,'.claude','settings.json')
 assert.equal(fs.existsSync(settings),false,'不写用户全局 settings.json')
 const out={passed:true,argv:argv.map(a=>a.includes(temp)?a.replace(temp,'<temp>'):a.length>80?a.slice(0,80)+'…':a),checks:['终端里敲 claude 时实际启动参数带 --allowedTools mcp__eas-term__canvas_publish_report','该参数后紧跟 --mcp-config，用户提问原样在最后','没有写 ~/.claude/settings.json'],realApp:true,realCli:false}
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));ws.close()
}catch(e){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),argv:fs.existsSync(log)?fs.readFileSync(log,'utf8'):null},null,2));throw e}
finally{if(app&&closed)await cleanupVerificationProfile({app,childClosed:closed,profile:temp})}
