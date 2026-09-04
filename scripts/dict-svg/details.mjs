// 34 条新词条各自的「演示层」：镜头推到区块之后，在里面演一遍这条手法。
//
// 坐标是**全景坐标**（区块本身只有几十 × 十几），镜头会把它放大 4~10 倍。
// 所以：线宽写 `__SW__`（生成器按倍数换算，否则放大后边框像一堵墙）、
// 圆角写小数、别用 font-size 小于 2 的文字（放大后仍然糊）。
//
// 配色纪律：**块色 (#26314a) 打底，强调色 (#e0a45e) 只给"正在发生的那个元素"**。
// 整片强调色放大后是一大块橙，和已有 243 张的克制完全不搭（实测过，很难看）。

const D = '4000ms'
/** 演示阶段占整条时间轴的 0.34~0.86，内部动画都在这一段里排。
 *
 *  ⚠️ **keyTimes 和 values 的个数必须相等**，不等的话 SMIL 判定整条动画非法、
 *  **直接忽略，且不报任何错**。第一版这里少了一个 values（keyTimes 有
 *  「0」和「0.34」两个前缀，values 只有一个），于是所有以 opacity="0" 起手的
 *  元素永远不显形 —— 巨型菜单的下拉面板、更多入口的第二行、标签徽标的红点
 *  全都画了但看不见，而且看不出哪里错了。
 *
 *  两边都是 n+3：keyTimes = 0 · 0.34 · n 个映射点 · 1
 *              values   = v0 · v0 · n 个值 · 最后一个值 */
const seg = (vals, times) =>
  `keyTimes="0;0.34;${times.map((t) => (0.34 + t * 0.52).toFixed(3)).join(';')};1" `
  + `values="${vals[0]};${vals[0]};${vals.join(';')};${vals[vals.length - 1]}"`

/** 一排水平条（列表行 / 表格行 / 链接行） */
const rows = (x, y, w, n, gap, h, fill, opacity = 1) =>
  Array.from({ length: n }, (_, i) =>
    `<rect x="${x}" y="${(y + i * (h + gap)).toFixed(2)}" width="${w}" height="${h}" rx=".6" fill="${fill}" opacity="${opacity}"/>`
  ).join('')

/** 网格块 */
const grid = (x, y, cols, rowsN, cw, ch, gx, gy, fill, opacity = 1) => {
  const out = []
  for (let j = 0; j < rowsN; j++) for (let i = 0; i < cols; i++)
    out.push(`<rect x="${(x + i * (cw + gx)).toFixed(2)}" y="${(y + j * (ch + gy)).toFixed(2)}" width="${cw}" height="${ch}" rx=".8" fill="${fill}" opacity="${opacity}"/>`)
  return out.join('')
}
/** 在演示阶段内做一次属性动画 */
const anim = (attr, values, times) =>
  `<animate attributeName="${attr}" ${seg(values, times)} dur="${D}" repeatCount="indefinite"/>`

export const DETAILS = {
  // ── 页脚（桌面）────────────────────────────────────────────────────────
  'mega-footer': (r, C) => {
    const [x, y, w, h] = r
    let s = ''
    for (let c = 0; c < 4; c++) {
      const cx = x + 6 + c * (w - 12) / 4
      s += `<rect x="${cx.toFixed(1)}" y="${y + 2}" width="14" height="1.6" rx=".5" fill="${C.hi}" opacity=".8"/>`
      s += rows(cx, y + 5, 20, 3, 1, 1.3, C.block)
    }
    return s
  },
  'back-to-top': (r, C) => {
    const [x, y, w, h] = r
    return rows(x + 6, y + 3, w - 40, 4, 1, 1.4, C.block, .6)
      + `<circle cx="${x + w - 12}" cy="${y + h / 2}" r="3.2" fill="${C.hi}">${anim('opacity', ['0', '1', '1'], [0, .3, 1])}</circle>`
      + `<path d="M${x + w - 12} ${y + h / 2 + 1.4} l0 -2.8 M${x + w - 13.2} ${y + h / 2 - 1.6} l1.2 -1.2 l1.2 1.2" fill="none" stroke="${C.bg}" stroke-width="__SW__"/>`
  },
  'footer-groups': (r, C) => {
    const [x, y, w] = r
    let s = ''
    for (let c = 0; c < 3; c++) {
      const cx = x + 8 + c * 34
      s += `<rect x="${cx}" y="${y + 2}" width="24" height="1.8" rx=".6" fill="${C.hi}" opacity=".75"/>`
      s += `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.15 + c * .12, .35 + c * .12, 1])}${rows(cx, y + 5.5, 22, 3, .8, 1.2, C.block)}</g>`
      s += `<path d="M${cx + 27} ${y + 2.4} l1.4 1.4 l-1.4 1.4" fill="none" stroke="${C.dim}" stroke-width="__SW__"/>`
    }
    return s
  },
  'sticky-footer': (r, C) => {
    const [x, y, w, h] = r
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${C.block}"/>`
      + `<rect x="${x + 6}" y="${y + h / 2 - .8}" width="60" height="1.6" rx=".5" fill="${C.dim}" opacity=".7"/>`
      + `<rect x="${x + w - 40}" y="${y + h / 2 - .8}" width="34" height="1.6" rx=".5" fill="${C.hi}" opacity=".7"/>`
      + `<path d="M${x + 2} ${y - 1} L${x + w - 2} ${y - 1}" stroke="${C.hi}" stroke-width="__SW__" opacity=".9"/>`
  },
  'footer-subscribe': (r, C) => {
    const [x, y, w, h] = r
    const bx = x + w - 62
    return rows(x + 6, y + 3, 40, 3, 1.4, 1.4, C.block, .55)
      + `<rect x="${bx}" y="${y + 3.5}" width="38" height="5" rx="1" fill="none" stroke="${C.line}" stroke-width="__SW__"/>`
      + `<rect x="${bx + 2}" y="${y + 5.4}" width="0" height="1.4" rx=".5" fill="${C.dim}">${anim('width', ['0', '22', '22'], [.1, .45, 1])}</rect>`
      + `<rect x="${bx + 41}" y="${y + 3.5}" width="16" height="5" rx="1" fill="${C.hi}" opacity=".85"/>`
  },
  'sitemap-footer': (r, C) => {
    const [x, y, w] = r
    let s = ''
    for (let c = 0; c < 5; c++) {
      const cx = x + 6 + c * (w - 12) / 5
      s += `<rect x="${cx.toFixed(1)}" y="${y + 2}" width="12" height="1.6" rx=".5" fill="${C.hi}" opacity=".7"/>`
      s += rows(cx, y + 5, 18, 4, .7, 1, C.block, .8)
    }
    return s
  },

  // ── 表格（桌面）────────────────────────────────────────────────────────
  'sticky-table-header': (r, C) => {
    const [x, y, w, h] = r
    return `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,-22;0,-22" keyTimes="0;0.34;0.8;1" dur="${D}" repeatCount="indefinite"/>`
      + rows(x + 4, y + 10, w - 8, 12, 1.4, 3, C.block) + '</g>'
      + `<rect x="${x}" y="${y}" width="${w}" height="8" fill="${C.bg}"/>`
      + `<rect x="${x + 4}" y="${y + 2}" width="${w - 8}" height="5" rx=".8" fill="${C.hi}" opacity=".8"/>`
      + `<path d="M${x} ${y + 8.4} L${x + w} ${y + 8.4}" stroke="${C.hi}" stroke-width="__SW__" opacity=".5"/>`
  },
  'frozen-columns': (r, C) => {
    const [x, y, w, h] = r
    // **列数和行数是按体积算的，不是随便选的**：sanitizeSvg 对超过 8000 字符的
    // svg 是**整个丢掉且不报错**，6×9 那版生成出来 7672 字符，离上限太近。
    let cols = ''
    for (let c = 0; c < 4; c++) cols += rows(x + 34 + c * 34, y + 3, 28, 7, 2.6, 3.6, C.block)
    return `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;-46,0;-46,0" keyTimes="0;0.34;0.82;1" dur="${D}" repeatCount="indefinite"/>${cols}</g>`
      + `<rect x="${x}" y="${y}" width="32" height="${h}" fill="${C.bg}"/>`
      + rows(x + 3, y + 3, 26, 7, 2.6, 3.6, C.hi, .8)
      + `<path d="M${x + 32.4} ${y} L${x + 32.4} ${y + h}" stroke="${C.hi}" stroke-width="__SW__" opacity=".5"/>`
  },
  'table-sort': (r, C) => {
    const [x, y, w] = r
    const bars = [5, 9, 3, 12, 7]
    const sorted = [...bars].sort((a, b) => b - a)
    const vals = (i) => [`${x + 20}`, `${x + 20}`, `${x + 20}`]
    let s = `<rect x="${x + 4}" y="${y + 2}" width="${w - 8}" height="5" rx=".8" fill="${C.block}"/>`
      + `<rect x="${x + 6}" y="${y + 3.4}" width="14" height="2.2" rx=".5" fill="${C.hi}"/>`
      + `<path d="M${x + 23} ${y + 5.4} l1.4 -1.8 l1.4 1.8" fill="none" stroke="${C.hi}" stroke-width="__SW__"/>`
    bars.forEach((bv, i) => {
      const from = y + 10 + i * 5.6
      const to = y + 10 + sorted.indexOf(bv) * 5.6
      s += `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,${(to - from).toFixed(1)};0,${(to - from).toFixed(1)}" keyTimes="0;0.45;0.72;1" dur="${D}" repeatCount="indefinite"/>`
        + `<rect x="${x + 6}" y="${from}" width="${bv * 8}" height="3.6" rx=".6" fill="${C.block}"/></g>`
    })
    return s
  },
  'column-resize': (r, C) => {
    const [x, y, w, h] = r
    return rows(x + 4, y + 3, 40, 10, 2, 3.4, C.block)
      + `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;22,0;22,0;0,0" keyTimes="0;0.4;0.62;0.8;1" dur="${D}" repeatCount="indefinite"/>`
      + `<path d="M${x + 48} ${y} L${x + 48} ${y + h}" stroke="${C.hi}" stroke-width="__SW__" opacity=".9"/>`
      + `<rect x="${x + 46}" y="${y + h / 2 - 3}" width="4" height="6" rx="1" fill="${C.hi}"/></g>`
      + rows(x + 74, y + 3, 40, 10, 2, 3.4, C.block, .5)
  },
  'row-selection': (r, C) => {
    const [x, y, w] = r
    let s = `<rect x="${x + 4}" y="${y + 2}" width="6" height="4" rx=".8" fill="none" stroke="${C.hi}" stroke-width="__SW__"/>`
      + `<rect x="${x + 5.4}" y="${y + 3.6}" width="3.2" height="1" rx=".4" fill="${C.hi}">${anim('opacity', ['0', '1', '1'], [.25, .35, 1])}</rect>`
    for (let i = 0; i < 6; i++) {
      const ry = y + 10 + i * 6
      s += `<rect x="${x + 4}" y="${ry}" width="6" height="4" rx=".8" fill="none" stroke="${C.line}" stroke-width="__SW__"/>`
        + `<rect x="${x + 4.8}" y="${ry + .8}" width="4.4" height="2.4" rx=".5" fill="${C.hi}" opacity="0">${anim('opacity', ['0', '1', '1'], [.05 + i * .04, .2 + i * .04, 1])}</rect>`
        + `<rect x="${x + 14}" y="${ry + .6}" width="${60 + (i % 3) * 22}" height="2.8" rx=".6" fill="${C.block}"/>`
    }
    s += `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.4, .55, 1])}<rect x="${x + 4}" y="${y + 48}" width="${w - 8}" height="8" rx="1.2" fill="${C.block}"/>`
      + `<rect x="${x + 8}" y="${y + 51}" width="26" height="2" rx=".6" fill="${C.hi}"/></g>`
    return s
  },
  'table-density': (r, C) => {
    const [x, y, w] = r
    let s = ''
    for (let i = 0; i < 8; i++) {
      s += `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,${(-i * 2.6).toFixed(1)};0,${(-i * 2.6).toFixed(1)}" keyTimes="0;0.42;0.7;1" dur="${D}" repeatCount="indefinite"/>`
        + `<rect x="${x + 4}" y="${y + 4 + i * 6.4}" width="${w - 8}" height="3.4" rx=".6" fill="${C.block}"/></g>`
    }
    return s + `<rect x="${x + w - 24}" y="${y - 6}" width="20" height="4.6" rx="1.2" fill="${C.block}"/>`
      + `<rect x="${x + w - 16}" y="${y - 5.4}" width="6" height="3.4" rx="1" fill="${C.hi}">${anim('x', [`${x + w - 23}`, `${x + w - 10}`, `${x + w - 10}`], [.2, .5, 1])}</rect>`
  },
  'responsive-table': (r, C) => {
    const [x, y, w, h] = r
    let s = ''
    for (let i = 0; i < 4; i++) {
      s += `<g><animateTransform attributeName="transform" type="scale" values="1,1;1,1;.34,1.9;.34,1.9" keyTimes="0;0.4;0.72;1" dur="${D}" repeatCount="indefinite" additive="sum"/>`
        + rows(x + 6, y + 4 + i * 12, w - 12, 1, 0, 8, C.block) + '</g>'
    }
    return `<g transform="translate(${x + 6},${y + 4})"><g transform="translate(${-x - 6},${-y - 4})">${s}</g></g>`
  },
  'cell-truncate': (r, C) => {
    const [x, y, w] = r
    return rows(x + 4, y + 4, 52, 5, 2.4, 3.4, C.block)
      + `<rect x="${x + 60}" y="${y + 4}" width="46" height="3.4" rx=".6" fill="${C.block}"/>`
      + `<rect x="${x + 106}" y="${y + 4.6}" width="4" height="2.2" rx=".5" fill="${C.dim}"/>`
      + `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.3, .45, 1])}`
      + `<rect x="${x + 60}" y="${y + 10}" width="94" height="10" rx="1.2" fill="${C.block2}" stroke="${C.hi}" stroke-width="__SW__"/>`
      + rows(x + 63, y + 12.4, 88, 2, 1.4, 2.4, C.dim, .8) + '</g>'
      + rows(x + 60, y + 24, 46, 3, 2.4, 3.4, C.block, .5)
  },

  // ── 侧边栏（桌面）──────────────────────────────────────────────────────
  'collapsible-sidebar': (r, C) => {
    const [x, y, w, h] = r
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${C.block2}">${anim('width', [`${w}`, `${w * .3}`, `${w * .3}`], [.15, .5, 1])}</rect>`
      + Array.from({ length: 6 }, (_, i) =>
        `<rect x="${x + 3}" y="${y + 5 + i * 12}" width="4" height="4" rx=".8" fill="${C.hi}" opacity=".8"/>`
        + `<rect x="${x + 9}" y="${y + 6}" width="24" height="2.4" rx=".6" fill="${C.block}" transform="translate(0,${i * 12})">${anim('opacity', ['1', '0', '0'], [.15, .45, 1])}</rect>`).join('')
  },
  'sidebar-icon-mode': (r, C) => {
    const [x, y, h] = [r[0], r[1], r[3]]
    let s = `<rect x="${x}" y="${y}" width="12" height="${h}" rx="1" fill="${C.block2}"/>`
    for (let i = 0; i < 6; i++) {
      const iy = y + 5 + i * 12
      s += `<rect x="${x + 4}" y="${iy}" width="4.6" height="4.6" rx="1" fill="${i === 2 ? C.hi : C.block}" opacity="${i === 2 ? 1 : .8}"/>`
      if (i === 2) s += `<rect x="${x + 1}" y="${iy - .6}" width="1.4" height="5.8" rx=".6" fill="${C.hi}"/>`
    }
    s += `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.25, .4, 1])}`
      + `<rect x="${x + 15}" y="${y + 27}" width="26" height="7" rx="1.2" fill="${C.block2}" stroke="${C.line}" stroke-width="__SW__"/>`
      + `<rect x="${x + 18}" y="${y + 29.6}" width="18" height="2" rx=".6" fill="${C.dim}"/></g>`
    return s
  },
  'sidebar-resize': (r, C) => {
    const [x, y, w, h] = r
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${C.block2}">${anim('width', [`${w}`, `${w * 1.5}`, `${w * 1.5}`], [.2, .55, 1])}</rect>`
      + Array.from({ length: 5 }, (_, i) => `<rect x="${x + 4}" y="${y + 6 + i * 13}" width="22" height="2.6" rx=".6" fill="${C.block}"/>`).join('')
      + `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;${(w * .5).toFixed(1)},0;${(w * .5).toFixed(1)},0" keyTimes="0;0.4;0.62;1" dur="${D}" repeatCount="indefinite"/>`
      + `<path d="M${x + w} ${y} L${x + w} ${y + h}" stroke="${C.hi}" stroke-width="__SW__"/>`
      + `<rect x="${x + w - 1.6}" y="${y + h / 2 - 4}" width="3.2" height="8" rx="1.2" fill="${C.hi}"/></g>`
  },
  'nested-nav': (r, C) => {
    const [x, y, w] = r
    let s = ''
    for (let i = 0; i < 3; i++) s += `<rect x="${x + 4}" y="${y + 5 + i * 9}" width="26" height="2.8" rx=".6" fill="${C.block}"/>`
    s += `<path d="M${x + 32} ${y + 14.4} l1.4 1.4 l-1.4 1.4" fill="none" stroke="${C.hi}" stroke-width="__SW__"/>`
    s += `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.2, .4, 1])}`
    for (let i = 0; i < 3; i++) s += `<rect x="${x + 9}" y="${y + 33 + i * 7}" width="21" height="2.4" rx=".6" fill="${C.block}" opacity=".8"/>`
    s += `<rect x="${x + 6.4}" y="${y + 39.6}" width="1.2" height="3" rx=".6" fill="${C.hi}"/></g>`
    return s
  },
  'active-nav-indicator': (r, C) => {
    const [x, y] = r
    let s = ''
    for (let i = 0; i < 5; i++) s += `<rect x="${x + 5}" y="${y + 6 + i * 14}" width="26" height="2.8" rx=".6" fill="${C.block}"/>`
    return s + `<rect x="${x + 2}" y="${y + 5}" width="1.6" height="5" rx=".8" fill="${C.hi}">`
      + `<animate attributeName="y" ${seg([`${y + 5}`, `${y + 19}`, `${y + 33}`, `${y + 47}`, `${y + 47}`], [0, .3, .6, .85, 1])} dur="${D}" repeatCount="indefinite"/></rect>`
  },
  'sidebar-to-drawer': (r, C) => {
    const [x, y, w, h] = r
    return `<rect x="${x}" y="${y}" width="${w * 2.4}" height="${h}" fill="#000" opacity="0">${anim('opacity', ['0', '.45', '.45'], [.25, .45, 1])}</rect>`
      + `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;${(-w).toFixed(0)},0;${(-w).toFixed(0)},0;0,0" keyTimes="0;0.34;0.45;0.7;1" dur="${D}" repeatCount="indefinite"/>`
      + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${C.block2}" stroke="${C.hi}" stroke-width="__SW__"/>`
      + Array.from({ length: 5 }, (_, i) => `<rect x="${x + 4}" y="${y + 6 + i * 13}" width="22" height="2.6" rx=".6" fill="${C.block}"/>`).join('') + '</g>'
  },

  // ── 标签栏（移动）──────────────────────────────────────────────────────
  'bottom-tab-bar': (r, C) => {
    const [x, y, w, h] = r
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.block2}"/>`
    for (let i = 0; i < 4; i++) {
      const cx = x + w * (i + .5) / 4
      s += `<rect x="${(cx - 2).toFixed(1)}" y="${y + 2.5}" width="4" height="4" rx="1" fill="${i === 0 ? C.hi : C.block}"/>`
        + `<rect x="${(cx - 3).toFixed(1)}" y="${y + 8}" width="6" height="1.4" rx=".5" fill="${i === 0 ? C.hi : C.block}" opacity=".8"/>`
    }
    return s + `<path d="M${x} ${y + h - 1.4} L${x + w} ${y + h - 1.4}" stroke="${C.hi}" stroke-width="__SW__" opacity=".35" stroke-dasharray="2 2"/>`
  },
  'tab-badge': (r, C) => {
    const [x, y, w, h] = r
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.block2}"/>`
    for (let i = 0; i < 4; i++) {
      const cx = x + w * (i + .5) / 4
      s += `<rect x="${(cx - 2).toFixed(1)}" y="${y + 3}" width="4" height="4" rx="1" fill="${C.block}"/>`
      if (i === 1) s += `<circle cx="${(cx + 2.4).toFixed(1)}" cy="${y + 2.8}" r="1.5" fill="${C.hi}" opacity="0">`
        + `<animate attributeName="opacity" ${seg(['0', '1', '1'], [.2, .35, 1])} dur="${D}" repeatCount="indefinite"/>`
        + `<animate attributeName="r" ${seg(['0', '2', '1.5'], [.2, .3, .42])} dur="${D}" repeatCount="indefinite"/></circle>`
    }
    return s
  },
  'auto-hide-bar': (r, C) => {
    const [x, y, w, h] = r
    return `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,${h};0,${h};0,0" keyTimes="0;0.4;0.58;0.76;1" dur="${D}" repeatCount="indefinite"/>`
      + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.block2}"/>`
      + Array.from({ length: 4 }, (_, i) => `<rect x="${(x + w * (i + .5) / 4 - 2).toFixed(1)}" y="${y + 4}" width="4" height="4" rx="1" fill="${i === 0 ? C.hi : C.block}"/>`).join('')
      + '</g>'
      + `<path d="M${x + w / 2} ${y - 8} l0 6 M${x + w / 2 - 2} ${y - 4} l2 2 l2 -2" fill="none" stroke="${C.hi}" stroke-width="__SW__" opacity=".7"/>`
  },
  'center-fab': (r, C) => {
    const [x, y, w, h] = r
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.block2}"/>`
    for (const i of [0, 1, 3, 4]) {
      const cx = x + w * (i + .5) / 5
      s += `<rect x="${(cx - 1.8).toFixed(1)}" y="${y + 4}" width="3.6" height="3.6" rx=".9" fill="${C.block}"/>`
    }
    const cx = x + w / 2
    return s + `<circle cx="${cx}" cy="${y + 2}" r="4.4" fill="${C.hi}"><animate attributeName="r" ${seg(['4.4', '4.9', '4.4'], [.15, .3, .5])} dur="${D}" repeatCount="indefinite"/></circle>`
      + `<path d="M${cx - 1.8} ${y + 2} h3.6 M${cx} ${y + .2} v3.6" stroke="${C.bg}" stroke-width="__SW__"/>`
  },
  'tab-switch-transition': (r, C) => {
    const [x, y, w, h] = r
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.block2}"/>`
      + Array.from({ length: 3 }, (_, i) => `<rect x="${(x + w * (i + .5) / 3 - 3).toFixed(1)}" y="${y + 4}" width="6" height="1.6" rx=".5" fill="${C.block}"/>`).join('')
      + `<rect x="${x + w / 6 - 4}" y="${y + h - 2}" width="8" height="1.4" rx=".7" fill="${C.hi}">`
      + `<animate attributeName="x" ${seg([`${x + w / 6 - 4}`, `${x + w / 2 - 4}`, `${x + w * 5 / 6 - 4}`, `${x + w * 5 / 6 - 4}`], [0, .35, .7, 1])} dur="${D}" repeatCount="indefinite"/></rect>`
      + `<g opacity=".55"><animateTransform attributeName="transform" type="translate" values="0,0;0,0;-14,0;-28,0;-28,0" keyTimes="0;0.34;0.55;0.8;1" dur="${D}" repeatCount="indefinite"/>`
      + Array.from({ length: 3 }, (_, i) => `<rect x="${x + 4 + i * 14}" y="${y - 16}" width="10" height="12" rx="1" fill="${C.block}"/>`).join('') + '</g>'
  },

  // ── 金刚区（移动）──────────────────────────────────────────────────────
  'entry-grid': (r, C) => {
    const [x, y] = r
    return grid(x + 3, y + 2, 4, 2, 8, 5, 3.7, 3, C.block)
      + grid(x + 3, y + 2, 4, 2, 8, 5, 3.7, 3, C.hi, .18)
      + `<path d="M${x + 3} ${y + 1} L${x + 47} ${y + 1}" stroke="${C.hi}" stroke-width="__SW__" opacity=".5" stroke-dasharray="1.5 1.5"/>`
  },
  'grid-paging': (r, C) => {
    const [x, y, w, h] = r
    return `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,0;${-w},0;${-w},0" keyTimes="0;0.42;0.68;1" dur="${D}" repeatCount="indefinite"/>`
      + grid(x + 3, y + 2, 4, 2, 8, 5, 3.7, 3, C.block)
      + grid(x + w + 3, y + 2, 4, 2, 8, 5, 3.7, 3, C.block, .7) + '</g>'
      + `<circle cx="${x + w / 2 - 2.5}" cy="${y + h - 1}" r="1" fill="${C.hi}"><animate attributeName="opacity" ${seg(['1', '.3', '.3'], [.45, .68, 1])} dur="${D}" repeatCount="indefinite"/></circle>`
      + `<circle cx="${x + w / 2 + 2.5}" cy="${y + h - 1}" r="1" fill="${C.hi}" opacity=".3"><animate attributeName="opacity" ${seg(['.3', '1', '1'], [.45, .68, 1])} dur="${D}" repeatCount="indefinite"/></circle>`
  },
  'grid-edit-sort': (r, C) => {
    const [x, y] = r
    let s = ''
    for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) {
      const gx = x + 3 + i * 11.7, gy = y + 2 + j * 8
      s += `<g><animateTransform attributeName="transform" type="rotate" values="0 ${gx + 4} ${gy + 2.5};0 ${gx + 4} ${gy + 2.5};-2.2 ${gx + 4} ${gy + 2.5};2.2 ${gx + 4} ${gy + 2.5};-2.2 ${gx + 4} ${gy + 2.5}" keyTimes="0;0.4;${(0.45 + i * 0.02).toFixed(2)};${(0.6 + i * 0.02).toFixed(2)};1" dur="${D}" repeatCount="indefinite"/>`
        + `<rect x="${gx.toFixed(1)}" y="${gy}" width="8" height="5" rx=".8" fill="${C.block}"/>`
        + `<circle cx="${(gx + 8).toFixed(1)}" cy="${gy}" r="1.4" fill="${C.hi}" opacity="0"><animate attributeName="opacity" ${seg(['0', '1', '1'], [.4, .5, 1])} dur="${D}" repeatCount="indefinite"/></circle></g>`
    }
    return s
  },
  'more-entry': (r, C) => {
    const [x, y] = r
    return grid(x + 3, y + 2, 4, 1, 8, 5, 3.7, 3, C.block)
      + `<rect x="${x + 38.1}" y="${y + 2}" width="8" height="5" rx=".8" fill="none" stroke="${C.hi}" stroke-width="__SW__"/>`
      + `<circle cx="${x + 40}" cy="${y + 4.5}" r=".55" fill="${C.hi}"/><circle cx="${x + 42.1}" cy="${y + 4.5}" r=".55" fill="${C.hi}"/><circle cx="${x + 44.2}" cy="${y + 4.5}" r=".55" fill="${C.hi}"/>`
      + `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.2, .45, 1])}${grid(x + 3, y + 10, 4, 1, 8, 5, 3.7, 3, C.block, .85)}</g>`
  },
  'icon-micro-motion': (r, C) => {
    const [x, y] = r
    let s = grid(x + 3, y + 2, 4, 2, 8, 5, 3.7, 3, C.block)
    const gx = x + 3, gy = y + 2
    s += `<g><animateTransform attributeName="transform" type="scale" values="1;1;.9;1.06;1;1" keyTimes="0;0.36;0.44;0.54;0.66;1" dur="${D}" repeatCount="indefinite" additive="sum"/>`
      + `<rect x="0" y="0" width="8" height="5" rx=".8" fill="${C.hi}" transform="translate(${gx},${gy})"/></g>`
    return s
  },

  // ── 导航栏（桌面）──────────────────────────────────────────────────────
  'mega-menu': (r, C) => {
    const [x, y, w, h] = r
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${C.block2}"/>`
    for (let i = 0; i < 4; i++) s += `<rect x="${x + 8 + i * 22}" y="${y + 4.6}" width="16" height="2.6" rx=".6" fill="${i === 1 ? C.hi : C.block}"/>`
    s += `<g opacity="0">${anim('opacity', ['0', '1', '1'], [.15, .32, 1])}`
      + `<rect x="${x + 24}" y="${y + h + 1}" width="120" height="34" rx="1.5" fill="${C.block2}" stroke="${C.line}" stroke-width="__SW__"/>`
    for (let c = 0; c < 3; c++) {
      s += `<rect x="${x + 30 + c * 38}" y="${y + h + 5}" width="16" height="2" rx=".6" fill="${C.hi}" opacity=".8"/>`
      s += rows(x + 30 + c * 38, y + h + 10, 28, 4, 1.6, 2, C.block)
    }
    return s + '</g>'
  },
  'breadcrumb': (r, C) => {
    const [x, y, h] = [r[0], r[1], r[3]]
    let s = ''
    const wds = [14, 20, 26]
    let cx = x + 8
    wds.forEach((wd, i) => {
      s += `<rect x="${cx}" y="${y + 4.6}" width="${wd}" height="2.6" rx=".6" fill="${i === 2 ? C.hi : C.block}" opacity="${i === 2 ? .9 : .8}"/>`
      cx += wd
      if (i < 2) { s += `<path d="M${cx + 2} ${y + 4.2} l1.6 1.7 l-1.6 1.7" fill="none" stroke="${C.dim}" stroke-width="__SW__"/>`; cx += 7 }
    })
    return s
  },
  'nav-search-expand': (r, C) => {
    const [x, y, w, h] = r
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${C.block2}"/>`
    for (let i = 0; i < 3; i++) s += `<rect x="${x + 8 + i * 20}" y="${y + 4.6}" width="14" height="2.6" rx=".6" fill="${C.block}"/>`
    return s + `<rect x="${x + w - 14}" y="${y + 3}" width="8" height="6" rx="3" fill="none" stroke="${C.hi}" stroke-width="__SW__">`
      + `<animate attributeName="width" ${seg(['8', '70', '70'], [.15, .45, 1])} dur="${D}" repeatCount="indefinite"/>`
      + `<animate attributeName="x" ${seg([`${x + w - 14}`, `${x + w - 76}`, `${x + w - 76}`], [.15, .45, 1])} dur="${D}" repeatCount="indefinite"/></rect>`
      + `<circle cx="${x + w - 10}" cy="${y + 6}" r="1.8" fill="none" stroke="${C.hi}" stroke-width="__SW__"/>`
  },
  'nav-shrink-on-scroll': (r, C) => {
    const [x, y, w, h] = r
    return `<rect x="${x}" y="${y}" width="${w}" height="${h * 1.6}" rx="1" fill="${C.block2}">`
      + `<animate attributeName="height" ${seg([`${h * 1.6}`, `${h * .8}`, `${h * .8}`], [.15, .45, 1])} dur="${D}" repeatCount="indefinite"/></rect>`
      + `<rect x="${x + 8}" y="${y + 5}" width="20" height="5" rx="1" fill="${C.hi}">`
      + `<animate attributeName="height" ${seg(['5', '3', '3'], [.15, .45, 1])} dur="${D}" repeatCount="indefinite"/>`
      + `<animate attributeName="y" ${seg([`${y + 5}`, `${y + 2.6}`, `${y + 2.6}`], [.15, .45, 1])} dur="${D}" repeatCount="indefinite"/></rect>`
      + `<path d="M${x} ${y + h * 1.6} L${x + w} ${y + h * 1.6}" stroke="${C.hi}" stroke-width="__SW__" opacity="0">`
      + `<animate attributeName="opacity" ${seg(['0', '.6', '.6'], [.2, .45, 1])} dur="${D}" repeatCount="indefinite"/>`
      + `<animate attributeName="d" ${seg([`M${x} ${y + h * 1.6} L${x + w} ${y + h * 1.6}`, `M${x} ${y + h * .8} L${x + w} ${y + h * .8}`, `M${x} ${y + h * .8} L${x + w} ${y + h * .8}`], [.15, .45, 1])} dur="${D}" repeatCount="indefinite"/></path>`
  }
}

/** 每条词条画在哪个端的哪一块。
 *  第三项是**可选的镜头框** —— 不给就用区块（或区块级的 CAM）。
 *  给的原因永远是同一个：这条演示画在区块的某一端，默认的框会框空。 */
export const PLACE = {
  'mega-footer': ['桌面', '页脚', [14, 94, 110, 22]], 'back-to-top': ['桌面', '页脚', [140, 92, 100, 24]], 'footer-groups': ['桌面', '页脚', [14, 94, 100, 24]],
  'sticky-footer': ['桌面', '页脚', [50, 90, 110, 26]], 'footer-subscribe': ['桌面', '页脚', [130, 92, 110, 24]], 'sitemap-footer': ['桌面', '页脚', [14, 94, 110, 22]],
  'sticky-table-header': ['桌面', '表格'], 'frozen-columns': ['桌面', '表格'], 'table-sort': ['桌面', '表格'],
  'column-resize': ['桌面', '表格'], 'row-selection': ['桌面', '表格'], 'table-density': ['桌面', '表格'],
  'responsive-table': ['桌面', '表格'], 'cell-truncate': ['桌面', '表格'],
  'collapsible-sidebar': ['桌面', '侧边栏'], 'sidebar-icon-mode': ['桌面', '侧边栏'], 'sidebar-resize': ['桌面', '侧边栏'],
  'nested-nav': ['桌面', '侧边栏'], 'active-nav-indicator': ['桌面', '侧边栏'], 'sidebar-to-drawer': ['桌面', '侧边栏'],
  'bottom-tab-bar': ['移动', '标签栏'], 'tab-badge': ['移动', '标签栏'], 'auto-hide-bar': ['移动', '标签栏'],
  'center-fab': ['移动', '标签栏'], 'tab-switch-transition': ['移动', '标签栏'],
  'entry-grid': ['移动', '金刚区'], 'grid-paging': ['移动', '金刚区'], 'grid-edit-sort': ['移动', '金刚区'],
  'more-entry': ['移动', '金刚区'], 'icon-micro-motion': ['移动', '金刚区'],
  'mega-menu': ['桌面', '导航栏', [34, 10, 120, 52]], 'breadcrumb': ['桌面', '导航栏', [14, 8, 90, 22]], 'nav-search-expand': ['桌面', '导航栏', [136, 8, 96, 22]],
  'nav-shrink-on-scroll': ['桌面', '导航栏', [14, 6, 96, 26]]
}
