import test from 'node:test'
import assert from 'node:assert/strict'
import { installFeedback } from './cliInstallFeedback.ts'
test('错误分类有中文恢复建议，不把未知错误猜成网络', () => {
 for (const [text,kind] of [['EACCES permission denied','permission'],['ENOSPC no space left','disk'],['Could not resolve host','network'],['超过 10 分钟还没装完','timeout'],['找不到这个命令 PATH','missing'],['something unfamiliar','unknown']]) {
 const x=installFeedback(text,[]);assert.equal(x.kind,kind);assert.ok(x.advice.length>10)
 }
})
test('末尾输出参与分类，未知失败保留原始错误',()=>{
 assert.equal(installFeedback('exit 1',['npm ERR! EACCES']).kind,'permission')
 assert.equal(installFeedback('exit 72',[]).title,'安装未完成')
})
test('官方脚本和包管理器常见错误要给出具体兜底，而不是泛称安装失败',()=>{
 for (const [line,kind] of [
  ['curl: (6) Could not resolve host: claude.ai','network'],
  ['curl: (22) The requested URL returned error: 403','http'],
  ['curl: (60) SSL certificate problem: unable to get local issuer certificate','certificate'],
  ['npm ERR! code EAI_AGAIN','network'],
  ['spawn /bin/bash ENOENT','runtime'],
  ['无法验证程序启动：查状态超时','verify']
 ]) assert.equal(installFeedback(line,[]).kind,kind,line)
})
