import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./VaultGate.tsx', import.meta.url), 'utf8')

test('密钥柜安全说明以悬停气泡呈现，不占据弹窗内部展开层级', () => {
  assert.match(source, /className="vault-help"/)
  assert.match(source, /data-tip=\{/)
  assert.match(source, /tabIndex=\{0\}/)
  assert.match(source, /密钥如何保护？/)
  assert.match(source, /由系统安全存储保护/)
  assert.match(source, /解锁不等于全部授权/)
  assert.match(source, /不参与密钥加密/)
  assert.match(source, /st\.lockedOutMs > 0 && <p role="status"/)
  assert.match(source, /error && <p role="alert"/)
  assert.doesNotMatch(source, /<details className="vault-explain">/)
  assert.doesNotMatch(source, /<summary>密钥如何保护？<\/summary>/)
})
