import test from 'node:test'
import assert from 'node:assert/strict'
import { canCancelTask, restoreInstallSnapshot } from './cliInstallPolicy.ts'
test('取消必须同时匹配 CLI、窗口、任务代次',()=>{
 const task={cli:'codex',taskId:8,windowId:3}
 assert.equal(canCancelTask(task,'codex',8,3),true)
 for(const [cli,id,owner] of [['claude',8,3],['codex',7,3],['codex',8,4],['codex',undefined,3]] as const)assert.equal(canCancelTask(task,cli,id,owner),false)
})
test('历史成功不覆盖程序已移除后的新安装意图',()=>{
 assert.equal(restoreInstallSnapshot('done','install',false),false)
 assert.equal(restoreInstallSnapshot('done','install',true),true)
 assert.equal(restoreInstallSnapshot('running','install',false),true)
 assert.equal(restoreInstallSnapshot('failed','install',false),true)
})
