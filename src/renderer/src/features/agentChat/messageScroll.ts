/** Layout changes are not user intent. Remember the previous position rather than
 * interpreting newly increased scrollHeight as a request to stop following. */
export function createMessageScroll(el: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  let following = true
  let previousTop = el.scrollTop
  return {
    layout() {
      if (following) el.scrollTop = el.scrollHeight
      previousTop = el.scrollTop
      return following
    },
    scroll() {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      if (el.scrollTop < previousTop - 1) following = near
      else if (near) following = true
      previousTop = el.scrollTop
      return following
    },
    pause() { following = false },
    latest() { following = true; el.scrollTop = el.scrollHeight; previousTop = el.scrollTop }
  }
}
