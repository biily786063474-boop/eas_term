import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { guardPluginDir, safeExtractTarget, verifySha256 } from './pluginInstall.ts'

const HOME = '/Users/x'

test('guardPluginDir：只允许 ~/.eas/plugins/<name>/，name 过 NAME_RE', () => {
  assert.equal(guardPluginDir('board', HOME).ok, true)
  const ok = guardPluginDir('board', HOME)
  if (ok.ok) assert.equal(ok.dir, '/Users/x/.eas/plugins/board')
  // 非法 name / 路径穿越 一律拒
  for (const bad of ['..', '../evil', 'a/b', 'Bad_Name', '', '.hidden', 'a'.repeat(50)]) {
    assert.equal(guardPluginDir(bad, HOME).ok, false, bad)
  }
})

test('safeExtractTarget：zip 条目解到目标目录内才放行，穿越即拒', () => {
  const dest = '/tmp/plug/board'
  assert.equal(safeExtractTarget('plugin.json', dest), '/tmp/plug/board/plugin.json')
  assert.equal(safeExtractTarget('ui/panel.html', dest), '/tmp/plug/board/ui/panel.html')
  // 穿越 / 绝对路径 / 软链接式 → null（整包应据此拒）
  assert.equal(safeExtractTarget('../evil.sh', dest), null)
  assert.equal(safeExtractTarget('../../etc/passwd', dest), null)
  assert.equal(safeExtractTarget('/etc/passwd', dest), null)
  assert.equal(safeExtractTarget('ui/../../out', dest), null)
})

test('verifySha256：一致放行，不一致/大小写不敏感处理', () => {
  const buf = Buffer.from('hello plugin')
  const good = createHash('sha256').update(buf).digest('hex')
  assert.equal(verifySha256(buf, good), true)
  assert.equal(verifySha256(buf, good.toUpperCase()), true)   // registry 里若大写也认
  assert.equal(verifySha256(buf, 'a'.repeat(64)), false)
  assert.equal(verifySha256(buf, 'not-a-hash'), false)
})
