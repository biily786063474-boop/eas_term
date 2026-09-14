import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const source=ts.createSourceFile('pty.ts',fs.readFileSync(new URL('../pty.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='killTree')!
const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
test('closing a POSIX terminal requests owned PTY hangup as well as descendant termination',()=>{
 const signals:unknown[]=[],hangups:unknown[]=[]
 const kill=runInNewContext(code+';killTree',{process:{platform:'darwin',kill:(...args:unknown[])=>signals.push(args)},ttyPids:()=>[42,43]})
 kill({pty:{pid:42,kill:(signal?:string)=>hangups.push(signal)}})
 assert.equal(signals.length,3)
 assert.deepEqual(hangups,[undefined])
})
