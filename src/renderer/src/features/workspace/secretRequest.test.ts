import test from 'node:test'
import assert from 'node:assert/strict'
import { askForSecret, currentSecretRequest, resolveSecretRequest } from './secretRequest.ts'

test('解锁后可立即请求授权，不被自己的解锁限流挡住', async () => {
  const unlock = askForSecret({ name: 'Unlock', vars: [], purpose: 'fixture', mode: 'unlock' }, 'agent-fixture')
  assert.equal(currentSecretRequest()?.mode, 'unlock')
  resolveSecretRequest({ saved: true })
  await unlock
  const request = askForSecret({ name: 'Group', vars: ['X'], purpose: 'fixture' }, 'agent-fixture')
  assert.equal(currentSecretRequest()?.name, 'Group')
  resolveSecretRequest({ saved: true, groups: ['Group'], vars: ['X'] })
  assert.equal((await request).saved, true)
  assert.equal(currentSecretRequest(), null)
})

test('旧弹窗异步保存回调不能批准下一次请求', async () => {
  const originalNow = Date.now
  Date.now = () => originalNow() + 120_000
  try {
    const oldReq = { name: 'Old', vars: ['X'], purpose: 'fixture', mode: 'fix' as const }
    const old = askForSecret(oldReq, 'old-session')
    resolveSecretRequest({ saved: false }, oldReq)
    await old
    const nextReq = { name: 'Next', vars: [], purpose: 'fixture', mode: 'unlock' as const }
    const next = askForSecret(nextReq, 'next-session')
    resolveSecretRequest({ saved: true }, oldReq)
    assert.equal(currentSecretRequest(), nextReq)
    resolveSecretRequest({ saved: false }, nextReq)
    assert.equal((await next).saved, false)
  } finally { Date.now = originalNow }
})

test('请求超时清除弹窗、不记作用户拒绝，且旧回调不影响新请求', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 600_000 })
  const req = { name: 'Timeout', vars: ['X'], purpose: 'fixture' }
  for (let i = 0; i < 2; i++) {
    const result = askForSecret(req, 'timeout-session')
    const rejected = assert.rejects(result, /等待.*超时.*已关闭.*重新请求/)
    t.mock.timers.tick(9 * 60_000)
    assert.equal(currentSecretRequest(), null)
    await rejected
  }
  const nextReq = { ...req, name: 'Next' }
  const next = askForSecret(nextReq, 'timeout-session')
  resolveSecretRequest({ saved: true }, req)
  assert.equal(currentSecretRequest(), nextReq)
  resolveSecretRequest({ saved: true }, nextReq)
  await next
  t.mock.timers.tick(9 * 60_000)
  assert.equal(currentSecretRequest(), null)
})

// 「请求来自」上下文要真的到达弹窗的数据源。mcpHandler 把 project/origin 塞进请求对象后，
// askForSecret 整体透传、currentSecretRequest() 原样吐出给 SecretRequestModal。
// 这条钉住那个透传——将来谁把字段从接口或 askForSecret 里漏掉，这里当场红。
test('project / origin 随密钥请求透传到弹窗数据源', () => {
  // 跳过 MIN_GAP 限流（前面的 unlock 测试刚设过 lastAskAt['unlock']），同 test 2 的手法
  const originalNow = Date.now
  Date.now = () => originalNow() + 300_000
  try {
    const p = askForSecret(
      { name: '解锁密钥柜', vars: ['IMAGE_API_KEY'], purpose: '检查密钥', mode: 'unlock', project: '命运呐', origin: '部署终端' },
      'pty-origin-passthrough'
    )
    const cur = currentSecretRequest()
    assert.equal(cur?.project, '命运呐')
    assert.equal(cur?.origin, '部署终端')
    assert.deepEqual(cur?.vars, ['IMAGE_API_KEY'])
    // 收尾：resolve 掉那个 Promise（内部会 clearTimeout，避免 9 分钟定时器吊住测试进程）
    resolveSecretRequest({ saved: false })
    return p.then(
      () => {},
      () => {}
    )
  } finally {
    Date.now = originalNow
  }
})
