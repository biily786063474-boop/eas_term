import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {UsageBook} from './core.ts'

test('actual usage consumer retains interrupted attempt without recording successful zero-token completion',()=>{
 const source=ts.createSourceFile('index.ts',fs.readFileSync(new URL('./index.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='captureUsage')!
 const code=ts.transpileModule(fn.getText(source).replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const book=new UsageBook()
 const capture=runInNewContext(code+'\ncaptureUsage',{book,init(){},disabled:false,schedule(){},Date})
 const meta={session:'s',cli:'claude',project:'fixture',projectName:'fixture',model:'fixture'}
 book.start(meta,'failed',1)
 capture({id:'s',cli:'claude'},{k:'turn.done',interrupted:true,usageKnown:false,usage:{inputTokens:0,outputTokens:0}})
 assert.equal(book.rows[0].status,'interrupted');assert.equal(book.rows[0].meter,undefined)
 book.start(meta,'ok',2)
 capture({id:'s',cli:'claude'},{k:'turn.done',usage:{inputTokens:3,outputTokens:4},meter:{input:3,output:4}})
 assert.equal(book.rows[1].status,'completed');assert.equal(book.rows[1].meter?.output,4)
})
