// 设置里的「手机端」那一页：开关、二维码、配对确认、设备表。
//
// **界面是给能力配的壳。** 判断都在别处（main/phone/pairing.ts 的状态机、
// main/phone/lan.ts 挑网卡、features/phone/collect.ts 挑数据），各自有单测。
// 这里只做三件事：把状态显示出来、把按钮接到 IPC、把代价说清楚。
//
// ── 一条不能省的文案纪律 ──────────────────────────────────────────
// 这个开关会**在局域网上开一个端口**。开关旁边必须写清楚这件事，
// 而且要写在打开**之前**看得到的地方 —— 打开之后才说等于没说。
import { useEffect, useState } from 'react'

import type { PhoneStatus } from '../../../../shared/types'
import { CheckIcon, TrashIcon } from '../../ui/Icons'
import { pairUrl } from './pairPayload'
import { encodeQR } from './qr'

/** 配对码的有效期，跟主进程的 PAIR_TTL_MS 对齐。
 *  **两处写死同一个数字是有意的**：这里只用来画倒计时，真正的判定在主进程；
 *  就算这个数字漂了，也只是倒计时不准，不会让一张过期的码被认下来。 */
const TTL_MS = 60_000

function Qr({ text }: { text: string }): JSX.Element {
  const m = encodeQR(text)
  // **编不出来要说出来。** 原来这里 return null —— 界面上就是一片空白，
  // 而空白看起来跟「还没生成」一模一样，不看代码根本查不出发生了什么。
  // 载荷设计上已经保证装得下（见 pairPayload.ts 的测试），这里是最后一道
  if (!m)
    return (
      <div className="ph-qr-fail">
        二维码编不出来（内容 {new TextEncoder().encode(text).length} 字节，超出上限）
        <br />
        用下面那个地址在手机浏览器里打开
      </div>
    )
  const n = m.length
  const q = 2 // 静区（quiet zone）：规范要求 4 个模块，这里给 2 —— 白底卡片本身还有 padding
  const size = n + q * 2
  // 用一条条 rect 画，不用 canvas —— 这样它天然是矢量的，缩放/截图都清楚，
  // 也不用管 devicePixelRatio
  const rects: JSX.Element[] = []
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!m[r][c]) {
        c++
        continue
      }
      let w = 1
      while (c + w < n && m[r][c + w]) w++ // 同一行连续的黑块合成一个 rect，省节点
      rects.push(<rect key={`${r}-${c}`} x={c + q} y={r + q} width={w} height={1} />)
      c += w
    }
  }
  return (
    <svg className="ph-qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect x="0" y="0" width={size} height={size} fill="#fff" />
      <g fill="#0b0d13">{rects}</g>
    </svg>
  )
}

export function PhonePanel(): JSX.Element {
  const [st, setSt] = useState<PhoneStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /** 倒计时靠它每秒重渲染一次。**不存剩余秒数** —— 存了就会和真实时间漂移，
   *  每次现算 codeAt + TTL - now 才不会。 */
  const [, tick] = useState(0)

  useEffect(() => {
    void window.api.phone.status().then(setSt)
    return window.api.phone.onStatus(setSt)
  }, [])

  // 只在有码的时候跑这个定时器 —— 平时不开着一个每秒醒一次的东西
  useEffect(() => {
    if (!st?.code) return
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [st?.code])

  const left = st?.codeAt ? Math.max(0, Math.ceil((st.codeAt + TTL_MS - Date.now()) / 1000)) : 0
  const expired = !!st?.code && left <= 0

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const r = await fn()
      if (!r.ok && r.error) setErr(r.error)
    } finally {
      setBusy(false)
    }
  }

  if (!st) return <div className="cset-sec ph-loading">正在读…</div>

  return (
    <div className="cset-sec ph">
      {/* ── 总开关 ────────────────────────────────────────────── */}
      <label className="ph-row">
        <input
          type="checkbox"
          checked={st.enabled}
          disabled={busy}
          onChange={(e) => void run(() => window.api.phone.enable(e.target.checked))}
        />
        <span className="ph-row-b">
          <b>用手机看这台电脑上的项目</b>
          {/* **代价写在打开之前**：这行字在开关旁边，不是打开之后才出现的提示 */}
          <span className="ph-note">
            打开后，这台电脑会在<b>局域网</b>上开一个端口，配过对的手机能连上来。
            关掉就立刻关闭，不用重启。
          </span>
        </span>
      </label>

      {err && <div className="ph-err">{err}</div>}

      {st.enabled && !st.running && (
        <div className="ph-err">
          服务没起来 —— 多半是没连 Wi-Fi。连上之后点
          <button className="ph-link" onClick={() => void run(() => window.api.phone.restart())}>
            重试
          </button>
        </div>
      )}

      {st.enabled && st.running && (
        <>
          {/* ── 有人扫了码，等你点允许 ──────────────────────────
              这是整套配对里唯一一道**必须由人做**的闸：二维码被隔着肩膀
              拍到也没用，他还得能碰到你这台电脑。 */}
          {st.claimingName && (
            <div className="ph-ask">
              <div className="ph-ask-t">
                <b>{st.claimingName}</b> 想连上来
              </div>
              <div className="ph-ask-b">
                <button
                  className="ph-btn primary"
                  disabled={busy}
                  onClick={() => void run(() => window.api.phone.approve())}
                >
                  <CheckIcon size={12} /> 允许
                </button>
                <button
                  className="ph-btn"
                  disabled={busy}
                  onClick={() => void run(() => window.api.phone.rejectPair())}
                >
                  拒绝
                </button>
              </div>
            </div>
          )}

          {/* ── 配对区 ─────────────────────────────────────────── */}
          {!st.claimingName && (
            <div className="ph-pair">
              {/* **url 也要判。** 原来只判了 code，url 为 null 时模板字符串
                  会编出一个 `null/?c=ABC123` 的二维码 —— 扫出来是个打不开的地址 */}
              {st.code && st.url && !expired ? (
                <>
                  <Qr
                    text={pairUrl({
                      url: st.url,
                      code: st.code,
                      pin: st.pin,
                      secureUrl: st.secureUrl
                    })}
                  />
                  <div className="ph-pair-r">
                    <div className="ph-pair-t">用手机相机扫它</div>
                    <div className="ph-note">
                      扫完还要在这里点一次「允许」——<b>被人拍到码也没用</b>。
                    </div>
                    <div className="ph-code">
                      配对码 <b>{st.code}</b>
                      <span className="ph-left">{left} 秒后失效</span>
                    </div>
                    {/* 手输兜底：有些手机的相机不认局域网 http 地址 */}
                    <div className="ph-url">扫不了就在手机浏览器打开 {st.url}</div>
                  </div>
                </>
              ) : (
                <div className="ph-pair-r">
                  <div className="ph-pair-t">{expired ? '这张码过期了' : '要连一台新手机？'}</div>
                  <div className="ph-note">
                    码只活 {TTL_MS / 1000} 秒 —— 泄漏的窗口就这么大，而且用掉即失效。
                  </div>
                  <button
                    className="ph-btn primary"
                    disabled={busy}
                    onClick={() => void run(() => window.api.phone.newCode())}
                  >
                    {expired ? '换一张' : '生成配对码'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── 已配对的设备 ───────────────────────────────────── */}
          <div className="ph-devs">
            <div className="ph-devs-t">已连的手机</div>
            {st.devices.length === 0 ? (
              <div className="ph-note">还没有。上面生成一张码，用手机扫。</div>
            ) : (
              st.devices.map((d) => (
                <div className="ph-dev" key={d.id}>
                  <span className="ph-dev-n">{d.name}</span>
                  <span className="ph-dev-w">
                    {d.lastSeenAt > d.pairedAt ? `最后访问 ${when(d.lastSeenAt)}` : '还没访问过'}
                  </span>
                  <button
                    className="ph-kick"
                    data-tip="踢掉这台手机（它的凭证立刻失效）"
                    disabled={busy}
                    onClick={() => void run(() => window.api.phone.revoke(d.id))}
                  >
                    <TrashIcon size={11} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* ── 留痕。**放开写操作的前提，不是装饰** ──────────────
              没有它，出问题时你没有任何依据。所以它不折叠、不藏在二级页面。 */}
          <div className="ph-devs">
            <div className="ph-devs-t">
              手机做过什么
              {st.audit.length > 0 && (
                <button
                  className="ph-link"
                  disabled={busy}
                  onClick={() => void run(() => window.api.phone.clearAudit())}
                >
                  清空
                </button>
              )}
            </div>
            {st.audit.length === 0 ? (
              <div className="ph-note">还没有记录。手机连上来之后，每一次操作都会记在这里。</div>
            ) : (
              <div className="ph-audit">
                {st.audit.map((a, i) => (
                  <div className="ph-log" key={i}>
                    <span className="ph-log-t">{clock(a.at)}</span>
                    <span className="ph-log-d">{a.deviceName}</span>
                    <span className={`ph-log-x${a.outcome ? ' ' + a.outcome : ''}`}>{a.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 现在能做什么、不能做什么。**不能省** ────────────────
              这一版只读、只在局域网、明文 HTTP。用户有权在打开之前知道
              自己的数据这一刻走的是什么线路。 */}
          <div className="ph-scope">
            <b>这一版手机上能做什么</b>
            <ul>
              <li>看画布上的项目、看哪些终端和对话在跑</li>
              <li>看 Frame 里的文档和图片，点开看内容</li>
              <li><b>新建 AI 对话</b>（只是在画布上加一个空对话框，不会启动任何进程）</li>
              <li>
                <span className="ph-no">还不能</span>给 agent 发消息
              </li>
            </ul>
            <div className="ph-note">
              只在<b>同一个 Wi-Fi</b> 下能连，走的是明文 HTTP。
              在外面也能用、以及加密，是后面两步的事。
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** 留痕的时刻。**到分钟就够** —— 这一列是给人扫一眼的，不是审计日志 */
function clock(t: number): string {
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 「3 分钟前」这种。**只到天** —— 再精确没有意义，这一列是给人扫一眼判断
 *  「这台手机还在用吗」的，不是审计日志。 */
function when(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
