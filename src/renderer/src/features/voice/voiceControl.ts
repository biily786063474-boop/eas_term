// 「发送时收麦」的登记处。
//
// 为什么要有这一层：收麦的状态（MediaRecorder、主进程那个识别会话）都锁在
// VoiceButton 内部，而**触发收麦的时机在别人手里**——用户点发送按钮、按 ⌘↵、
// 点画布上的「启动」，这些地方都够不到那个组件。
//
// 原来的做法是 VoiceButton 自己在 window 上监听 Enter 键。那只能盖住键盘那一条：
// 点发送按钮走的是 mousedown，压根没有 keydown，于是消息发出去了、麦克风还开着录，
// 下一句话被录进来接在后面。用户报的就是这个。
//
// 用一个模块级的登记而不是 zustand slice：这是纯粹的「命令式副作用句柄」，
// 不参与渲染、没人需要订阅它的变化，放进 store 只会让每次录音开关都触发一轮重渲染。
//
// 同一时刻只可能有一个 VoiceButton 在录（录音要独占麦克风），所以一个槽位就够。

let stopper: (() => Promise<void>) | null = null

/** 开始录音的组件登记自己的收麦函数；停止/卸载时用同一个函数注销。 */
export function setVoiceStopper(fn: (() => Promise<void>) | null): void {
  stopper = fn
}

/** 注销，但只在登记的还是自己时才清 —— 防止「A 停 → B 开 → A 的清理才跑」
 *  这种交错顺序把 B 的登记误清掉（React 的 effect 清理经常晚于下一次挂载）。 */
export function clearVoiceStopper(fn: () => Promise<void>): void {
  if (stopper === fn) stopper = null
}

/** 正在录就收掉。任何「把用户的话发出去」的路径都该调一次。
 *  没在录时是空转，可以随便调；也不 await 得到任何返回值，调用方不需要关心结果。 */
export async function stopVoiceOnSend(): Promise<void> {
  const fn = stopper
  if (!fn) return
  // 先清再调：收麦本身是异步的，中间如果又有一次发送进来，
  // 不清的话会重复调 stt.stop()。
  stopper = null
  try {
    await fn()
  } catch (e) {
    // 收麦失败不该影响「消息已经发出去了」这件事
    console.error('[voice] 发送时收麦失败', e)
  }
}
