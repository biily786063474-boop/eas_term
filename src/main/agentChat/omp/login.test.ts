import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { cancelOmpLogin, ompLoginInFlight, startOmpLogin, submitOmpLogin, type OmpLoginState } from './login.ts'
import { ompBinPathOrNull } from './paths.ts'

// ── 2026-09-02 真机：贴完 key 点「提交」，界面就停在那儿再也不动 ─────────────
//
// 用户原话：「点击提交 key 之后就卡住了 就没了 …UI 层面没往下走。」
//
// 直接起因是那次登录已经被 `cancelOmpLogin()` 掐掉了（我在验证时收进程，
// 而用户正在同一个面板里打字）。但真正的缺陷是**掐掉这件事没人告诉界面**：
//
//   cancelOmpLogin() 先 `current = null` 再 kill，
//   于是 exit 回调开头那句 `if (!current) return` 把 failed 事件整个吞掉。
//
// 结果就是一个**看起来还活着、其实已经死了**的表单：输入框还在、按钮还能点，
// 点下去什么也不会发生，而且不会有任何提示。
//
// 这类「没人通知」的死界面是最难自查的一种 —— 用户没有任何线索可循。

const bin = ompBinPathOrNull({
  isPackaged: false,
  resourcesPath: '',
  appPath: process.cwd(),
  userData: '/tmp/unused',
  home: '/tmp/unused'
})
const haveBin = !!bin && fs.existsSync(bin)

function isolatedHost(): { isPackaged: boolean; resourcesPath: string; appPath: string; userData: string; home: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-login-test-'))
  return { isPackaged: false, resourcesPath: '', appPath: process.cwd(), userData: path.join(tmp, 'ud'), home: tmp }
}

test('没有登录在跑时提交 → **明确说不行**，不能静默失败', () => {
  cancelOmpLogin()
  const r = submitOmpLogin('sk-whatever')
  assert.equal(r.ok, false)
  assert.ok((r.error ?? '').length > 0, '连句话都不给，界面就只能干等着')
})

test(
  '**取消登录必须通知界面** —— 不通知的话表单看起来还活着，点提交什么也不会发生',
  { skip: haveBin ? false : '仓库里没有 omp 二进制（先跑 npm run omp:fetch）' },
  async () => {
    const host = isolatedHost()
    const seen: OmpLoginState[] = []
    const started = startOmpLogin(host, 'minimax-code-cn', (s) => seen.push(s))
    assert.equal(started.ok, true)

    // 等它问到输入那一步（真二进制，给足时间）
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && !seen.some((s) => s.phase === 'input')) {
      await new Promise((r) => setTimeout(r, 200))
    }
    assert.ok(seen.some((s) => s.phase === 'input'), '没等到它要求输入，后面的断言无从谈起')

    const before = seen.length
    cancelOmpLogin()
    assert.ok(seen.length > before, '取消之后一个事件都没推 —— 界面永远不知道自己死了')
    const last = seen[seen.length - 1]
    assert.ok(
      last.phase === 'failed' || last.phase === 'done',
      `取消后停在 ${last.phase} —— 那不是个终态，界面会一直等下去`
    )
    assert.equal(ompLoginInFlight(), null, '取消之后不该还认为有登录在跑')
  }
)
