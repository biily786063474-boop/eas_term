import { tm } from './i18n/current.ts'
import type { InstallState } from './types'

/** 不从日志猜进度百分比；标题只表述我们确定知道的安装器/验证状态。 */
export function installActivity(state: InstallState, now: number): {
  stage: string
  recent: string[]
  stalled: boolean
  secondsSinceOutput: number
} {
  const stage = state.phase === 'verifying' ? tm('errCore.install.stageVerifying') : state.phase === 'stopping' ? tm('errCore.install.stageStopping') : tm('errCore.install.stageRunning')
  const recent = (state.output ?? []).slice(-3)
  const secondsSinceOutput = Math.max(0, Math.floor((now - (state.updatedAt ?? state.startedAt ?? now)) / 1000))
  return { stage, recent, stalled: state.phase === 'running' && secondsSinceOutput >= 30, secondsSinceOutput }
}
