import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pickDefaultCli } from './pickCli.ts'
import type { CliInfo } from '../../../../shared/agentChat.ts'

const cli = (id: string, bundled = false): CliInfo =>
  ({ id, displayName: id, available: true, chatSupported: true, bundled }) as unknown as CliInfo

const claude = cli('claude')
const codex = cli('codex')
const boxed = cli('omp', true)

test('**装了 Claude / Codex 时，随包那个排最后** —— 老用户升级当天不该被换掉', () => {
  // 它的 available 恒真（就在安装包里），跟着「取第一个」走就会把人换走，
  // 而他还没配好随包这个，等于软件自己把自己变成不可用。
  assert.equal(pickDefaultCli([boxed, claude, codex])?.id, 'claude')
  assert.equal(pickDefaultCli([boxed, codex])?.id, 'codex')
})

test('**两个都没装时，默认就用随包那个** —— 干净机器上不该先去装别的才能开始', () => {
  // 用户 2026-09-02：「我希望这个 harness 在没安装 cc 和 codex 的时候是默认用这个的。」
  assert.equal(pickDefaultCli([boxed])?.id, 'omp')
})

test('pane 指定了谁就用谁，压过上面两条', () => {
  assert.equal(pickDefaultCli([boxed, claude], codex)?.id, 'codex')
})

test('一个可用的都没有 → null，别硬挑一个出来', () => {
  assert.equal(pickDefaultCli([]), null)
})

test('判据是 `bundled` 能力位，不是 id —— 将来再随包带第二个也成立', () => {
  const second = cli('another-boxed', true)
  assert.equal(pickDefaultCli([second, boxed])?.id, 'another-boxed', '两个随包的，按列表顺序取第一个')
  assert.equal(pickDefaultCli([second, boxed, claude])?.id, 'claude', '有非随包的就让给它')
})

// ── 记住上次用的那个 ──────────────────────────────────────────────────────
//
// 用户 2026-09-02：「用户切换 harness 的时候下次登录和创建会话要把默认调成
// 用户选择的 harness，比如我上次用了 cc 下次新建还是 cc。」
//
// 优先级里它排在「随包排最后」**之前** —— 那条规矩是在用户没表过态时用的推测，
// 而这条是他明确的选择。推测压过选择，就是软件在跟用户较劲。

test('**上次选了谁，下次就默认谁** —— 明确的选择压过一切推测', () => {
  assert.equal(pickDefaultCli([boxed, claude, codex], undefined, 'codex')?.id, 'codex')
})

test('**上次选的就是随包那个，也照样记住** —— 别用「随包排最后」把他的选择顶掉', () => {
  // 这条最容易写反：他装了 Claude 却特意换成随包这个，说明他就是想用它。
  assert.equal(pickDefaultCli([boxed, claude], undefined, 'omp')?.id, 'omp')
})

test('上次那个已经用不了了（卸载了 / 不支持会话）→ 退回推测，不是空白', () => {
  assert.equal(pickDefaultCli([boxed, claude], undefined, 'codex')?.id, 'claude')
  assert.equal(pickDefaultCli([boxed], undefined, 'claude')?.id, 'omp')
})

test('pane 指定的仍然压过「上次用的」—— 插件属于哪个 CLI 是确定的', () => {
  // GitHub 插件是 Codex 的、claude-mem 是 Claude 的：挑错家伙 = 那个插件的工具
  // 在会话里根本不存在。这不是偏好问题，是能不能用的问题。
  assert.equal(pickDefaultCli([boxed, claude, codex], claude, 'codex')?.id, 'claude')
})

test('没有「上次」（第一次用）→ 照旧走推测', () => {
  assert.equal(pickDefaultCli([boxed, claude], undefined, undefined)?.id, 'claude')
  assert.equal(pickDefaultCli([boxed], undefined, '')?.id, 'omp')
})

// ── 2026-09-03：已经绑定的对话不许换底座 ────────────────────────────────────
//
// 用户：「AI 对话中的已经绑定的对话要用对应的 harness，不要随便切换 harness 底座。」
//
// 「绑定」的标志是手里有 `resumeId`（CLI 自己的会话 id）—— 那个 id 只有产生它的
// 那个 harness 认得。这时候**推测链必须整个让位**：
// `readLastCli()` 会随用户在别处切换 harness 而变，
// 而「随包的排最后」「取第一个」更是与这段对话毫无关系的规则。

test('**绑定了就用绑定的那个**，压过 lastUsed', () => {
  const usable = [cli('claude'), cli('codex')]
  const got = pickDefaultCli(usable, usable[1], 'claude')
  assert.equal(got?.id, 'codex', 'pinned 没压过 lastUsed')
})

test('**绑定的那个不可用了 → 不许悄悄换一个顶上**', () => {
  // 卸载了 Codex，而这段对话是 Codex 起的。此时换成 Claude 会拿着
  // Codex 的 resumeId 去 --resume，接不回去且用户看不出来。
  // 判据：pinned 传不进来（调用方 find 不到）时才退回推测 —— 这条钉的是
  // 「调用方必须先确认 pinned 可用」，而不是让 pickDefaultCli 自作主张。
  const usable = [cli('claude')]
  const pinned = usable.find((c) => c.id === 'codex') // undefined
  assert.equal(pinned, undefined, '前提：不可用的 pinned 取不到')
  // 退回推测是有意的 —— 至少让用户看得到界面并自己换一个（见 AgentChatView 注释）
  assert.equal(pickDefaultCli(usable, pinned, undefined)?.id, 'claude')
})

test('没绑定时才轮到 lastUsed（这条是既有行为，别改坏）', () => {
  const usable = [cli('claude'), cli('codex')]
  assert.equal(pickDefaultCli(usable, undefined, 'codex')?.id, 'codex')
})
