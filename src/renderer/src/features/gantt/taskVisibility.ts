/** Display-only filtering: never delete history or invent an interruption time. */
export function visibleTasks<T extends { aborted?: boolean }>(tasks: T[], showAborted = false): T[] {
  return showAborted ? tasks : tasks.filter(t => !t.aborted)
}
export function taskDisplayEnd(t: { startAt: number; endAt: number | null; aborted?: boolean }, now: number): number {
  return t.endAt ?? (t.aborted ? t.startAt : now)
}
