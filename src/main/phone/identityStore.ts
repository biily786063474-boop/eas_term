// 身份的落盘。照 store.ts 的范式：主进程管文件、0600、坏数据整个丢。
//
// **懒创建 —— 没开过手机功能的人，磁盘上不该有私钥。**
// 这是「第 1 道锁：默认关，等于不存在」的一部分（见 index.ts 文件头）：
// 装了没用过的人，`lsof` 里看不到端口，userData 里也不该多出一把密钥。
//
// ── 三样东西，各管各的 ─────────────────────────────────────────────
// · deviceId  进证书的 CN。**会出现在网络上**（TLS 握手时明文可见）
// · agentKey  **秘密**。电脑拿它向隧道服务器证明「这条隧道是我的」
// · tunnelId  = sha256(agentKey) 的前 16 字节，**公开**。手机拿它说「我要连这台」
//
// **tunnelId 必须是 agentKey 的单向派生，不能是另一个随机数。**
// 理由：手机要知道 tunnelId 才能连（所以它会随二维码流出去、也会被服务器看到），
// 而如果注册隧道用的也是它，那么任何见过它的人都能抢先注册这条隧道，
// 把发给你的连接劫走 —— 他伪造不出你的证书（手机钉的是指纹），
// 但足以让你的手机连不上你自己的电脑。派生之后，
// **知道 tunnelId 推不出 agentKey**，冒名顶替这条路就堵死了。
//
// tunnelId 用十六进制不用 base64url：它要当 DNS 名字的一段
// （手机连的是 `<tunnelId>.eas-term.local`），而 base64url 里的 `_` 不是合法主机名字符。
import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { createIdentity, validIdentity, type Identity } from './identity'

/** 这台电脑的完整身份 */
export interface DeviceIdentity {
  /** 证书里那个名字。**只能是字母数字和连字符**（identity.ts 会校验） */
  deviceId: string
  /** **秘密**：向隧道服务器证明这条隧道归我。绝不发给手机、不进二维码 */
  agentKey: string
  /** 公开的门牌号 = sha256(agentKey) 前 16 字节的十六进制（32 字符） */
  tunnelId: string
  identity: Identity
}

/** 从秘密派生出公开门牌号。**单向** —— 见文件头。 */
export function tunnelIdOf(agentKey: string): string {
  return crypto.createHash('sha256').update(agentKey).digest('hex').slice(0, 32)
}

const idFile = (): string => path.join(app.getPath('userData'), 'phone-identity.json')

let cached: DeviceIdentity | null = null

function validStored(v: unknown): v is DeviceIdentity {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (
    typeof o.deviceId !== 'string' ||
    !/^[A-Za-z0-9-]{1,64}$/.test(o.deviceId) ||
    typeof o.agentKey !== 'string' ||
    o.agentKey.length === 0 ||
    typeof o.tunnelId !== 'string'
  )
    return false
  // **门牌号要跟秘密对得上。** 不核对的话，盘上那行 tunnelId 被改掉，
  // 电脑就会拿着一个注册不上的门牌号去连隧道 —— 表现是「在外面连不上」，
  // 而本地一切正常，查起来隔着一整条链路
  if (tunnelIdOf(o.agentKey) !== o.tunnelId) return false
  return validIdentity(o.identity)
}

/**
 * 拿这台电脑的身份，没有就现建一个。
 *
 * **建一次就一直用**：换身份意味着指纹变了，**所有已配对的手机都要重新扫码**。
 * 所以这里绝不「顺手重建」—— 只有 reset() 会换，而那是用户明确要求的动作。
 */
export function getIdentity(): DeviceIdentity {
  if (cached) return cached
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(idFile(), 'utf8'))
    if (validStored(raw)) {
      cached = raw
      return raw
    }
    // 文件在但内容不可信 —— 这里**不静默重建**：重建等于悄悄换掉信任根，
    // 已配对的手机会集体连不上而没有任何解释。先喊一声再重建。
    console.error('[phone] 身份文件校验没过，将重新生成 —— 已配对的设备需要重新配对')
  } catch {
    // 文件不存在 = 第一次用这个功能，正常路径，不报错
  }
  return reset()
}

/** 生成一个全新身份并落盘。**已配对的设备会全部失效**（指纹变了）。 */
export function reset(): DeviceIdentity {
  const deviceId = crypto.randomBytes(8).toString('hex')
  const agentKey = crypto.randomBytes(32).toString('base64url')
  const tunnelId = tunnelIdOf(agentKey)
  const next: DeviceIdentity = {
    deviceId,
    agentKey,
    tunnelId,
    // 把隧道那条路上手机会用的主机名也放进 SAN。我们钉指纹、不校验主机名，
    // 但不能指望别人家的 TLS 栈跟我们想的一样
    identity: createIdentity(deviceId, Date.now(), [`${tunnelId}.eas-term.local`])
  }
  try {
    // **0600**：这里面有私钥。同机其它用户读到它就等于拿到了这台电脑的身份
    fs.writeFileSync(idFile(), JSON.stringify(next, null, 2), { mode: 0o600 })
  } catch (e) {
    console.error('[phone] 写 phone-identity.json 失败', e)
  }
  cached = next
  return next
}

/** 有没有已经建过身份。界面上判断「要不要显示重置按钮」用。 */
export function hasIdentity(): boolean {
  if (cached) return true
  try {
    return validStored(JSON.parse(fs.readFileSync(idFile(), 'utf8')))
  } catch {
    return false
  }
}

/** 测试用：清掉内存缓存 */
export function _clearCache(): void {
  cached = null
}
