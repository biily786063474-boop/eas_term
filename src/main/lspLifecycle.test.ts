import {test} from 'node:test'
import assert from 'node:assert/strict'
import {LspClient} from './lspClient.ts'

test('failed LSP handshake closes the actual child and settles completed',async()=>{
 const script=`let data=Buffer.alloc(0);process.stdin.on('data',chunk=>{data=Buffer.concat([data,chunk]);const end=data.indexOf('\\r\\n\\r\\n');if(end<0)return;const length=Number(/Content-Length: (\\d+)/i.exec(data.subarray(0,end).toString())[1]);if(data.length<end+4+length)return;const req=JSON.parse(data.subarray(end+4,end+4+length));const body=JSON.stringify({jsonrpc:'2.0',id:req.id,result:{capabilities:{}}});process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body);});setInterval(()=>{},1000)`
 const client=new LspClient({bin:process.execPath,args:['-e',script],label:'isolated-lsp'},process.cwd())
 try{
  await assert.rejects(client.start(),/不支持调用层级/)
  assert.ok(client.completed instanceof Promise)
  let timeout:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([client.completed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('child did not close')),2000)})])}finally{clearTimeout(timeout)}
 }finally{client.stop()}
})
