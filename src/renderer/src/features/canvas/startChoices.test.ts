import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startChoices } from './startChoices.ts'
import type { CliInfo } from '../../../../shared/agentChat'

const cli = (id: string, p: Partial<CliInfo> = {}): CliInfo =>
  ({ id, displayName: id, available: true, chatSupported: true, ...p }) as CliInfo

const ids = (list: { cli: CliInfo }[]): string[] => list.map((c) => c.cli.id)

test('**顺序按常用度固定**：claude · codex · 默认 harness', () => {
  // 故意打乱输入 —— 顺序不该跟着 listClis 的返回顺序走
  assert.deepEqual(ids(startChoices([cli('omp'), cli('codex'), cli('claude')], () => true)),
    ['claude', 'codex', 'omp'])
})

test('**顺序不随「装了什么」变** —— 那是 pickCli 的规矩，不是这排按钮的', () => {
  // pickDefaultCli 会把随包的 omp 排最后/最前（看别人装没装），这里恒定
  const 全没装 = startChoices([cli('claude', { available: false }), cli('codex', { available: false }), cli('omp')], () => true)
  const 全装了 = startChoices([cli('claude'), cli('codex'), cli('omp')], () => true)
  assert.deepEqual(ids(全没装), ids(全装了))
})

test('名单外的第四个 CLI 排在后面，不会整个消失', () => {
  assert.deepEqual(ids(startChoices([cli('newcli'), cli('claude')], () => true)), ['claude', 'newcli'])
})

test('不支持在这儿跑会话的不列出来 —— 列了也是点了没用', () => {
  assert.deepEqual(ids(startChoices([cli('claude'), cli('x', { chatSupported: false })], () => true)), ['claude'])
})

test('**没装 → 「点一下装好」**，不是藏起来', () => {
  const [c] = startChoices([cli('claude', { available: false })], () => true)
  assert.equal(c.state, 'need-install')
  assert.equal(c.hint, '点一下装好')
})

test('装了但没配好 → 「点一下登录」（和没装是两件事）', () => {
  const [c] = startChoices([cli('claude')], () => false)
  assert.equal(c.state, 'need-setup')
})

test('**探测还没回来（undefined）→ 按就绪显示**，别在加载中吓唬人', () => {
  const [c] = startChoices([cli('claude')], () => undefined)
  assert.equal(c.state, 'ready')
  assert.equal(c.hint, undefined, '一切正常时不该有字解释「一切正常」')
})

test('没装优先于没配好 —— 都不成立时先说装', () => {
  const [c] = startChoices([cli('claude', { available: false })], () => false)
  assert.equal(c.state, 'need-install')
})
