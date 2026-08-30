// 「同时只有一个在跑」的那个槽位，外加一条纪律：**旧主人的回调必须被忽略。**
//
// ── 为什么要有这个东西 ──────────────────────────────────────────────
// 登录和安装都是「同一时刻只允许一个」。用户点「重试」时的实现是
// 先 cancel 再 start —— 而 **kill 之后 close 事件是异步到的**：
// 2026-08-30 日志里实测到它比 cancel 晚 **428ms**，那时新进程早就起来了。
//
//   04:22:47.821 用户取消登录：claude
//   04:22:48.249 旧登录进程退出：claude code=143（已经不是当前流程，忽略）
//
// 不认身份的话，旧进程的死会把**新流程**标成「已结束」，界面立刻跑去查 status、
// 查到没登录、报「登录流程结束了，但还是没登上」—— 而新进程其实正跑得好好的。
//
// ── 为什么做成模块，而不是每处写一行 `if (live.proc !== proc) return` ──
// 那一行本身很难写错，**难的是不忘写**。index.ts + install.ts 一共 8 个回调
// （stdout / stderr / error / close / 超时 / close 里的异步续），
// 加第九个时漏掉一处，症状是间歇性的、只在「取消后立刻重来」这条路上出现，
// 而且不报任何错。
//
// 收进 guard() 之后，**写回调的唯一姿势就是包一层**，漏不掉；
// 而这条纪律本身有 slot.test.ts 盯着（那些测试跑的是真实事故的时序）。

export interface Slot<T> {
  /** 占住槽位。**顶掉旧的** —— 调用方负责先把旧的收拾干净（kill 之类） */
  claim(owner: object, value: T): void
  /** 当前值；**owner 对不上返回 null** —— 这就是身份校验 */
  mine(owner: object): T | null
  /** 当前值，不校验身份。给「把状态推给界面」这种不关心谁是主人的场合用 */
  any(): T | null
  /** 有人占着吗 */
  busy(): boolean
  /** 清空。**不校验身份** —— 外部取消（用户点了取消）走这条 */
  clear(): void
  /**
   * 把一个回调包成「只有当前主人才跑得到」的形式。
   *
   * **这是这个模块存在的理由**：让「认身份」从一件要记得做的事，
   * 变成一件想绕过去反而更麻烦的事。
   */
  guard<A extends unknown[]>(owner: object, fn: (v: T, ...args: A) => void): (...args: A) => void
}

export function createSlot<T>(): Slot<T> {
  let cur: { owner: object; value: T } | null = null
  return {
    claim(owner, value) {
      cur = { owner, value }
    },
    mine(owner) {
      return cur && cur.owner === owner ? cur.value : null
    },
    any() {
      return cur ? cur.value : null
    },
    busy() {
      return cur !== null
    },
    clear() {
      cur = null
    },
    guard(owner, fn) {
      return (...args) => {
        const v = cur && cur.owner === owner ? cur.value : null
        if (v === null) return
        fn(v, ...args)
      }
    }
  }
}
