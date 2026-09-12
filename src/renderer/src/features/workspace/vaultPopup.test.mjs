import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
test('手动入口与AI弹窗共用建柜解锁组件和画布遮罩',()=>{
 for(const p of ['./SecretRequestModal.tsx','./SecretsPanel.tsx']){
  const s=read(p);assert.ok(s.includes('<VaultGate'));assert.ok(s.includes('vault-backdrop'))
 }
})
