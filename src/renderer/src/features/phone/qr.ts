// 最小二维码编码器。**只支持这个功能真正需要的那一种**：
// 字节模式（byte mode）+ 纠错等级 M + 自动挑版本，输出一个 true/false 的方阵。
//
// ── 为什么自己写而不是加依赖 ────────────────────────────────────────
// 要编的内容是一个局域网 URL（`http://192.168.1.20:50456/?c=ABC123`，40 字左右），
// 固定形状、固定字符集。为这点需求引一个通用 QR 库（连同它的 canvas/svg 渲染、
// 多模式编码、logo 叠加）不划算，而且这条路上的东西是要随包发出去的。
//
// ── 敢自己写的前提：**它是可验证的** ────────────────────────────────
// 二维码的坑全在 Reed-Solomon 和掩码上，写错了的表现是「看着像个码，扫不出来」。
// 所以配套测试不是「跑通不抛异常」，而是拿**规范里的已知答案**对：
// ISO/IEC 18004 附录里 "HELLO WORLD" 的 RS 结果、以及固定的格式信息位串。
// 对不上就是错的，不靠肉眼看方块。
//
// 支持范围：**版本 1-7**（最多 121 字节）。为什么停在 7 见 M_PARAMS 那段 ——
// 不是够不够用的问题，是从版本 8 起块不再等长、单组写法编出来的码是坏的。

/** GF(256) 的指数/对数表，本原多项式 0x11D（QR 规范指定） */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** 生成多项式：(x-α⁰)(x-α¹)…(x-α^(n-1)) */
function genPoly(n: number): Uint8Array {
  let g = new Uint8Array([1])
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(g.length + 1)
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]
      next[j + 1] ^= mul(g[j], EXP[i])
    }
    g = next
  }
  return g
}

/** Reed-Solomon 纠错码字。**这是最容易写错的一段**，测试拿规范里的已知答案对。 */
export function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const g = genPoly(ecLen)
  const res = new Uint8Array(data.length + ecLen)
  res.set(data)
  for (let i = 0; i < data.length; i++) {
    const c = res[i]
    if (c === 0) continue
    for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c)
  }
  return res.slice(data.length)
}

/** 各版本在纠错等级 M 下的参数：[每块数据码字数, 每块纠错码字数, 块数]。
 *  取自 ISO/IEC 18004 表 9。
 *
 *  **只到版本 7 —— 这不是偷懒，是正确性边界。** 从版本 8 起，M 级的块不再等长
 *  （v8 是 2×38 + 2×39，v9 是 3×36 + 2×37，v10 是 4×43 + 1×44），
 *  交错规则也跟着变。原来这张表把 v8-10 按单组写，编出来的码是坏的 ——
 *  而坏在哪肉眼完全看不出来（方块照样是方块）。
 *
 *  v7 能放 121 字节，而这里要编的是 `http://192.168.1.20:50456/?c=ABC123`
 *  这种 40 字上下的局域网地址。**够用三倍，没有理由为此引入两组块的复杂度。** */
const M_PARAMS: [number, number, number][] = [
  [16, 10, 1], // v1
  [28, 16, 1], // v2
  [44, 26, 1], // v3
  [32, 18, 2], // v4
  [43, 24, 2], // v5
  [27, 16, 4], // v6
  [31, 18, 4] // v7
]
const MAX_VERSION = M_PARAMS.length

/** 版本 v 在 M 级能放多少字节内容（扣掉模式指示符 4 位和长度字段 8/16 位） */
function capacity(v: number): number {
  const [dc, , blocks] = M_PARAMS[v - 1]
  const total = dc * blocks
  // 版本 1-9 的字节模式长度字段是 8 位，模式指示符 4 位 —— 合起来 12 位，
  // 向上取整占 2 个码字
  return total - 2
}

/** 对齐图案的中心坐标（版本 2 起才有）。取自规范表 E.1。 */
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38]]

/** 格式信息（纠错等级 M = 0b00，掩码 0-7）。BCH(15,5) + 掩码 0x5412。
 *  写死成表是因为它只有 8 个值，而现算一遍 BCH 反而更容易错。 */
const FORMAT_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0
]

interface Grid {
  size: number
  mod: Uint8Array // 0/1
  fixed: Uint8Array // 1 = 功能图案，不能被数据覆盖
}

function newGrid(size: number): Grid {
  return { size, mod: new Uint8Array(size * size), fixed: new Uint8Array(size * size) }
}
const at = (g: Grid, r: number, c: number): number => g.mod[r * g.size + c]
function set(g: Grid, r: number, c: number, v: number, fixed = false): void {
  g.mod[r * g.size + c] = v
  if (fixed) g.fixed[r * g.size + c] = 1
}

/** 定位图案（三个角的回字） + 分隔带 */
function putFinder(g: Grid, r0: number, c0: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const r1 = r0 + r
      const c1 = c0 + c
      if (r1 < 0 || c1 < 0 || r1 >= g.size || c1 >= g.size) continue
      const on =
        r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
      set(g, r1, c1, on ? 1 : 0, true)
    }
  }
}

/** 八种掩码。规范 §7.8.2 —— 顺序不能动，掩码号要和格式信息里的编号对上。 */
const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
]

/**
 * 把一段文本编成二维码方阵。返回 size×size 的布尔数组（true = 黑）。
 * 内容放不下（超过版本 7 的 121 字节）时返回 null —— **不静默截断**，
 * 截断出来的码扫出来是半截 URL，比没有更糟。
 */
export function encodeQR(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text)
  let version = 0
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= capacity(v)) {
      version = v
      break
    }
  }
  if (!version) return null

  const [dcPerBlock, ecPerBlock, blocks] = M_PARAMS[version - 1]
  const totalData = dcPerBlock * blocks

  // ── 比特流：模式(0100) + 长度(8 位) + 数据 + 终止符 + 补齐 ──
  const bits: number[] = []
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, 8)
  for (const b of bytes) push(b, 8)
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const dataBytes: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    dataBytes.push(v)
  }
  // 填充字节 0xEC / 0x11 交替（规范指定）
  const PAD = [0xec, 0x11]
  let p = 0
  while (dataBytes.length < totalData) dataBytes.push(PAD[p++ % 2])

  // ── 分块 + 各自算纠错，再按规范交错 ──
  const dBlocks: Uint8Array[] = []
  const eBlocks: Uint8Array[] = []
  for (let b = 0; b < blocks; b++) {
    const d = new Uint8Array(dataBytes.slice(b * dcPerBlock, (b + 1) * dcPerBlock))
    dBlocks.push(d)
    eBlocks.push(rsEncode(d, ecPerBlock))
  }
  const inter: number[] = []
  for (let i = 0; i < dcPerBlock; i++) for (const d of dBlocks) inter.push(d[i])
  for (let i = 0; i < ecPerBlock; i++) for (const e of eBlocks) inter.push(e[i])

  // ── 画功能图案 ──
  const size = version * 4 + 17
  const g = newGrid(size)
  putFinder(g, 0, 0)
  putFinder(g, 0, size - 7)
  putFinder(g, size - 7, 0)
  // 定时图案
  for (let i = 8; i < size - 8; i++) {
    set(g, 6, i, i % 2 === 0 ? 1 : 0, true)
    set(g, i, 6, i % 2 === 0 ? 1 : 0, true)
  }
  // 对齐图案（避开三个定位角）
  const al = ALIGN[version]
  for (const r of al) {
    for (const c of al) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1
          set(g, r + dr, c + dc, on ? 1 : 0, true)
        }
      }
    }
  }
  // 格式信息区先占位（值稍后写）。
  // **列 8 这一侧只占 7 格（size-1 到 size-7）** —— 第 8 格 (size-8, 8) 是
  // 固定暗模块，不属于格式信息。原来这里写 8 格，把暗模块冲成了 0；
  // 当时没暴露是因为格式位的写入又恰好覆盖回那一格，改了位序之后才露出来。
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(g, 8, i, 0, true)
      set(g, i, 8, 0, true)
    }
  }
  for (let i = 0; i < 7; i++) set(g, size - 1 - i, 8, 0, true)
  for (let i = 0; i < 8; i++) set(g, 8, size - 1 - i, 0, true)
  // 固定的暗模块。**放在占位之后**，免得再被冲掉
  set(g, size - 8, 8, 1, true)

  // ── 铺数据：从右下角起，两列一组之字形向上 ──
  const dataBits: number[] = []
  for (const b of inter) for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1)
  let idx = 0
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // 跳过竖向定时图案那一列
    for (let n = 0; n < size; n++) {
      const row = upward ? size - 1 - n : n
      for (let k = 0; k < 2; k++) {
        const c = col - k
        if (g.fixed[row * size + c]) continue
        set(g, row, c, idx < dataBits.length ? dataBits[idx] : 0)
        idx++
      }
    }
    upward = !upward
  }

  // ── 挑掩码：算八种的罚分，取最小 ──
  let best = 0
  let bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    const s = penalty(g, m)
    if (s < bestScore) {
      bestScore = s
      best = m
    }
  }

  // 写格式信息。
  //
  // **位序是 MSB 先出：第一个位置放 bit14，最后一个放 bit0。**
  // 这里原来写反了（第一个位置放 bit0），后果是生成的码**结构完全正确、
  // 肉眼看不出任何问题，但扫码器一律读不出来** —— 因为它读到的等级/掩码
  // 是一个不存在的组合。用系统的 CIQRCodeGenerator 生成同一段文本做参照、
  // 反推位序才定位到（2026-08-28）。
  //
  // 两份拷贝的位置表（规范 §7.9）：
  //   第一份：(8,0..5) (8,7) (8,8) (7,8) (5,8) (4,8) (3,8) (2,8) (1,8) (0,8)
  //   第二份：(n-1,8)…(n-7,8) 然后 (8,n-8)…(8,n-1)
  const fmt = FORMAT_M[best]
  const POS1: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ]
  const POS2: [number, number][] = []
  for (let i = 0; i < 7; i++) POS2.push([size - 1 - i, 8])
  for (let i = 0; i < 8; i++) POS2.push([8, size - 8 + i])
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> (14 - i)) & 1
    set(g, POS1[i][0], POS1[i][1], bit, true)
    set(g, POS2[i][0], POS2[i][1], bit, true)
  }

  // 输出（应用选中的掩码）
  const out: boolean[][] = []
  for (let r = 0; r < size; r++) {
    const row: boolean[] = []
    for (let c = 0; c < size; c++) {
      const masked = !g.fixed[r * size + c] && MASKS[best](r, c)
      row.push((at(g, r, c) ^ (masked ? 1 : 0)) === 1)
    }
    out.push(row)
  }
  return out
}

/** 掩码罚分（规范 §7.8.3 的四条规则）。只用来在八种里挑一个，
 *  算得略糙不影响可扫性 —— 但四条都得有，只算一条会挑出很差的掩码。 */
function penalty(g: Grid, mask: number): number {
  const s = g.size
  const v = (r: number, c: number): number => {
    const m = !g.fixed[r * s + c] && MASKS[mask](r, c) ? 1 : 0
    return at(g, r, c) ^ m
  }
  let score = 0
  // 规则 1：同色连续 5 个以上
  for (let r = 0; r < s; r++) {
    for (const dir of [0, 1]) {
      let run = 1
      for (let i = 1; i < s; i++) {
        const a = dir ? v(i - 1, r) : v(r, i - 1)
        const b = dir ? v(i, r) : v(r, i)
        if (a === b) run++
        else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      if (run >= 5) score += run - 2
    }
  }
  // 规则 2：2×2 同色
  for (let r = 0; r < s - 1; r++)
    for (let c = 0; c < s - 1; c++)
      if (v(r, c) === v(r, c + 1) && v(r, c) === v(r + 1, c) && v(r, c) === v(r + 1, c + 1))
        score += 3
  // 规则 3：出现类似定位图案的 1:1:3:1:1 序列
  const PAT = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  for (let r = 0; r < s; r++) {
    for (let c = 0; c + 11 <= s; c++) {
      let hOk = true
      let vOk = true
      for (let i = 0; i < 11; i++) {
        if (v(r, c + i) !== PAT[i]) hOk = false
        if (v(c + i, r) !== PAT[i]) vOk = false
      }
      if (hOk) score += 40
      if (vOk) score += 40
    }
  }
  // 规则 4：黑白比例偏离 50%
  let dark = 0
  for (let r = 0; r < s; r++) for (let c = 0; c < s; c++) dark += v(r, c)
  score += Math.floor(Math.abs((dark * 100) / (s * s) - 50) / 5) * 10
  return score
}
