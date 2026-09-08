import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ompLoginUrl, ompPromptKind } from './ompLogin.ts'
test('授权入口只允许 HTTPS 或本机 HTTP',()=>{
 for(const u of ['javascript:alert(1)','file:///tmp/x','http://remote.test/x','https://user:pw@test.com'])assert.equal(ompLoginUrl(u),undefined)
 for(const u of ['https://accounts.google.com/auth','http://127.0.0.1:8085/launch'])assert.equal(ompLoginUrl(u),u)
})
test('输入类型来自原生提示而非供应商名单；未知提示保持文本',()=>{
 assert.equal(ompPromptKind('Enter API key:'),'secret')
 assert.equal(ompPromptKind('Paste the authorization code (or full redirect URL):'),'code')
 assert.equal(ompPromptKind('Choose account:'),'text')
})
