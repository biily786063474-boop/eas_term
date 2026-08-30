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
  setTunnel,
  type Device,
  type PhoneState,
  type TunnelPrefs
} from './pairing'
import type { PhoneStatus } from '../../shared/types'
import * as audit from './audit'
import { getIdentity, hasIdentity, reset as resetIdentity } from './identityStore'
import { load, save } from './store'
import { startTunnel, type TunnelHandle, type TunnelState } from './tunnelClient'
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

// ── 隧道（在外面用）────────────────────────────────────────────────
/** 内置的隧道服务器。用户没自定义时用它。
 *
 *  **为什么是 eas.biily.top 而不是 tunnel.eas.biily.top**（2026-08-30 部署时定的）：
 *  用现成的域名就能复用它那张真证书 —— 零 DNS 记录、零新证书、零 certbot 配置。
 *  代价是以后想把隧道搬到独立机器时，这个端点得继续留着或者推一次 app 更新。
 *  分发之前改成独立子域更好，那需要先加一条 DNS 记录。
 *
 *  **端口不是 443**：39.105 上的 443 被宝塔管的 nginx 占着 5 个生产站，
 *  抢它要改所有站点的 listen —— 那是「动别人的」。8443 在家宽和 4G 上
 *  都不受限；少数公司/酒店网络会拦，那时候再加一条端点就行（app 是依次试的）。
 *  **8443 需要在阿里云安全组里放行**，主机防火墙是关着的。 */
const DEFAULT_TUNNEL = { host: 'eas.biily.top', port: 8443 }

let tunnel: TunnelHandle | null = null
let tunnelState: TunnelState = 'off'
let tunnelDetail: string | undefined

/** 隧道该不该跑。**两个开关都得开** —— 总开关关着时本地服务都没起，
 *  没有东西可以被隧道过去；隧道开关关着是用户明确不想在外面用。 */
function syncTunnel(): void {
  const ep = endpoint()
  const want = state.enabled && state.tunnel.enabled && !!ep && ep.securePort > 0
  if (!want) {
    if (tunnel) {
      tunnel.stop()
      tunnel = null
    }
    if (tunnelState !== 'off') {
      tunnelState = 'off'
      tunnelDetail = undefined
      pushStatus()
    }
    return
  }
  if (tunnel) return // 已经在跑
  const id = getIdentity()
  tunnel = startTunnel({
    host: state.tunnel.host || DEFAULT_TUNNEL.host,
    port: state.tunnel.port || DEFAULT_TUNNEL.port,
    agentKey: id.agentKey,
    tunnelId: id.tunnelId,
    // **接到 TLS 那个口，不是明文口** —— 隧道里跑的必须是手机到本机的
    // 那条端到端 TLS。接到明文口的话，隧道运营方就能读到内容了
    localHost: ep.host,
    localPort: ep.securePort,
    onState: (s, d) => {
      tunnelState = s
      tunnelDetail = d
      pushStatus()
    }
  })
}

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
    // app 走的那个口。**起不来时是 null 而不是省略** —— 界面要能说
    // 「浏览器能用、app 连不上」，而不是把两件事糊成一个「没起来」
    secureUrl: ep && ep.securePort ? `https://${ep.host}:${ep.securePort}` : null,
    /** 手机 app 要钉的指纹。没建过身份时不显示 —— 免得在界面上凭空
     *  造出一把还不存在的密钥 */
    pin: hasIdentity() ? getIdentity().identity.pin : null,
    tunnel: {
      enabled: state.tunnel.enabled,
      state: tunnelState,
      // **把服务器的原话带出来**（「凭证对不上」/「服务器满了」/「连不上」）——
      // 用户的下一步完全不同，糊成一个「连不上」等于什么都没说
      detail: tunnelDetail ?? null,
      host: state.tunnel.host || DEFAULT_TUNNEL.host,
      port: state.tunnel.port || DEFAULT_TUNNEL.port
    },
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
  onClaim: pushStatus,
  /** 身份是**懒建**的：第一次起 TLS 口时才生成密钥。
   *  没开过这个功能的人磁盘上不该有私钥（identityStore.ts 文件头） */
  getIdentity
}

function startServer(): { ok: boolean; error?: string } {
  const r = start(hooks)
  // **等一拍再拉隧道。** listen 是异步的，端口号要等回调才有 ——
  // 立刻问 endpoint() 拿到的 securePort 是 0，隧道会被判成「不该跑」
  setTimeout(syncTunnel, 100)
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
    syncTunnel() // 总开关关了，隧道也得跟着收 —— 不收的话外面还连得进来
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

  /** 隧道开关 / 换隧道服务器。 */
  ipcMain.handle('phone:setTunnel', (_e, t: Partial<TunnelPrefs>) => {
    // **合并而不是替换。** 只传 {enabled:false} 来关隧道时，
    // 替换会把用户自定义的服务器地址一起抹掉 —— 再打开就悄悄连回默认那台了
    setState(setTunnel(state, { ...state.tunnel, ...t }))
    // 换服务器要重连 —— 光改设置不重连的话，界面显示新地址而实际还连着旧的
    tunnel?.stop()
    tunnel = null
    syncTunnel()
    return { ok: true }
  })

  /** 换一个 TLS 身份。**已配对的手机会全部失效** —— 指纹变了，
   *  它们钉的是旧的那把。所以这个动作要在界面上说清后果、要用户确认。
   *  用途：怀疑私钥泄漏，或者想把所有已授权的手机一次性断干净。 */
  ipcMain.handle('phone:resetIdentity', () => {
    resetIdentity()
    // 证书换了，正在跑的 TLS 口还拿着旧的 —— 必须重起，否则「重置了但
    // 手机还能用旧指纹连上」，那就等于没重置
    if (state.enabled) {
      stop()
      startServer()
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
  tunnel?.stop()
  stop()
})
