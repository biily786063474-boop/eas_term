import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// index.ts / install.ts 顶层 import electron，进不了 node --test；这里只守结构：
// 两个启动函数 spawn 之后必须登记自有进程，IPC 处理器必须把发起窗口传进去。
// 它守不住行为，行为在 ownedProcess.test.ts；它守的是"有人把登记这行删了"。
function fn(file:string,name:string):string{
 const src=ts.createSourceFile(file,readFileSync(new URL('./'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const node=src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)
 assert.ok(node,file+' 缺 '+name);return node.getText(src)
}
test('startLogin / startInstall 在 spawn 后登记自有进程，IPC 传入发起窗口',()=>{
 for(const [file,start,register] of [['index.ts','startLogin','registerCliAuthHandlers'],['install.ts','startInstall','registerCliInstallHandlers']] as const){
  const body=fn(file,start)
  assert.ok(body.includes('registerOwnedCliProcess('),file+' 的 '+start+' 没有登记自有进程')
  assert.ok(body.indexOf('spawn(')<body.indexOf('registerOwnedCliProcess('),'登记必须在 spawn 之后')
  const handlers=fn(file,register)
  assert.match(handlers,/sender\.id/,file+' 的 IPC 处理器没有把发起窗口传给启动函数')
 }
})
