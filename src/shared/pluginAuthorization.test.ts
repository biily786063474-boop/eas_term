import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as authorization from './pluginAuthorization.ts'
test('account status never claims provider is ready merely because a local token exists',()=>{
 assert.deepEqual(authorization.pluginAuthorizationLabel('authorized'),'凭证已保存 · 尚未测试连接')
 assert.match(authorization.pluginAuthorizationLabel('locked-or-unavailable'),/解锁密钥柜/)
 assert.match(authorization.pluginAuthorizationLabel('disconnected'),/未连接/)
 assert.match(authorization.pluginAuthorizationLabel('expired'),/过期/)
})
