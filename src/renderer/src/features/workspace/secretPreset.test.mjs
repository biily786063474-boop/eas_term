import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('切换预设同步更新名称与变量', () => {
  const source = fs.readFileSync(new URL('./SecretsPanel.tsx', import.meta.url), 'utf8')
  const block = source.slice(source.indexOf('PRESETS.map((p) => ('))
  const handler = block.match(/onClick=\{\(\) =>\s*(setDraft\([\s\S]*?\))\s*\}\s*>/)?.[1]
  assert.ok(handler)
  let result
  vm.runInNewContext(handler, {
    draft: {name: 'Lovart', vars: [], note: '保留备注'},
    p: {label: '阿里云', vars: ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET']},
    setDraft: value => {result = value}
  })
  assert.equal(result.name, '阿里云')
  assert.equal(result.vars[0].varName, 'ALIBABA_CLOUD_ACCESS_KEY_ID')
  assert.equal(result.note, '保留备注')
})
