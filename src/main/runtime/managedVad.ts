import type {WebContents} from 'electron'
import {openVoiceVad, type VadSession} from '../voiceVad'
import {ownedSessions} from './ownedSessions.ts'
let sequence = 0
/** 一次录音一个 VAD worker，登记进托管服务（可见、可关闭）。
 *
 *  **不走资源准入**（2026-09-14，用户要语音永不排队）：不经 startManagedSession，不占 ledger。
 *  VAD 就绪实测 ~250ms，不做常驻；慢的是流式识别那 2.8 秒，见 voicePreviewPool。 */
export async function openManagedVad(
  owner: WebContents, model: string,
  onAudio: (samples: Float32Array, speech: boolean, targetId: string) => void,
  onError: (message: string) => void, strong = false, recordingSignal?: AbortSignal
): Promise<VadSession> {
  if (owner.isDestroyed() || recordingSignal?.aborted) throw new Error('cancelled')
  const id = `voice-vad:${owner.id}:${++sequence}`
  let session: VadSession | undefined
  let stopping = false
  const stop = (): void => {
    if (!session || stopping) return
    stopping = true
    session.stop()
    onError('人声检测服务已关闭，录音已停止')
  }
  // 启动期间就被取消：session 还没有，记下来等 openVoiceVad 回来再停
  let cancelled = false
  const release = (): void => { cancelled = true; stop() }
  const detach = (): void => {
    recordingSignal?.removeEventListener('abort', release)
    owner.removeListener('did-navigate', release)
    owner.removeListener('render-process-gone', release)
    owner.removeListener('destroyed', release)
  }
  owner.on('did-navigate', release)
  owner.on('render-process-gone', release)
  owner.once('destroyed', release)
  recordingSignal?.addEventListener('abort', release, {once: true})
  try {
    // openVoiceVad rejects failed startup only after the actual worker exit.
    const created = await openVoiceVad(model, onAudio, onError, strong)
    void created.completed.then(detach)
    if (cancelled || owner.isDestroyed()) {
      created.stop()
      await created.completed
      throw new Error('cancelled')
    }
    session = created
    ownedSessions.add({id, name: '人声检测 VAD', kind: 'voice', windowId: owner.id,
      projectId: null, completed: created.completed, stop})
    return created
  } catch (error) {
    detach()
    throw error
  }
}
