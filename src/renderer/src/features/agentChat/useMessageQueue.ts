import { useEffect, useMemo, useReducer, useRef } from 'react'
import { createMessageQueue, type QueuedMessage } from './messageQueue'

export function useMessageQueue(sessionId: string | null, busy: () => boolean, send: (item: QueuedMessage) => Promise<boolean>) {
  const [, render] = useReducer(n => n + 1, 0)
  const latest = useRef({ busy, send, sessionId }); latest.current = { busy, send, sessionId }
  const controller = useMemo(() => createMessageQueue({
    busy: () => latest.current.busy(),
    send: item => latest.current.sessionId === sessionId ? latest.current.send(item) : Promise.resolve(false),
    interrupt: () => { if (sessionId) window.api.agentChat.interrupt(sessionId) },
    changed: render
  }), [sessionId])
  useEffect(() => () => controller.dispose(), [controller])
  return { controller, sessionId, ...controller.snapshot() }
}
