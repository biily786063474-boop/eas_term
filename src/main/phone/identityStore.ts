// 身份的落盘。照 store.ts 的范式：主进程管文件、0600、坏数据整个丢。
//
// **懒创建 —— 没开过手机功能的人，磁盘上不该有私钥。**
// 这是「第 1 道锁：默认关，等于不存在」的一部分（见 index.ts 文件头）：
// 装了没用过的人，`lsof` 里看不到端口，userData 里也不该多出一把密钥。
//
// ── 两个 id，为什么不共用一个 ──────────────────────────────────────
// · deviceId  进证书的 CN 和 SAN。**会出现在网络上**（TLS 握手时明文可见）
// · tunnelId  隧道上的门牌号。手机告诉服务器「我要连这台」用的就是它
//
// 共用一个的话，任何见过你证书的人都知道了你的隧道门牌号。
// 安全性本来就不指望它保密（真正的门是 token 和指纹），
// 但让门牌号不可枚举是白拿的 —— 省得有人扫遍 id 空间去敲别人家的门。
import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { createIdentity, validIdentity, type Identity } from './identity'

/** 这台电脑的完整身份 */
export interface DeviceIdentity {
  /** 证书里那个名字。**只能是字母数字和连字符**（identity.ts 会校验） */
  deviceId: string
  /** 隧道上的门牌号，不可枚举 */
  tunnelId: string
  identity: Identity
}

const idFile = (): string => path.join(app.getPath('userData'), 'phone-identity.json')

let cached: DeviceIdentity | null = null

function validStored(v: unknown): v is DeviceIdentity {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.deviceId === 'string' &&
    /^[A-Za-z0-9-]{1,64}$/.test(o.deviceId) &&
    typeof o.tunnelId === 'string' &&
    o.tunnelId.length > 0 &&
    validIdentity(o.identity)
  )
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
  const next: DeviceIdentity = {
    deviceId,
    // 隧道门牌号：128 位随机，不可枚举
    tunnelId: crypto.randomBytes(16).toString('base64url'),
    identity: createIdentity(deviceId, Date.now())
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
