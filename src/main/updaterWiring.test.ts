import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// updater.ts 顶层 import electron，进不了 node --test；只守结构：
// update:download 处理器必须经 runManagedTask（窗口归属）并把 AbortSignal 传给下载。
test('update:download 经 runManagedTask 且下载可被信号取消',()=>{
 const src=ts.createSourceFile('updater.ts',readFileSync(new URL('./updater.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const node=src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='registerUpdaterHandlers')
 assert.ok(node);const body=node.getText(src)
 const i=body.indexOf("'update:download'");assert.ok(i>=0)
 const handler=body.slice(i)
 assert.match(handler,/runManagedTask(<[^>]*>)?\(/,'下载没有经过任务准入')
 assert.ok(/signal/.test(handler),'下载没有接 AbortSignal')
 assert.ok(!/download\(latest\.url,\s*\(got/.test(handler),'旧的不可取消下载调用还在')
})
