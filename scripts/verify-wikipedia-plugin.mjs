// Candidate verification, never publishes or installs into a real user directory.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {packPlugin} from './pack-plugin.mjs'
import {extractZip} from '../src/main/pluginUnzip.ts'
import {parseManifest} from '../src/main/pluginManifest.ts'
import {McpClient} from '../src/main/mcpClient.ts'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wiki-package-'))
const output='docs/verification/plugin-marketplace/wikipedia-candidate.json'
let client
try{
 const {entry,zipPath}=packPlugin('plugins-store/wikipedia',{outRoot:path.join(root,'packages'),registrySchema:2})
 const dir=path.join(root,'wikipedia');await extractZip(fs.readFileSync(zipPath),dir)
 const parsed=parseManifest(JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'),'utf8')),dir)
 if(!parsed.ok)throw Error(parsed.errors.join(';'))
 client=new McpClient({name:'wikipedia-verification',command:process.execPath,args:[path.join(dir,'server.mjs')],cwd:dir,env:{PATH:process.env.PATH||''}})
 await client.initialize('0.4.102');const tools=await client.listTools()
 if(tools.length!==2)throw Error('Expected two Wikipedia tools')
 const live=process.argv.includes('--live')
 const call=await client.request('tools/call',{name:'wikipedia_search',arguments:live?{query:'Earth',language:'en',limit:1}:{query:'Earth',language:'invalid'}})
 const result={packed:true,manifest:true,tools:tools.map(t=>t.name),liveAttempt:live,livePassed:live&&!call.isError,entry,call,scope:'Actual archive -> extract -> host McpClient -> stdio child. Not actual CLI model or production marketplace install.'}
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result,null,2))
 if(live&&call.isError)process.exitCode=2
}finally{if(client){client.close();await client.exited}fs.rmSync(root,{recursive:true,force:true})}
