export function questionEntries(turns: readonly { role: string; text: string; compact?: unknown }[]): { turnIndex: number; title: string; preview: string }[] {
  return turns.flatMap((turn, turnIndex) => {
    if (turn.role !== 'user' || turn.compact) return []
    const answers: string[] = []
    for (let i = turnIndex + 1; i < turns.length && turns[i].role !== 'user'; i++) {
      if (!turns[i].compact && turns[i].text) answers.push(turns[i].text)
    }
    return [{ turnIndex, title: turn.text.trim() || '图片或附件提问', preview: answers.join('\n').slice(0, 320) }]
  })
}

// Leave the existing sticky question signpost above a navigated question.
export const QUESTION_SCROLL_INSET = 48

/** Question anchors move together when the canvas only translates. Keep their
 * content-relative geometry until scroll, scale or content actually changes. */
export class QuestionTopMeasure {
  private dirty = true
  private scale = Number.NaN
  private scrollTop = Number.NaN

  invalidate(): void { this.dirty = true }

  needsRead(scale: number, scrollTop: number): boolean {
    const changed = this.dirty || this.scale !== scale || this.scrollTop !== scrollTop
    this.dirty = false
    this.scale = scale
    this.scrollTop = scrollTop
    return changed
  }
}

export function activeQuestion(tops: number[], scrollTop: number): number {
  let active = 0
  for (let i = 0; i < tops.length; i++) if (tops[i] <= scrollTop + QUESTION_SCROLL_INSET + 12) active = i
  return active
}

export function railPlacement(rect: { left: number; right: number; top: number; bottom: number }, width: number, height: number, allowOutside: boolean) {
  const top = Math.max(12, rect.top + 20)
  const bottom = Math.min(height - 16, rect.bottom - 20)
  if (bottom - top < 100 || rect.right < 40 || rect.left > width - 40) return null
  const outside = allowOutside && rect.left >= 52
  return { left: outside ? rect.left - 38 : Math.max(12, rect.left + 6), top, height: bottom - top, outside }
}
