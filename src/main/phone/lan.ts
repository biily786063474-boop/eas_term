// 挑一个「手机能连到」的本机地址。**纯函数**（接受 networkInterfaces 的结果），
// 因为这块判断错了的表现是「手机连不上，但看不出为什么」——必须能单测。
//
// ── 为什么不能「取第一个非回环 IPv4」 ────────────────────────────────
// 2026-08-28 真机验证时当场撞到：本机同时挂着 WireGuard（utun0 = 10.9.0.4）
// 和 Wi-Fi（en0 = 192.168.31.126），朴素写法挑中了 utun0 ——
// 于是二维码里给的是隧道地址，**同一个 Wi-Fi 下的手机压根连不上**。
// 装了 VPN / Docker / 虚拟机的机器上这不是特例，是常态。
//
// ── 排序依据 ──────────────────────────────────────────────────────
// ① 先把**虚拟/隧道网卡整类排除**（按名字），它们的地址不是给同网段设备用的
// ② 剩下的按「像不像家用局域网」排：192.168 > 172.16-31 > 10 > 其它
//    （172 和 10 段也可能是 Docker/VPN 造的，但那类多数已经被 ① 挡掉了）
// ③ 同一档里保持系统给的顺序，不再自作聪明

/** 一条候选地址。name 要给界面看 —— 自动挑错时用户得能认出该换哪个。 */
export interface LanCandidate {
  name: string
  address: string
}

/** 名字长这样的一律排除：它们要么是隧道，要么是虚拟网桥，
 *  地址都不是同一个 Wi-Fi 下的手机能路由到的。
 *
 *  · utun/tun/tap/ppp/wg   VPN 与隧道（WireGuard 在 macOS 上叫 utun*）
 *  · awdl/llw              苹果的点对点无线（AirDrop 那套），不通普通 IP
 *  · bridge/vmnet/vboxnet  虚拟机网桥
 *  · docker/veth/br-       容器
 *  · zt/ham                ZeroTier / Hamachi 这类覆盖网 */
const VIRTUAL = /^(utun|tun|tap|ppp|wg|awdl|llw|bridge|vmnet|vboxnet|docker|veth|br-|zt|ham)/i

/** 没拿到 DHCP 时系统自分配的地址段，连不通任何东西 */
const isLinkLocal = (a: string): boolean => a.startsWith('169.254.')

/** 越小越优先 */
function rank(addr: string): number {
  if (addr.startsWith('192.168.')) return 0
  // 172.16.0.0/12 —— 只有 16..31 这一段是私有地址
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 1
  if (addr.startsWith('10.')) return 2
  return 3
}

type Ifaces = Record<string, { family: string; internal: boolean; address: string }[] | undefined>

/** 所有能给手机用的候选，最合适的排第一。 */
export function lanCandidates(ifaces: Ifaces): LanCandidate[] {
  const out: (LanCandidate & { r: number; i: number })[] = []
  let i = 0
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue
    for (const ni of list ?? []) {
      // family 在不同 Node 版本里是 'IPv4' 或 4，两种都认
      const v4 = ni.family === 'IPv4' || (ni.family as unknown) === 4
      if (!v4 || ni.internal || isLinkLocal(ni.address)) continue
      out.push({ name, address: ni.address, r: rank(ni.address), i: i++ })
    }
  }
  // 稳定排序：同一档保持系统顺序，不因为 Object.entries 的实现细节抖动
  out.sort((a, b) => a.r - b.r || a.i - b.i)
  return out.map(({ name, address }) => ({ name, address }))
}

/** 最合适的那一个；一个都没有（没连网）返回 null。 */
export function pickLan(ifaces: Ifaces): string | null {
  return lanCandidates(ifaces)[0]?.address ?? null
}
