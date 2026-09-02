// 把 `omp auth-broker login <provider>` 的输出读成界面能用的几种状态。
//
// ── 为什么要有这个文件 ──────────────────────────────────────────────────────
// 订阅登录（Claude Pro/Max、ChatGPT Plus、智谱 GLM Coding Plan、Kimi、Copilot…）
// 走的是 omp 自己的 `auth-broker`，它是**为终端写的交互流程**：
// 往 stdout 写提示语，从 stdin 读用户贴回来的东西。我们要在 GUI 里驱动它，
// 就得把那套终端对话翻成事件。形状与 `cliAuth` 驱动 Claude 登录时做的事是一样的。
//
// ── 两个非做不可的细节，做漏了界面就是「卡住不动」──────────────────────────
// · **网址在提示语的下一行**（上游 `auth-broker-cli.ts` 的 `onAuth`：先写
//   "Open this URL in your browser:"，再单独写一行完整 URL）。只匹配提示语拿不到网址；
//   只匹配 `http` 又会把进度日志里别的网址误当成登录地址。
// · **提问不带换行**（`promptLine` 用 readline.question 写出去）。按行切的解析器会
//   一直等那个永远不来的换行 —— 用户看着一个不动的窗口，而 omp 正在等他输入。
//
// ── 为什么不自己给 provider 分类 ────────────────────────────────────────────
// omp 认识 70 家，有的走浏览器 OAuth、有的就是引导你贴一把 key。**哪家走哪条不该由
// 我们猜**：猜错就是给用户一个点进去走不通的按钮。所以这里只做「omp 问什么、
// 界面就照着问什么」，分类交给它自己。

/** 登录过程中界面需要知道的事。 */
export type OmpLoginEvent =
  /** 该让用户去浏览器里打开这个网址了 */
  | { k: 'url'; url: string; launchUrl?: string }
  /** omp 在等用户输入（贴授权码 / 贴 API key / 回答它的问题）。message 是它的原话 */
  | { k: 'prompt'; message: string }
  /** 一句进度，原样显示 */
  | { k: 'progress'; text: string }
  /** 凭证已经存下了 */
  | { k: 'done' }

/** 上游写的那句提示语，网址在它的**下一行**。 */
const URL_BANNER = 'Open this URL in your browser:'
/** 本机快捷入口，跟在正式网址后面。 */
const SHORTCUT_PREFIX = 'Local shortcut (this machine only):'
/** 上游成功时写的最后一句。 */
const DONE_PREFIX = 'Credentials saved to'

export interface OmpLoginParser {
  /** 喂一块 stdout。返回这一块里认出来的事件（可能是零个）。 */
  push(chunk: string): OmpLoginEvent[]
}

export function createOmpLoginParser(): OmpLoginParser {
  let buf = ''
  /** 上一行是那句提示语 —— 下一行非空行就是网址 */
  let expectUrl = false
  /** 已经报出去的那个网址，等它的本机快捷入口 */
  let pendingUrl: { k: 'url'; url: string; launchUrl?: string } | null = null
  /** 已经报过的提问原文。同一句不重复报 —— stdout 可能分好几块到达，
   *  每块都报一次的话界面会连闪几个输入框。 */
  let lastPrompt = ''

  function line(raw: string, out: OmpLoginEvent[]): void {
    const s = raw.trim()
    if (!s) return

    if (s === URL_BANNER) {
      // 提示语本身不往外报 —— 它只是给下一行做铺垫，报出去就是一句没有信息的进度
      expectUrl = true
      return
    }
    if (expectUrl) {
      expectUrl = false
      pendingUrl = { k: 'url', url: s }
      out.push(pendingUrl)
      return
    }
    if (s.startsWith(SHORTCUT_PREFIX)) {
      const launchUrl = s.slice(SHORTCUT_PREFIX.length).trim()
      // **就地补进已经报出去的那个事件对象**：界面拿到的是同一个引用，
      // 不用为「先报网址、再补快捷入口」这件事额外设计一种事件。
      if (pendingUrl && launchUrl) pendingUrl.launchUrl = launchUrl
      return
    }
    if (s.startsWith(DONE_PREFIX)) {
      out.push({ k: 'done' })
      return
    }
    out.push({ k: 'progress', text: s })
  }

  return {
    push(chunk: string): OmpLoginEvent[] {
      const out: OmpLoginEvent[] = []
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        line(buf.slice(0, i), out)
        buf = buf.slice(i + 1)
      }
      // **剩下这半行可能是一句提问。** readline 的问句不带换行，
      // 死等换行的话界面永远不知道该让用户输东西。
      // 判据用「以冒号结尾」而不是匹配具体文案：omp 对不同 provider 问的话不一样
      // （贴授权码 / 填 API key / 选账号…），匹配文案等于把分类又揽回自己身上。
      const tail = buf.trim()
      if (tail.endsWith(':') && tail !== URL_BANNER && tail !== lastPrompt) {
        lastPrompt = tail
        out.push({ k: 'prompt', message: tail })
      }
      return out
    }
  }
}
