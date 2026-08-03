// 待处理提示音的触发点。
//
// 挂在 App 顶层，和视图模式无关——分屏和画布都该响。
// 按用户要求：**主窗口在前台时也响**（不判断前台状态）。
import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { playNotice } from './sound'

/** 等审批解析落定再决定播哪个音。
 *  attention 是标题 spinner 一停就打的，而「这是审批还是答完了」要再读一次屏幕
 *  （TerminalView 里延后 150ms 解析）。不等的话新通知一律按 done 播，
 *  审批音就永远不会出现。 */
const SETTLE_MS = 250

export function useNoticeSound(): void {
  const attentionPtys = useStore((s) => s.attentionPtys)
  /** 已经为哪些终端响过了。不记的话每帧推送都会重播 */
  const rung = useRef(new Set<string>())

  useEffect(() => {
    // 提醒消失的终端要从记录里摘掉，否则同一个终端第二次完成不会再响
    for (const id of [...rung.current]) {
      if (!attentionPtys.includes(id)) rung.current.delete(id)
    }
    const fresh = attentionPtys.filter((id) => !rung.current.has(id))
    if (!fresh.length) return
    fresh.forEach((id) => rung.current.add(id))

    const t = setTimeout(() => {
      // 一批里只要有一个在等审批，整批就按审批音播——那是更急的那种。
      // 整批只播一次，是刻意的：三个任务同时完成不该响三声。
      const approval = useStore.getState().ptyApproval
      playNotice(fresh.some((id) => approval[id]) ? 'approval' : 'done')
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [attentionPtys])
}
