import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import tls from 'node:tls'
import type { AddressInfo } from 'node:net'

import forge from 'node-forge'

import { createIdentity, formatPin, pinOf, pinOfCert, validIdentity } from './identity.ts'

const NOW = 1_756_000_000_000 // 2025-08-24 前后，固定值，测试不依赖当前时间

test('**真的握一次手** —— 证明这张证书 TLS 栈认，不只是字段看着对', async () => {
  const id = createIdentity('dev123', NOW)
  const server = tls.createServer({ key: id.key, cert: id.cert }, (s) => s.end('ok'))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port

  // **这段就是手机 app 要做的事**：不校验证书链（rejectUnauthorized: false），
  // 而是自己把对方公钥的指纹跟配对时记下的那个比一比。
  const peerPin = await new Promise<string>((resolve, reject) => {
    const sock = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
      const peer = sock.getPeerX509Certificate()
      if (!peer) return reject(new Error('拿不到对方证书'))
      resolve(pinOf(peer.publicKey))
      sock.destroy()
    })
    sock.on('error', reject)
  })

  assert.equal(peerPin, id.pin, '握手拿到的指纹必须等于二维码里给手机的那个')
  await new Promise<void>((r) => server.close(() => r()))
})

test('证书能被 Node 解析，主体和 SAN 都对', () => {
  const id = createIdentity('dev123', NOW)
  const c = new crypto.X509Certificate(id.cert)
  assert.match(c.subject, /Eas-Term dev123/)
  assert.equal(c.subject, c.issuer, '自签：主体和签发者是同一个')
  assert.match(c.subjectAltName ?? '', /dev123\.eas-term\.local/)
})

test('**SAN 里不能有局域网 IP** —— IP 会随 DHCP 变，写死了就得换证书', () => {
  const id = createIdentity('dev123', NOW)
  const san = new crypto.X509Certificate(id.cert).subjectAltName ?? ''
  // 只允许回环。出现 192.168 / 10. / 172.x 就是把会变的东西钉死进了证书
  assert.doesNotMatch(san, /IP Address:(?!127\.0\.0\.1)/)
})

test('**有效期不埋定时炸弹**：至少 9 年', () => {
  const id = createIdentity('dev123', NOW)
  const c = new crypto.X509Certificate(id.cert)
  const years = (Date.parse(c.validTo) - NOW) / (365.25 * 24 * 3600 * 1000)
  assert.ok(years > 9, `有效期只有 ${years.toFixed(1)} 年 —— 到期会让所有人的远程访问集体失效`)
  // 往前留出时钟偏差
  assert.ok(Date.parse(c.validFrom) < NOW, 'notBefore 要早于现在，容忍两台机器的时钟差')
})

test('**钉的是公钥不是证书** —— 换证书不换密钥，指纹不变', () => {
  const id = createIdentity('dev123', NOW)
  // 用同一把密钥另签一张证书：序列号、有效期、主体全不一样
  const other = forge.pki.createCertificate()
  other.publicKey = forge.pki.publicKeyFromPem(
    crypto.createPublicKey(id.key).export({ type: 'spki', format: 'pem' }) as string
  )
  other.version = 2
  other.serialNumber = '00ff00ff'
  other.validity.notBefore = new Date(NOW)
  other.validity.notAfter = new Date(NOW + 1000 * 3600)
  const attrs = [{ name: 'commonName', value: 'a-completely-different-name' }]
  other.setSubject(attrs)
  other.setIssuer(attrs)
  other.sign(forge.pki.privateKeyFromPem(id.key), forge.md.sha256.create())

  assert.equal(
    pinOfCert(forge.pki.certificateToPem(other)),
    id.pin,
    '同一把密钥的两张证书，指纹必须相同 —— 否则换证书就要所有设备重新配对'
  )
})

test('指纹不是「证书整体的哈希」', () => {
  const id = createIdentity('dev123', NOW)
  const der = new crypto.X509Certificate(id.cert).raw
  const certHash = crypto.createHash('sha256').update(der).digest('base64url')
  assert.notEqual(id.pin, certHash, '算成证书哈希的话，上一条那个性质就没了')
})

test('两台电脑的身份互不相同', () => {
  assert.notEqual(createIdentity('a', NOW).pin, createIdentity('b', NOW).pin)
  // 同一个 deviceId 也不行 —— 每次生成都是新密钥
  assert.notEqual(createIdentity('a', NOW).pin, createIdentity('a', NOW).pin)
})

test('**盘上的 pin 被改过就整个丢掉** —— 半个身份比没有身份更糟', () => {
  const id = createIdentity('dev123', NOW)
  assert.equal(validIdentity(id), true)
  assert.equal(validIdentity({ ...id, pin: 'AAAA' }), false, 'pin 和证书对不上要拒')
  assert.equal(validIdentity({ ...id, cert: '不是证书' }), false)
  assert.equal(validIdentity({ ...id, key: undefined }), false)
  assert.equal(validIdentity(null), false)
  assert.equal(validIdentity('{}'), false)
})

test('私钥能用来解 TLS —— key 和 cert 得是配套的', () => {
  const id = createIdentity('dev123', NOW)
  const fromKey = crypto.createPublicKey(id.key)
  assert.equal(pinOf(fromKey), id.pin, '证书里的公钥必须来自这把私钥')
})

test('指纹显示成 4 个一组，方便肉眼核对', () => {
  assert.equal(formatPin('abcdefgh'), 'abcd efgh')
  assert.equal(formatPin('abcdefghi'), 'abcd efgh i')
})

test('指纹长度固定 43 —— 二维码要装得下', () => {
  // SHA-256 是 32 字节，base64url 无填充正好 43 个字符。
  // 换成十六进制冒号分隔要 95 个，二维码体积差一半
  assert.equal(createIdentity('dev123', NOW).pin.length, 43)
})

test('**非 ASCII 的 deviceId 当场报错**，不让坏证书跑出去', () => {
  // forge 遇到非 ASCII 的 commonName 不报错，直接产出废 PEM。
  // 没有这道校验的话，症状会推迟到「手机连不上」才出现
  assert.throws(() => createIdentity('机器一号', NOW), /只能是字母数字/)
  assert.throws(() => createIdentity('has space', NOW), /只能是字母数字/)
  assert.throws(() => createIdentity('', NOW), /只能是字母数字/)
  assert.throws(() => createIdentity('x'.repeat(65), NOW), /只能是字母数字/)
  // 正常的照过
  assert.ok(createIdentity('dev-123', NOW).pin)
})
