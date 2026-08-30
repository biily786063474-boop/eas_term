// 手机端状态的落盘。照 gantt.ts / board.ts 的范式：主进程管文件、逐条校验、坏数据整条丢。
//
// **文件权限 600。** 里面有设备的 tokenHash —— 哈希本身不能反推出 token，
// 但它是「谁能进来」的凭据表，没有理由让同机其它用户读到。
// 这跟 mcpBridge 写 mcp-endpoint.json 用 0o600 是同一条理由。
//
// **文件不存在 = 功能没开过**，直接返回 emptyState()，不创建文件。
// 这条是「默认关，等于不存在」那道锁的一部分：装了没用过这个功能的人，
// userData 里连这个文件都不该有。
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import { emptyState, type Device, type PhoneState } from './pairing'

const storeFile = (): string => path.join(app.getPath('userData'), 'phone.json')

/** 逐条校验设备。少一个必填字段就整条丢 —— 半条凭据跑进鉴权是最危险的那种问题。 */
function validDevice(d: unknown): d is Device {
  if (!d || typeof d !== 'object') return false
  const o = d as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.name === 'string' &&
    typeof o.tokenHash === 'string' &&
    o.tokenHash.length > 0 &&
    typeof o.pairedAt === 'number' &&
    typeof o.lastSeenAt === 'number'
  )
}

/** 读。**pending 一律不落盘、也一律不从盘上读** —— 配对码只活 60 秒，
 *  跨重启还留着它没有任何意义，只会多一个能被翻出来的短期凭据。 */
export function load(): PhoneState {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    if (!raw || typeof raw !== 'object') return emptyState()
    const o = raw as Record<string, unknown>
    const t = (o.tunnel ?? {}) as Record<string, unknown>
    return {
      enabled: o.enabled === true,
      devices: Array.isArray(o.devices) ? o.devices.filter(validDevice) : [],
      pending: null,
      tunnel: {
        // **默认关。** 盘上没有这一项（老版本升上来）就是关着，
        // 不能因为「字段缺失」把一个把电脑挂到公网可达位置的功能默认打开
        enabled: t.enabled === true,
        host: typeof t.host === 'string' && t.host ? t.host : undefined,
        port: typeof t.port === 'number' && t.port > 0 && t.port < 65536 ? t.port : undefined
      }
    }
  } catch {
    // 文件不存在 / 坏了 → 当作没开过。**不在这里创建文件**
    return emptyState()
  }
}

/** 写。只写 enabled 和 devices，pending 不落盘（见 load 的注释）。 */
export function save(s: PhoneState): void {
  try {
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({ enabled: s.enabled, devices: s.devices, tunnel: s.tunnel }, null, 2),
      { mode: 0o600 }
    )
  } catch (e) {
    console.error('[phone] 写 phone.json 失败', e)
  }
}
