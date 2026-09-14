import { Worker } from 'node:worker_threads'
import { voiceVadWorkerCode } from './voiceVadWorker'

export interface VadSession {
  completed: Promise<void>
  push(samples: Float32Array, targetId?: string): boolean
  drain(): Promise<void>
  stop(): void
}
/** A bounded FIFO; backpressure stops recording rather than silently losing speech. */
export async function openVoiceVad(model: string, onAudio: (samples: Float32Array, speech: boolean, targetId: string) => void, onError: (message: string) => void, strong = false): Promise<VadSession> {
  const worker = new Worker(voiceVadWorkerCode, { eval: true, execArgv: [], workerData: { model, strong, sherpaPath: require.resolve('sherpa-onnx') } })
  const completed = new Promise<void>(resolve => worker.once('exit', () => resolve()))
  let stopped = false, count = 0, next = 0
  const drains: (() => void)[] = []
  const notify = (): void => { if (!count) drains.splice(0).forEach(r => r()) }
  const stop = (): void => { if (stopped) return; stopped = true; count = 0; notify(); void worker.terminate() }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('人声检测启动超时')) }, 15000)
    const fail = (error: Error): void => { clearTimeout(timer); stop(); reject(error) }
    const exited = (code: number): void => fail(new Error('VAD exited before ready: '+code))
    worker.once('exit', exited)
    worker.once('error', fail)
    worker.once('message', m => {
      clearTimeout(timer)
      worker.removeListener('error', fail)
      worker.removeListener('exit', exited)
      if (!m.ready) { stop(); reject(new Error(m.error || '人声检测启动失败')); return }
      resolve()
    })
  }).catch(async error => {
    // A failed handshake is not evidence that the native worker has exited.
    await completed
    throw error
  })
  worker.on('error', error => { if (!stopped) { stop(); onError(error.message) } })
  worker.on('exit', code => { if (!stopped) { stop(); onError(`人声检测线程退出（${code}）`) } })
  worker.on('message', m => {
    if (stopped) return
    if (m.error) { stop(); onError(m.error); return }
    if (typeof m.id === 'number') { count--; onAudio(m.samples, m.speech === true, m.targetId ?? ''); notify() }
  })
  return {
    completed,
    push(samples, targetId = '') {
      if (stopped) return false
      if (count >= 32) { stop(); onError('人声检测处理跟不上录音，请停止后重试'); return false }
      count++; worker.postMessage({ id: ++next, samples, targetId }, [samples.buffer as ArrayBuffer]); return true
    },
    drain: () => count ? new Promise<void>(resolve => drains.push(resolve)) : Promise.resolve(),
    stop
  }
}
