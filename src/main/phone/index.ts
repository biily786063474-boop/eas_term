// 手机端功能的生命周期与 IPC。**状态的唯一持有者是这里**——
// server.ts 通过 hooks 读写，pairing.ts 是纯函数不持有，store.ts 只负责落盘。
// 一份状态一个主人，否则「现在到底配没配上」会有两个答案。
//
// ── 第 1 道锁：默认关，等于不存在 ──────────────────────────────────
// enabled=false 时**根本不调 server.start()**，不是「监听了但拒绝」。
// 装了没用过这个功能的人，`lsof` 里看不到任何新端口，userData 里连
// phone.json 都不该有（见 store.ts 的 load）。
import { app, BrowserWindow, ipcMain } from 'electron'
import crypto from 'crypto'

import {
  approve,
  cancelPair,
  emptyState,
  revoke,
  setEnabled,
  type Device,
  type PhoneState
} from './pairing'
import type { PhoneStatus } from '../../shared/types'
import * as audit from './audit'
import { load, save } from './store'
import {
  endpoint,
  isRunning,
  lanAddress,
  registerPhoneQueryReply,
  setIssuedToken,
  start,
  stop
} from './server'

let state: PhoneState = emptyState()

const getState = (): PhoneState => state
/** 改状态的唯一入口。**落盘和推给界面绑在一起** ——
 *  分开写迟早出现「盘上变了界面没变」或者反过来。 */
function setState(next: PhoneState): void {
  state = next
  save(next)
  pushStatus()
}

function status(): PhoneStatus {
  const ep = endpoint()
  return {
    enabled: state.enabled,
    running: isRunning(),
    url: ep ? `http://${ep.host}:${ep.port}` : null,
    code: state.pending?.code ?? null,
    codeAt: state.pending?.createdAt ?? null,
    claimingName: state.pending?.claimed ? (state.pending.deviceName ?? '手机') : null,
    devices: state.devices.map((d: Device) => ({
      id: d.id,
      name: d.name,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt
    })),
    audit: audit.recent(30)
  }
}

function pushStatus(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('phone:status', status())
  }
}

const hooks = {
  getState,
  setState,
  /** 有手机扫了码 / 有新留痕 → 推一次状态，界面跟着更新。
   *  **不在这里自动 approve** —— 那道人工确认是第 3 道锁的全部意义。 */
  onClaim: pushStatus
}

function startServer(): { ok: boolean; error?: string } {
  const r = start(hooks)
  pushStatus()
  return r
}

export function registerPhoneHandlers(): void {
  state = load()
  registerPhoneQueryReply()

  // **只有 enabled 才起服务。** 见文件头第 1 道锁。
  if (state.enabled) {
    const r = startServer()
    if (!r.ok) console.log('[phone] 开着但没起来：' + r.error)
  }

  ipcMain.handle('phone:status', () => status())

  ipcMain.handle('phone:enable', (_e, on: boolean) => {
    setState(setEnabled(state, on))
    if (on) return startServer()
    stop()
    pushStatus()
    return { ok: true }
  })

  /** 生成一张新配对码。每次调用都换一张 —— 「刷新」按钮走的也是这个。 */
  ipcMain.handle('phone:newCode', () => {
    if (!isRunning()) return { ok: false, error: '服务没在跑' }
    // 6 位大写字母数字，去掉容易看错的 0/O/1/I/L。二维码里带的是完整 URL，
    // 这个码只在「手输」和日志里露面，可读性比熵更重要（它只活 60 秒）。
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const code = Array.from(crypto.randomBytes(6))
      .map((b) => alphabet[b % alphabet.length])
      .join('')
    setState({ ...state, pending: { code, createdAt: Date.now(), claimed: false } })
    return { ok: true, code }
  })

  /** 人在电脑上点了「允许」。**明文 token 只在这一刻存在**：
   *  存哈希进设备表，明文交给 server 等手机来取一次，之后系统里再也没有。 */
  ipcMain.handle('phone:approve', () => {
    const token = crypto.randomBytes(32).toString('base64url')
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const r = approve(state, { id: crypto.randomUUID(), tokenHash: hash }, Date.now())
    if (!r.ok) return { ok: false, error: r.reason }
    setState(r.state)
    setIssuedToken(token)
    return { ok: true, name: r.device.name }
  })

  ipcMain.handle('phone:rejectPair', () => {
    setState(cancelPair(state))
    return { ok: true }
  })

  ipcMain.handle('phone:revoke', (_e, deviceId: string) => {
    setState(revoke(state, deviceId))
    return { ok: true }
  })

  /** 网络换了（换 Wi-Fi、插网线）之后地址会变，界面上那个二维码得跟着换。
   *  不做自动侦测 —— 界面上给一句「地址变了？点这里重启服务」更诚实，
   *  自动重启会在用户不知情时把端口挪到别的网段上。 */
  ipcMain.handle('phone:restart', () => {
    if (!state.enabled) return { ok: false, error: '功能没开' }
    stop()
    return startServer()
  })

  ipcMain.handle('phone:lanAddress', () => lanAddress())

  /** 清空留痕。**不自动清** —— 这份东西什么时候不要了由人决定。 */
  ipcMain.handle('phone:clearAudit', () => {
    audit.clear()
    pushStatus()
    return { ok: true }
  })
}

app.on('will-quit', () => {
  stop()
})
