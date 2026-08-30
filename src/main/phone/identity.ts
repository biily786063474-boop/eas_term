// 这台电脑的 TLS 身份：一对密钥 + 一张自签证书 + 一个**指纹**。
// 手机 app 钉的就是这个指纹，整条远程链路的信任根在这里。
//
// **纯计算，不碰 electron / fs**（落盘在 identityStore.ts）——
// 信任根这种东西必须能单测，而且测试里要能真的跑一次 TLS 握手。
//
// ── 为什么是自签证书，而不是找 CA 要一张真的 ────────────────────────
// 2026-08-30 定的：手机端做成 app。app 能钉指纹，**浏览器不能**
//（HPKP 早就从各家浏览器移除了，JS 也拿不到对方证书）。
// 一旦能钉，找公共 CA 签发那一整套就全省了：不需要权威 DNS、
// 不需要 ACME 签发服务、不受 Let's Encrypt 每周 50 张的限制。
//
// 而且**钉死比信任公共 CA 更严**：CA 体系里任何一家被攻破或误签，
// 都能签出一张骗过浏览器的证书；钉死认的是这一把公钥，谁也伪造不出。
//
// ── 钉的是 SPKI，不是整张证书 ──────────────────────────────────────
// 指纹算的是**公钥**（SubjectPublicKeyInfo）的 SHA-256，不是证书 DER 的。
// 这是 TrustKit / OkHttp CertificatePinner 这类库的默认做法，好处是：
// 换证书但不换密钥时，已配对的手机不用重新配对。
//
// ── 有效期为什么给到 10 年 ─────────────────────────────────────────
// **不给未来埋定时炸弹。** 证书过期会让所有人的远程访问在某一天集体失效，
// 而用户完全不知道发生了什么 —— 对一个要分发出去的软件，这是最糟的失败方式。
//
// 而「过期」这件事在钉死模型下本来就不产生安全收益：手机认的是这把公钥，
// 不是某个 CA 的背书，也不看有效期。所以**手机侧必须做纯指纹比对**，
// 不要走系统的证书策略评估（那套会检查有效期、会套用苹果的 825 天上限）。
// 这条是 app 那边的硬约束，写在这里免得日后被「顺手改成标准校验」。
//
// 真要换身份（比如怀疑私钥泄漏）→ 重新生成，**已配对的设备全部要重新扫码**。
// 这是有意的：换了信任根就该重新建立信任。
import crypto from 'crypto'
import forge from 'node-forge'

/** 一台电脑的身份。key 和 cert 是 PEM，pin 是给手机的那 43 个字符。 */
export interface Identity {
  /** PEM 私钥。**只在本机 userData 里（0600），任何时候都不外传** */
  key: string
  /** PEM 证书 */
  cert: string
  /** 公钥 SHA-256 的 base64url —— 二维码里给手机钉的就是它 */
  pin: string
  /** 生成时间，用于界面上显示「这个身份是什么时候建的」 */
  createdAt: number
}

/** 有效期：10 年。理由见文件头「不给未来埋定时炸弹」。 */
const VALID_DAYS = 3650
/** 往前留一天，容忍两台机器之间的时钟偏差 */
const BACKDATE_MS = 24 * 3600 * 1000

/**
 * 从一把公钥算出钉死用的指纹。
 *
 * **算的是 SPKI 的 SHA-256，转 base64url。** base64url 是 43 个字符，
 * 而十六进制冒号分隔要 95 个 —— 二维码里差这一半体积很要紧。
 */
export function pinOf(publicKey: crypto.KeyObject): string {
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(spki).digest('base64url')
}

/** 从一张 PEM 证书倒推出指纹。手机侧比对、以及测试里核对用。 */
export function pinOfCert(certPem: string): string {
  return pinOf(new crypto.X509Certificate(certPem).publicKey)
}

/** 指纹给人看的样子：4 个字符一组。用户要在电脑和手机上肉眼核对时用得上。 */
export function formatPin(pin: string): string {
  return (pin.match(/.{1,4}/g) ?? []).join(' ')
}

/**
 * 生成一个新身份。
 *
 * **密钥用 Node 原生生成（C++，几十毫秒），证书才交给 forge 签。**
 * forge 自己也能生成 RSA 密钥，但那是纯 JS 的，2048 位要跑好几秒 ——
 * 这会卡住主进程，而主进程卡住在 Windows 上就是「未响应」
 *（2026-08-29 刚为同类问题修过 fs:probePaths）。
 *
 * @param deviceId 这台电脑的稳定 id，进证书的 CN 和 SAN。**不含个人信息** ——
 *                 证书是要发给手机、也要在网络上出现的东西。
 * @param extraNames 额外的 dNSName。隧道那条路上手机连的是
 *                 `<tunnelId>.eas-term.local`，放进 SAN 是为了**万一**
 *                 哪个 TLS 栈坚持要校验主机名时也能过 —— 我们自己是钉指纹的，
 *                 本来不校验，但不能指望别人家的栈跟我们想的一样。
 */
export function createIdentity(deviceId: string, now: number, extraNames: string[] = []): Identity {
  // **deviceId 必须是纯 ASCII。** forge 把 commonName 编成 PrintableString，
  // 塞非 ASCII 进去它**不报错，直接产出一张坏证书** —— PEM 是废的，
  // 而症状要等到「手机连不上」才出现，隔着整条链路查。
  // 2026-08-30 写测试时用中文 CN 当场撞到，实测确认。
  if (!/^[A-Za-z0-9-]{1,64}$/.test(deviceId))
    throw new Error(`deviceId 只能是字母数字和连字符（拿到的是 ${JSON.stringify(deviceId)}）`)
  for (const n of extraNames)
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(n))
      throw new Error(`SAN 里的名字不合法：${JSON.stringify(n)}`)

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string

  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.publicKeyFromPem(pubPem)
  cert.version = 2 // v3
  // 序列号必须是正数：首字节 >= 0x80 会被解析成负数，有些 TLS 栈会拒。
  // 前面补一个 00 是标准做法
  cert.serialNumber = '00' + crypto.randomBytes(16).toString('hex')
  cert.validity.notBefore = new Date(now - BACKDATE_MS)
  cert.validity.notAfter = new Date(now + VALID_DAYS * 24 * 3600 * 1000)

  // 主体和签发者是同一个（自签）。**只放一个不含个人信息的名字**
  const attrs = [{ name: 'commonName', value: `Eas-Term ${deviceId}` }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      // **SAN 里不放局域网 IP。** IP 会随 DHCP 变，写死了就得跟着换证书，
      // 而换证书 = 所有设备重新配对。放一个跟着 deviceId 走的稳定名字即可 ——
      // 手机做纯指纹比对，本来就不校验主机名。
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: `${deviceId}.eas-term.local` }, // 2 = dNSName
        ...extraNames.map((v) => ({ type: 2, value: v })),
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' } // 7 = iPAddress
      ]
    }
  ])

  cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  const pin = pinOf(publicKey)

  // **生成完立刻自检一遍。** 上面那条 ASCII 校验挡的是已知的一种坏法，
  // 这一条挡的是所有坏法：解析不回来、或者解出来的公钥跟我们要钉的对不上，
  // 就在这里炸 —— 而不是让一张坏证书跑到 TLS 层，再变成手机上一句「连不上」。
  if (pinOfCert(certPem) !== pin)
    throw new Error('刚生成的证书自检没过 —— 证书和密钥对不上，不能拿去用')

  return { key: keyPem, cert: certPem, pin, createdAt: now }
}

/** 盘上读回来的东西可不可信。**缺一样就整个丢掉重新生成** ——
 *  半个身份跑进 TLS 比没有身份更糟。 */
export function validIdentity(v: unknown): v is Identity {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (
    typeof o.key !== 'string' ||
    typeof o.cert !== 'string' ||
    typeof o.pin !== 'string' ||
    typeof o.createdAt !== 'number'
  )
    return false
  // **指纹要跟证书对得上。** 不核对的话，盘上那行 pin 被改掉就等于
  // 让手机去钉一个不属于这张证书的值 —— 表现是「连不上」，查起来极难
  try {
    return pinOfCert(o.cert) === o.pin
  } catch {
    return false
  }
}
