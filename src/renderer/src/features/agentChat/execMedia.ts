/** Text-only tool calls must not insert empty flex items between the reply and execution list. */
export function hasExecMedia(item: { images?: readonly unknown[]; imageNotice?: string }): boolean {
  return Boolean(item.images?.length || item.imageNotice)
}
