import type {WebContents} from 'electron'
import {openVoiceVad, type VadSession} from '../voiceVad'
import {startManagedSession, cancelSessionStart} from './sessionStartup.ts'
import {ownedSessions} from './ownedSessions.ts'
let sequence = 0
/** One VAD worker per recording owner. This lease covers its full resident lifetime. */
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
  const release = (): void => { cancelSessionStart(id, owner.id); stop() }
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
    return await startManagedSession({
      id, windowId: owner.id, name: '人声检测', interactive: true, projectId: null,
      cost: {cpu: 5, memoryBytes: 128 * 1024 * 1024},
      start: async signal => {
        if (signal.aborted || owner.isDestroyed()) throw new Error('cancelled')
        // openVoiceVad rejects failed startup only after the actual worker exit.
        session = await openVoiceVad(model, onAudio, onError, strong)
        void session.completed.then(detach)
        if (signal.aborted || owner.isDestroyed()) {
          session.stop()
          await session.completed
          throw new Error('cancelled')
        }
        ownedSessions.add({id, name: '人声检测 VAD', kind: 'voice', windowId: owner.id,
          projectId: null, completed: session.completed, stop})
        return {value: session, completed: session.completed}
      }
    })
  } catch (error) {
    detach()
    throw error
  }
}
