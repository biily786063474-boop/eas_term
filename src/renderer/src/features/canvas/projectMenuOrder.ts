/** Canvas project picker only: running first, selected order within each group.
 * Do not reuse global urgency ranks: those belong to notifications/approval UI.
 */
export function orderProjectMenu<T extends { id: string }>(
  projects: readonly T[], mode: 'default' | 'recent', projectMru: readonly string[],
  running: ReadonlySet<string>
): T[] {
  const mru = new Map(projectMru.map((id, i) => [id, i]))
  return [...projects].sort((a, b) => {
    const group = Number(running.has(b.id)) - Number(running.has(a.id))
    if (group || mode === 'default') return group
    return (mru.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (mru.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  })
}
