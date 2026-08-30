import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fitsInQr, pairUrl, QR_MAX_BYTES } from './pairPayload.ts'

const PIN = 'Sc5rgh5ClA4gxgzcqRVjrofuVz6v5RJB-AZy1CqXWWc' // 43 字符，真实长度

test('**最长的情况也要装得下** —— 装不下的表现是界面上一片空白', () => {
  // 最长：三段各三位的 IP + 五位端口 + 六位配对码 + 完整指纹 + 五位 TLS 端口
  const worst = pairUrl({
    url: 'http://192.168.100.100:65535',
    code: 'ABCDEF',
    pin: PIN,
    secureUrl: 'https://192.168.100.100:65535'
  })
  assert.ok(
    fitsInQr(worst),
    `最长载荷 ${new TextEncoder().encode(worst).length} 字节，超过了编码器上限 ${QR_MAX_BYTES}`
  )
})

test('形状仍然是能直接打开的 URL —— 浏览器那条路不能断', () => {
  const s = pairUrl({
    url: 'http://192.168.1.20:51240',
    code: 'ABC123',
    pin: PIN,
    secureUrl: 'https://192.168.1.20:51241'
  })
  // 相机扫到它会打开浏览器版；app 认得的参数浏览器原样忽略
  assert.match(s, /^http:\/\/192\.168\.1\.20:51240\/\?c=ABC123&/)
  assert.match(s, /[?&]p=Sc5rgh/)
  assert.match(s, /[?&]s=51241$/)
})

test('没有身份 / TLS 口没起来时，退回今天那条 URL', () => {
  // 这种情况下只能走浏览器，二维码不该带上不存在的东西
  assert.equal(
    pairUrl({ url: 'http://192.168.1.20:51240', code: 'ABC123', pin: null, secureUrl: null }),
    'http://192.168.1.20:51240/?c=ABC123'
  )
})

test('只有指纹没有 TLS 口 → 不带 s（不编造一个端口出来）', () => {
  const s = pairUrl({ url: 'http://10.0.0.2:8080', code: 'XYZ789', pin: PIN, secureUrl: null })
  assert.doesNotMatch(s, /&s=/)
  assert.match(s, /&p=/)
})

test('**指纹必须原样进码** —— 少一个字符钉死就对不上', () => {
  const s = pairUrl({
    url: 'http://192.168.1.20:51240',
    code: 'ABC123',
    pin: PIN,
    secureUrl: 'https://192.168.1.20:51241'
  })
  assert.ok(s.includes(`&p=${PIN}`), '指纹不能被截断或转义')
  // base64url 的字符集（含 - 和 _）在 URL 查询串里都是安全的，不需要转义
  assert.doesNotMatch(s, /%/, '出现百分号说明有字符被转义了，手机那边解出来会对不上')
})

test('超长的东西要如实说装不下，而不是让编码器返回 null', () => {
  assert.equal(fitsInQr('x'.repeat(QR_MAX_BYTES)), true)
  assert.equal(fitsInQr('x'.repeat(QR_MAX_BYTES + 1)), false)
  // 中文一个字三字节 —— 按字符数判会算错
  assert.equal(fitsInQr('中'.repeat(41)), false, '按字节算，不是按字符')
})
