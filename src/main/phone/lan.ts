// 挑「手机能连到」的本机地址。**纯函数**（接受 networkInterfaces 的结果），
// 因为这块判断错了的表现是「手机连不上，但看不出为什么」——必须能单测。
//
// ── 一条更重要的设计转向（2026-08-30）────────────────────────────────
// 原来这里的目标是「挑准那一个」。**这个目标本身是错的**：
// 电脑没有办法知道手机能路由到哪个地址 —— 只有手机自己知道。
// 所以现在的职责变成「**给出一份干净的候选表**」，由手机并发去试、谁通用谁
//（二维码里带全部候选，见 qr.ts）。排序仍然有意义：它决定手机先试哪个。
//
// ── 为什么不能「取第一个非回环 IPv4」 ────────────────────────────────
// 2026-08-28 真机验证时当场撞到：本机同时挂着 WireGuard（utun0 = 10.9.0.4）
// 和 Wi-Fi（en0 = 192.168.31.126），朴素写法挑中了 utun0 ——
// 于是二维码里给的是隧道地址，**同一个 Wi-Fi 下的手机压根连不上**。
// 装了 VPN / Docker / 虚拟机的机器上这不是特例，是常态。
//
// ── 为什么光靠名字不行（2026-08-30 实测）──────────────────────────────
// 名字过滤是照 macOS/Linux 的命名写的（utun/awdl/en0）。Windows 上
// `os.networkInterfaces()` 给的是**友好名**，中文系统里还会是「以太网」
// 「无线局域网适配器」—— 一台装了 VMware 的 Windows 开发机实测结果：
//
//   192.168.150.1   VMware Network Adapter VMnet1   ← 排第一，给了手机
//   192.168.222.1   VMware Network Adapter VMnet8
//   192.168.31.50   以太网
//   192.168.31.126  WLAN                            ← 真正该给的排第四
//
// 「VMware Network Adapter VMnet1」开头是 VMware 不是 vmnet，`^vmnet` 认不出；
// Tailscale、ZeroTier、Hyper-V 同理。**在 Windows 上名字这条路走不通。**
// 所以补了两条不依赖名字的判据（见下面的 MAC 部分）。
//
// ── 排序依据 ──────────────────────────────────────────────────────
// ① 按名字排除虚拟/隧道网卡（对 macOS/Linux 有效，Windows 上基本指望不上）
// ② 按 MAC 排除：零 MAC 的点对点隧道、已知虚拟网卡的 OUI —— **不看本地管理位**
// ③ 剩下的按「像不像家用局域网」排：192.168 > 172.16-31 > 10 > 其它
// ④ 同一档里保持系统给的顺序，不再自作聪明

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
 *  · docker/veth/br-       容器（Windows 的 "vEthernet (WSL)" 也被 veth 接住）
 *  · zt/ham                ZeroTier / Hamachi 这类覆盖网
 *  · vmware/hyper-v/...    Windows 的友好名，开头和上面那些都不一样，得单列
 *
 *  **这张表在 Windows 上是不完整的，而且没法补完**（名字会被本地化）。
 *  它只是第一道粗筛，真正兜底的是下面的 MAC 判据和「手机自己试」。 */
const VIRTUAL =
  /^(utun|tun|tap|ppp|wg|awdl|llw|bridge|vmnet|vboxnet|docker|veth|br-|zt|ham|vmware|hyper-v|virtualbox|tailscale|zerotier|npcap|loopback)/i

/** 没拿到 DHCP 时系统自分配的地址段，连不通任何东西 */
const isLinkLocal = (a: string): boolean => a.startsWith('169.254.')

/** 全零 MAC = 点对点隧道（utun / ppp / wg），内核根本没给它二层地址。
 *
 *  本机实测：utun0（WireGuard）和 utun6（Clash TUN）都是全零，
 *  而真 Wi-Fi en0 有真 MAC。这条**不依赖名字**，所以 Windows 上也算数。 */
const isZeroMac = (mac: string): boolean => /^(00:){5}00$/i.test(mac)

/** 已知虚拟网卡的 OUI（MAC 前三段）。厂商固定，不会被本地化，
 *  比名字可靠得多 —— Windows 上主要靠这条。
 *
 *  00:50:56 / 00:0c:29 / 00:05:69 / 00:1c:14  VMware
 *  08:00:27 / 0a:00:27                        VirtualBox
 *  00:15:5d                                   Hyper-V
 *  00:1c:42                                   Parallels
 *  00:16:3e                                   Xen
 *  02:42                                      Docker 网桥（只有两段是固定的） */
const VIRTUAL_OUI =
  /^(00:50:56|00:0c:29|00:05:69|00:1c:14|08:00:27|0a:00:27|00:15:5d|00:1c:42|00:16:3e|02:42:)/i

// ⚠️ **不要用「本地管理位」判虚拟网卡。** 看起来很对：虚拟网卡多数把
// 首字节第 2 位置 1。但 macOS 默认给 Wi-Fi 做 MAC 随机化 ——
// 本机 en0 实测是 `0e:e5:68:0a:7a:3e`，首字节 0x0e 这一位就是 1。
// 按这条判，**用户自己的 Wi-Fi 会被当成虚拟网卡排掉**，而代码看着完全合理。

/** 越小越优先 */
function rank(addr: string): number {
  if (addr.startsWith('192.168.')) return 0
  // 172.16.0.0/12 —— 只有 16..31 这一段是私有地址
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 1
  if (addr.startsWith('10.')) return 2
  return 3
}

interface Iface {
  family: string
  internal: boolean
  address: string
  /** 可能没有（旧 Node、或调用方只传了三个字段）。**没有就不判**，
   *  别把「不知道」当成「是虚拟网卡」 */
  mac?: string
}
type Ifaces = Record<string, Iface[] | undefined>

/** 所有能给手机用的候选，最可能通的排第一。
 *  **调用方应该把整张表都给手机**，让它并发去试 —— 见文件头。 */
export function lanCandidates(ifaces: Ifaces): LanCandidate[] {
  const out: (LanCandidate & { r: number; i: number })[] = []
  let i = 0
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue
    for (const ni of list ?? []) {
      // family 在不同 Node 版本里是 'IPv4' 或 4，两种都认
      const v4 = ni.family === 'IPv4' || (ni.family as unknown) === 4
      if (!v4 || ni.internal || isLinkLocal(ni.address)) continue
      // mac 缺失 = 不知道，不据此排除
      if (ni.mac && (isZeroMac(ni.mac) || VIRTUAL_OUI.test(ni.mac))) continue
      out.push({ name, address: ni.address, r: rank(ni.address), i: i++ })
    }
  }
  // 稳定排序：同一档保持系统顺序，不因为 Object.entries 的实现细节抖动
  out.sort((a, b) => a.r - b.r || a.i - b.i)
  return out.map(({ name, address }) => ({ name, address }))
}

/** 最合适的那一个；一个都没有（没连网）返回 null。
 *  **这只是「先试哪个」，不是「就是这个」** —— 谁真的通只有手机知道。 */
export function pickLan(ifaces: Ifaces): string | null {
  return lanCandidates(ifaces)[0]?.address ?? null
}
