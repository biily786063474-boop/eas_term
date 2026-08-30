// 终端最近的输出，留在主进程里给手机端读。**零 import，能单测。**
//
// ── 为什么需要（2026-08-30 用户要求）──────────────────────────────
// 「我希望终端的信息也可以被转换为手机可以读到的」。
// 终端输出原来只流向渲染层的 xterm，主进程转手就丢 —— 手机上只看得到
// 「在跑 / 空闲」这种状态，看不到它到底在刷什么。
//
// ── 两条让它不拖慢终端的设计 ────────────────────────────────────
// ① **存原始文本，读的时候才清洗。** 终端数据是热路径（一次 npm install
//    能刷几 MB），在写入侧做 ANSI 剥离等于给每一块输出都加一遍正则。
//    而「读」是手机偶尔拉一次 —— 把开销放到那一侧，代价小几个数量级。
// ② **按字节封顶，超了从头砍。** 不是按行 —— 一行可以无限长
//    （压缩包的 base64、minified JS），按行数封顶挡不住内存。
//
// ── 为什么不复用 scrollback ────────────────────────────────────
// xterm 的 scrollback 在**渲染层**，而画布会把视口外的终端整个裁掉。
// 走它的话「手机能不能看到终端」取决于「电脑画布滚到哪儿」——
// 跟对话摘要那条同一个理由（见 agentChat/transcript.ts）。

/** 每个终端留多少字节。**32KB ≈ 几百行**，手机上翻到头绰绰有余；
 *  开十几个终端也就几百 KB。 */
export const MAX_BYTES = 32 * 1024

/** 一次最多回多少行给手机。**行数上限在读那侧** ——
 *  存的时候不知道行有多长，读的时候才好按行裁 */
export const MAX_LINES = 300

/** 终端控制序列。**必须带 ESC 前缀显式写成 \u001b** ——
 *  第一版把 ESC 直接写进了源码字面量，落盘时丢了，于是正则变成了
 *  「匹配任意方括号数字」和「从任意 ] 开始贪婪吃到底」，
 *  **把真实输出整段清空**。实测才发现：手机上读到的全是空行。
 *  单测当时是绿的 —— 因为测试里用 \u001b 转义写，正好被那个坏正则的
 *  另一个分支吃掉了，**凑巧过了**。所以下面补了一条拿真实 zsh 输出做的测试。
 *
 *  三类都要挡：
 *  · CSI  `ESC [ … 字母`  —— 颜色、光标移动、清行
 *  · OSC  `ESC ] … BEL/ST` —— 设置窗口标题（zsh 每次画提示符都发）
 *  · 双字符  `ESC @-_`     —— 换字符集之类 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** 退格和其它裸控制字符。**\r 和 \n 不在内** —— 那两个下面要用来分行 */
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/**
 * 把原始终端输出清洗成人能读的行。
 *
 * **`\r` 要当行覆盖处理**：进度条是靠回车原地重画的，
 * 不处理的话手机上会看到 `10%20%30%…` 一长串残影。
 */
export function cleanLines(raw: string, maxLines = MAX_LINES): string[] {
  const out: string[] = []
  // **先把 CRLF 归一成 LF。** 终端的换行是 `\r\n`，不先归一的话
  // 下面那步「取 \r 之后的部分」会把每一行都变成空串 ——
  // 手机上读到的就是一屏空行（2026-08-30 实测撞到，光修正则不够）。
  const normalized = raw.replace(ANSI, '').replace(CTRL, '').replace(/\r\n/g, '\n')
  for (const chunk of normalized.split('\n')) {
    // 到这儿还剩的 \r 就是真正的「行内覆盖」了（进度条原地重画），
    // 只留最后一次写的内容
    const parts = chunk.split('\r')
    out.push(parts[parts.length - 1])
  }
  // 末尾的空行去掉（终端输出通常以换行结尾），但**中间的空行保留** ——
  // 那是排版，抹掉会让输出挤成一团
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.slice(-maxLines)
}

export interface TermTailStore {
  /** 记一段原始输出。**不做任何清洗** —— 那是读那侧的事 */
  push(ptyId: string, raw: string): void
  /** 读最近若干行，已清洗 */
  recent(ptyId: string, maxLines?: number): string[]
  /** 终端没了就丢掉 */
  drop(ptyId: string): void
  bytes(ptyId: string): number
}

export function createTermTailStore(maxBytes = MAX_BYTES): TermTailStore {
  const buf = new Map<string, string>()
  return {
    push(ptyId, raw) {
      if (!ptyId || !raw) return
      const cur = (buf.get(ptyId) ?? '') + raw
      // 超了从头砍。**按字节不按行** —— 一行可以无限长
      buf.set(ptyId, cur.length > maxBytes ? cur.slice(cur.length - maxBytes) : cur)
    },
    recent(ptyId, maxLines = MAX_LINES) {
      const raw = buf.get(ptyId)
      return raw ? cleanLines(raw, maxLines) : []
    },
    drop(ptyId) {
      buf.delete(ptyId)
    },
    bytes(ptyId) {
      return buf.get(ptyId)?.length ?? 0
    }
  }
}
