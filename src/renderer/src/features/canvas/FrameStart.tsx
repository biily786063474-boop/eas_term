// 空造梦空间（空 Frame）里的引导：三颗 AI 按钮 + 一颗「先开个终端」。
//
// 用户 2026-09-02：「初次建立 frame 是空的 frame，空的 frame 上面有三个按钮，
// 分别是 Claude Code、Codex 和原生 Harness。用户点击后自动在 frame 中
// 创建 AI 对话模块，并切换到相应的流程。」
//
// **它取代的是终端控制条上那个 CLI 选择器**（`CanvasAgentBar`）。那条 2026-08-27
// 加过一句「一个 CLI 都没装时也照常显示」，理由是「新用户什么都看不到」——
// 那个问题现在由这排按钮接管，所以这里也**不按 available 过滤**，
// 没装的照样列出来、标出来、点一下能装。
//
// 点了之后什么都不用这里判：`addAgentNode(frameId, { cli })` 把选择钉进 `pane.cli`，
// `AgentChatView` 挂载时按它决定直接进对话、还是开装/登录/配置那张面板。
// 分支全在那一侧（见 AgentChatView 里 setupFor 的注释），这里只负责送值。

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { CliInfo } from '../../../../shared/agentChat'
import type { OmpStatus } from '../../../../shared/ompSetup'
import { startChoices } from './startChoices.ts'
import { startChoicePresentation } from './startChoicePresentation.ts'
import { TerminalIcon } from '../../ui/Icons'
import { CliBrandIcon } from '../../ui/CliBrandIcon'

/** CLI 清单**整个应用只拉一次**：每个空造梦空间都拉一遍等于开一堆重复 IPC，
 *  而这个清单在一次运行里基本不变（装完 CLI 那条路会自己刷新面板）。
 *  照抄 SlashPicker 里 skillCache 的做法。 */
let clisCache: Promise<CliInfo[]> | null = null
function loadClis(): Promise<CliInfo[]> {
  if (!clisCache) clisCache = window.api.agentChat.listClis().catch(() => [])
  return clisCache
}

export function FrameStart({ frameId }: { frameId: string }): JSX.Element | null {
  const addAgentNode = useStore((s) => s.addAgentNode)
  const addTerminalNode = useStore((s) => s.addTerminalNode)
  const [clis, setClis] = useState<CliInfo[] | null>(null)
  const [omp, setOmp] = useState<OmpStatus | null>(null)
  /** claude / codex 各自登没登录。**值是三态**：`true` 已登、`false` 没登、
   *  `undefined` 还没探到或读不到 —— 后两者说的话完全不同（`CliAuthState.status`
   *  的注释：读不到说明我们跟 CLI 脱节了，推人去重登只会白走一趟），
   *  所以这里不把 null 折成 false。 */
  const [auth, setAuth] = useState<Record<string, boolean | undefined>>({})
  /** 正在建节点。**防连点** —— 建节点是异步的，连点两下会开出两个模块。 */
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // 光环那圈扫光是 infinite transform 动画。画布上每个空 Frame 一排三颗，25 个 Frame 就是几十个
  // 一直转的动画 —— 2026-09-14 实测正式版空闲时 9 个全在视口外照转，每 4 秒 480 次样式重算。
  // 出视口就打上 data-offscreen，CSS 把动画 paused（和 hover 停转用的是同一个属性，见 canvas.css）。
  // 用 IntersectionObserver 而不是读 store 的视口：它认 transform 后的真实位置，且只在进出边界时回调。
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) delete el.dataset.offscreen
      else el.dataset.offscreen = '1'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [clis])

  useEffect(() => {
    let alive = true
    void loadClis().then((l) => alive && setClis(l))
    // 随包那个（omp）的「配好了没有」不看登录态，看它自己那套四档状态机。
    // 拿不到就当没配好判据不明，startChoices 收到 undefined 会按就绪显示。
    void window.api.omp.status().then((s) => alive && setOmp(s))
    for (const id of ['claude', 'codex'] as const) {
      void window.api.cliAuth
        .check(id)
        // status 为 null = 读不到 → 留 undefined，按就绪显示
        .then((st) => alive && setAuth((cur) => ({ ...cur, [id]: st.status?.loggedIn })))
        .catch(() => undefined)
    }
    return () => {
      alive = false
    }
  }, [])

  if (!clis) return null // 清单还没到：**什么都不画**，别先闪一排空按钮再重排

  const choices = startChoices(clis, (c) =>
    // 随包那个（omp）的「配好了没有」不看登录态 —— 它随包分发、探测必过，
    // 真正的判据是它自己那套四档状态机（选服务商 → 登录 → 选模型 → ready）。
    // 拿 available 判它会得出「一直可用」，而用户点进去撞到的是选服务商那一屏。
    c.bundled ? (omp ? omp.step.k === 'ready' : undefined) : auth[c.id]
  )
  if (!choices.length) return null

  const start = (cli: string): void => {
    if (busy) return
    setBusy(true)
    void addAgentNode(frameId, { cli }).finally(() => setBusy(false))
  }

  return (
    <div className="cframe-start" ref={rootRef}>
      <div className="cframe-start-hd">选一个 AI 开始</div>
      <div className="cframe-start-row">
        {choices.map(({ cli, state }) => {
          const { name, tip } = startChoicePresentation(cli)
          return (
            <button
              key={cli.id}
              type="button"
              className={`cframe-start-btn${state === 'ready' ? '' : ' pending'}`}
              aria-label={`${name}：${tip}`}
              data-tip={tip}
              disabled={busy}
              onClick={() => start(cli.id)}
            >
              <span className="cframe-start-ring" aria-hidden="true" />
              <CliBrandIcon cliId={cli.id} bundled={cli.bundled} />
              <span className="cframe-start-name">{name}</span>
            </button>
          )
        })}
      </div>
      {/* 逃生口。**视觉弱一档** —— 它不是主路。
          用户 2026-09-02 要的「先开个终端」：建造梦空间有时候只是想跑几条命令，
          不该被三颗 AI 按钮拦住。
          **做成一颗按钮而不是「关掉引导」的开关**：开关要记状态、要有地方再打开；
          一颗按钮点完就走，什么都不用记。 */}
      <button
        type="button"
        className="cframe-start-term"
        data-tip="先打开终端处理项目，之后仍可新建 AI 对话"
        disabled={busy}
        onClick={() => {
          if (busy) return
          setBusy(true)
          void addTerminalNode(frameId).finally(() => setBusy(false))
        }}
      >
        <TerminalIcon size={12} />
        先开个终端
      </button>
    </div>
  )
}
