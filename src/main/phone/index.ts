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
import {
  allow,
  deny,
  fulfill,
  open as openReq,
  publicView,
  settle,
  type PendingRequest
} from './request'
import { load, save } from './store'
import {
  endpoint,
  isRunning,
  lanAddress,
  queryRenderer,
  registerPhoneQueryReply,
  setIssuedToken,
  start,
  stop
} from './server'

let state: PhoneState = emptyState()
/** 当前那个待确认的写请求。**一次只有一个**（见 request.ts 设计 ①），
 *  所以是一个变量不是一张表。 */
let pendingReq: PendingRequest | null = null

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
    // 待确认的写请求。**只把要给人看的三样透出去** —— args 不外传
    request: (() => {
      const r = settle(pendingReq, Date.now())
      return r && r.state === 'waiting'
        ? {
            id: r.id,
            deviceName: r.deviceName,
            action: r.action,
            // 只透出这一个参数：面板要拿它查项目名。**其余 args 不外传**
            projectId: typeof r.args.projectId === 'string' ? r.args.projectId : ''
          }
        : null
    })(),
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
  onClaim: pushStatus,
  /** 手机发来写请求。**只登记，不执行** —— 等人在电脑上点允许。 */
  openRequest: (
    dev: { id: string; name: string },
    action: string,
    args: Record<string, unknown>
  ): { ok: true; requestId: string } | { ok: false; reason: string } => {
    const id = crypto.randomUUID()
    const r = openReq(
      pendingReq,
      {
        id,
        deviceId: dev.id,
        deviceName: dev.name,
        action,
        // **不在这里拼标题** —— 项目名只有渲染层知道，主进程拼出来只能放 UUID，
        // 而给人看一串 4c1e6177 等于什么都没说。面板拿 projectId 自己查名字。
        title: 'newSession',
        args,
        createdAt: Date.now()
      },
      Date.now()
    )
    if (!r.ok) return { ok: false, reason: r.reason }
    pendingReq = r.req
    pushStatus()
    return { ok: true, requestId: id }
  },
  requestStatus: (requestId: string): Record<string, unknown> => {
    // **只回自己那个请求的状态** —— 拿别人的 id 来问一律 none
    if (!pendingReq || pendingReq.id !== requestId) return { state: 'none' }
    return publicView(pendingReq, Date.now()) as unknown as Record<string, unknown>
  }
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

  /** 人在电脑上点了「允许」这个写请求。
   *
   *  **动作由渲染层做**（建节点要动 zustand 的画布状态，主进程没有），
   *  这里只负责：推到 allowed → 请渲染层执行 → 按结果 fulfill → 留痕。
   *  **失败不装成功** —— 手机上转个圈然后说「好了」而电脑上什么都没发生，
   *  是最难查的那种。 */
  ipcMain.handle('phone:allowRequest', async () => {
    const r = allow(pendingReq, Date.now())
    pendingReq = r
    if (!r || r.state !== 'allowed') {
      // 多半是挂过期了 —— 如实告诉界面，别让它以为点成功了
      pushStatus()
      return { ok: false, error: r?.state === 'expired' ? '这个请求已经过期了' : '没有待确认的请求' }
    }
    let out: { ok: true; result?: Record<string, unknown> } | { ok: false; error: string }
    try {
      const d = (await queryRenderer('createSession', r.args)) as
        | { ok: boolean; nodeId?: string; error?: string }
        | null
      out = d?.ok ? { ok: true, result: { nodeId: d.nodeId } } : { ok: false, error: d?.error ?? '建不出来' }
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    pendingReq = fulfill(pendingReq, out)
    audit.record({
      at: Date.now(),
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      action: r.action,
      detail: out.ok ? '已允许并新建了 AI 对话' : '已允许但执行失败：' + out.error,
      outcome: 'allowed'
    })
    pushStatus()
    return out.ok ? { ok: true } : { ok: false, error: out.error }
  })

  ipcMain.handle('phone:denyRequest', () => {
    const r = settle(pendingReq, Date.now())
    pendingReq = deny(pendingReq, Date.now())
    if (r) {
      audit.record({
        at: Date.now(),
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        action: r.action,
        detail: '你拒绝了这个请求',
        outcome: 'denied'
      })
    }
    pushStatus()
    return { ok: true }
  })

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
