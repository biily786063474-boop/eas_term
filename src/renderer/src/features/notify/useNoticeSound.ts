// 待处理提示音的触发点。
//
// 挂在 App 顶层，和视图模式无关——分屏和画布都该响。
// 按用户要求：**主窗口在前台时也响**（不判断前台状态）。
import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { playNotice } from './sound'
import { pickNoticeSound, ringKeyOf } from './backgroundNotice'

/** 等审批解析落定再决定播哪个音。
 *  attention 是标题 spinner 一停就打的，而「这是审批还是答完了」要再读一次屏幕
 *  （TerminalView 里延后 150ms 解析）。不等的话新通知一律按 done 播，
 *  审批音就永远不会出现。 */
const SETTLE_MS = 250

export function useNoticeSound(): void {
  const attentionPtys = useStore((s) => s.attentionPtys)
  const ptyBackground = useStore((s) => s.ptyBackground)
  /** 已经为哪些提醒响过了（键见 ringKeyOf）。不记的话每帧推送都会重播。
   *  键里带「后台运行中」标记的时刻：宽限到期转成普通完成时标记摘掉、键变了，
   *  那条会被当成新的按 done 再响一次；标记不变就不重响。 */
  const rung = useRef(new Set<string>())

  useEffect(() => {
    const keyed = attentionPtys.map((id) => [id, ringKeyOf(id, ptyBackground[id])] as const)
    const live = new Set(keyed.map(([, k]) => k))
    // 提醒消失的要从记录里摘掉，否则同一个终端第二次完成不会再响
    for (const k of [...rung.current]) {
      if (!live.has(k)) rung.current.delete(k)
    }
    const freshKeys = keyed.filter(([, k]) => !rung.current.has(k))
    if (!freshKeys.length) return
    freshKeys.forEach(([, k]) => rung.current.add(k))
    const fresh = freshKeys.map(([id]) => id)

    const t = setTimeout(() => {
      // 一批里只要有一个在等审批，整批就按审批音播——那是更急的那种；
      // 否则有「后台运行中」就播后台音（不是「完成」，见 backgroundNotice.ts）；都没有才是完成。
      // 整批只播一次，是刻意的：三个任务同时完成不该响三声。
      const { ptyApproval, ptyBackground: bg } = useStore.getState()
      playNotice(pickNoticeSound(fresh, ptyApproval, bg))
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [attentionPtys, ptyBackground])
}
