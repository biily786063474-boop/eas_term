// 2026-09-30 真机截图：解锁后的「信任此设备」复选框压在密钥柜弹层左边框上（x≈111），
// 跟上面那段说明文字（.sec-note，左右 26px）对不齐。它是 .sec-pop 的直接子元素，
// 只吃到 .vault-trust-option 的 margin: 12px 0。这里钉住弹层内的水平边距与 .sec-note 一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('./workspace.css', import.meta.url), 'utf8')
const tsx = fs.readFileSync(new URL('./SecretsPanel.tsx', import.meta.url), 'utf8')
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}
const inlineMargin = (body) => {
  const m = body && body.match(/margin:\s*([^;]+);/)
  if (!m) return null
  const parts = m[1].trim().split(/\s+/)
  return parts.length === 1 ? parts[0] : parts[1]
}

test('弹层里的「信任此设备」与 .sec-note 同一条左右边距，不贴边框', () => {
  // 前提：它确实挂在 .sec-pop 下（说明文字 .sec-note 的兄弟）
  assert.match(tsx, /<p className="sec-note">[\s\S]*?<\/p>\}\s*\n\s*\{st\.configured && !st\.locked && <label className="vault-trust-option">/)
  const note = inlineMargin(rule('.sec-note'))
  const trust = inlineMargin(rule('.sec-pop > .vault-trust-option'))
  assert.ok(note, '找不到 .sec-note 的 margin')
  assert.equal(trust, note, '.sec-pop > .vault-trust-option 的水平边距必须与 .sec-note 一致')
})

test('信任选项在居中的锁屏里也左对齐（复选框、标题、说明同一列）', () => {
  assert.match(rule('.vault-trust-option') ?? '', /text-align:\s*left/)
})

test('AI 请求的解锁弹窗：「要用的密钥」与锁图标之间留 .sreq 的标准行距', () => {
  const gap = css.match(/\n\s*\.sreq \{([^}]*)\}/)?.[1].match(/\n\s*gap:\s*([^;]+);/)?.[1]
  assert.ok(gap, '找不到 .sreq 的 gap')
  assert.match(rule('.vault-gate-dialog') ?? '', /gap:\s*0/)
  const keys = css.match(/\.vault-gate-dialog > \.sreq-origin, \.vault-gate-dialog > \.sreq-origin-keys\s*\{([^}]*)\}/)
  assert.ok(keys, '锁图标上方的块必须补回间距')
  assert.equal(keys[1].match(/margin-bottom:\s*([^;]+);/)?.[1].trim(), gap.trim())
})
