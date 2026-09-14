import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('./stt.ts',import.meta.url),'utf8')
function handler(transcribeAsync:()=>Promise<string|null>){
 const start=source.indexOf("  ipcMain.handle('stt:transcribeChunk'")
 const code=source.slice(start,source.indexOf("\n  ipcMain.handle('stt:modelStatus'",start))
 let handle:any
 new Function('ipcMain','transcribeAsync',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)({handle:(_name:string,fn:any)=>handle=fn},transcribeAsync)
 return (buf=new Float32Array(100).buffer)=>handle({sender:{}},buf)
}
test('file transcription must reject unavailable or timed-out decode, not report silence',async()=>{
 await assert.rejects(handler(async()=>null)(),/转录|识别/)
})
test('normal silent result remains successful empty text',async()=>{
 assert.equal(await handler(async()=>'')(),'')
})
test('malformed audio is a failure rather than successful silence',async()=>{
 await assert.rejects(handler(async()=>'')(new ArrayBuffer(3)))
})
