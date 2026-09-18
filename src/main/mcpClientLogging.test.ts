import {test} from 'node:test'
import assert from 'node:assert/strict'
import {McpClient} from './mcpClient.ts'

test('configured child stderr is drained without persisting secrets, even across chunks',async()=>{
 const logs:string[]=[];const log=console.log;console.log=(...args)=>{logs.push(args.join(' '))}
 const child=new McpClient({name:'sensitive',command:process.execPath,args:['-e',`process.stderr.write('secret-first');setTimeout(()=>process.stderr.write('secret-last'),10)`],cwd:process.cwd(),env:{EAS_PLUGIN_CONFIG:'{"key":"secret"}'},suppressStderr:true})
 try{await child.exited;await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(logs,[])}finally{child.close();console.log=log}
})
