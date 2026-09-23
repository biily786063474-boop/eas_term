import {useState} from 'react'
// 插件图标：已知品牌用真实品牌 logo（内联 SVG），其余用品牌色字母头像兜底。
// 用户要求「有真实品牌 logo 就用人家的」（2026-09-15）。SVG 是可信静态串，dangerouslySetInnerHTML 安全。
// 品牌 logo 按插件名匹配（github / figma / 高德 / 知乎 …）；名字里含关键词就命中。

const LOGOS: Record<string, string> = {
  github:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#1b1f23"/><path fill="#fff" d="M20 9c-6 0-11 5-11 11 0 4.9 3.2 9 7.6 10.5.6.1.8-.2.8-.5v-1.9c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.7-1.2-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.2-5.1-5.5 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1.9-.2 1.8-.4 2.8-.4s1.9.1 2.8.4c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.8 1.1 3 0 4.3-2.6 5.2-5.1 5.5.4.3.8 1 .8 2.1v3.1c0 .3.2.6.8.5C27.8 29 31 24.9 31 20c0-6-5-11-11-11z"/></svg>',
  figma:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#f7f7f8"/><path d="M20 8h-4a4 4 0 0 0 0 8h4V8z" fill="#f24e1e"/><path d="M16 16h4v8h-4a4 4 0 0 1 0-8z" fill="#a259ff"/><path d="M16 24h4v4a4 4 0 1 1-4-4z" fill="#0acf83"/><path d="M20 8h4a4 4 0 0 1 0 8h-4V8z" fill="#ff7262"/><circle cx="24" cy="20" r="4" fill="#1abcfe"/></svg>',
  notion:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#fff"/><path d="M15 26V15l10 11V15" fill="none" stroke="#111" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  slack:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#fff"/><rect x="12" y="16.7" width="16" height="2.7" rx="1.35" fill="#36C5F0"/><rect x="12" y="21.6" width="16" height="2.7" rx="1.35" fill="#2EB67D"/><rect x="16.7" y="12" width="2.7" height="16" rx="1.35" fill="#ECB22E"/><rect x="21.6" y="12" width="2.7" height="16" rx="1.35" fill="#E01E5A"/></svg>',
  gmail:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#fff"/><path fill="#4285f4" d="M10 28V15l10 7.5"/><path fill="#34a853" d="M30 28V15L20 22.5"/><path fill="#ea4335" d="M20 22.5L10 15v-1.5a2 2 0 0 1 3.2-1.6L20 17l6.8-5.1a2 2 0 0 1 3.2 1.6V15z"/></svg>',
  word:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#2b579a"/><rect x="8.5" y="9" width="23" height="22" rx="2.5" fill="#fff"/><path d="M13 15l2.2 11 2.3-8 2.3 8 2.2-11" fill="none" stroke="#2b579a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  excel:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#217346"/><rect x="8.5" y="9" width="23" height="22" rx="2.5" fill="#fff"/><path d="M14 15l6 10M20 15l-6 10" stroke="#217346" stroke-width="1.9" stroke-linecap="round"/></svg>',
  ppt:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#c43e1c"/><rect x="8.5" y="9" width="23" height="22" rx="2.5" fill="#fff"/><path d="M15 25V15h4a3.2 3.2 0 0 1 0 6.4h-4" fill="none" stroke="#c43e1c" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  amap:
    '<svg viewBox="0 0 40 40"><defs><linearGradient id="pl-am" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#41c4ff"/><stop offset="1" stop-color="#0072ff"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#pl-am)"/><path fill="#fff" d="M20 10a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6zm0 8.4a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8z"/></svg>',
  zhihu:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0084ff"/><text x="20" y="27" font-size="16" font-weight="700" fill="#fff" text-anchor="middle" font-family="PingFang SC,sans-serif">知</text></svg>',
  wechatmp:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#07c160"/><ellipse cx="17" cy="18" rx="7" ry="6" fill="#fff"/><ellipse cx="25.5" cy="24" rx="5.5" ry="4.8" fill="#fff"/><circle cx="14.6" cy="17.4" r="1" fill="#07c160"/><circle cx="19.4" cy="17.4" r="1" fill="#07c160"/><circle cx="23.6" cy="23.6" r=".85" fill="#07c160"/><circle cx="27.4" cy="23.6" r=".85" fill="#07c160"/></svg>',
  weibo:
    '<svg viewBox="0 0 40 40"><defs><linearGradient id="pl-wb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a2e"/><stop offset="1" stop-color="#e6162d"/></linearGradient></defs><rect width="40" height="40" rx="9" fill="url(#pl-wb)"/><ellipse cx="20" cy="20.5" rx="9.5" ry="7.2" fill="#fff"/><circle cx="20" cy="20.5" r="3.6" fill="#e6162d"/><circle cx="18.6" cy="19.2" r="1.1" fill="#fff"/></svg>',
  bilibili:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#fb7299"/><path d="M15.5 12.5l-2.2-2.2M24.5 12.5l2.2-2.2" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><rect x="10.5" y="14" width="19" height="13.5" rx="4" fill="#fff"/><circle cx="16.2" cy="21" r="1.4" fill="#fb7299"/><circle cx="23.8" cy="21" r="1.4" fill="#fb7299"/></svg>',
  douyin:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#010101"/><path d="M21 10v12a4 4 0 1 1-3.2-3.92V15.1c1.3 1.6 3.2 2.4 5.2 2.4v-3.1c-1.1 0-2-.9-2-2.1z" fill="#25f4ee" transform="translate(-1.1,-1)"/><path d="M21 10v12a4 4 0 1 1-3.2-3.92V15.1c1.3 1.6 3.2 2.4 5.2 2.4v-3.1c-1.1 0-2-.9-2-2.1z" fill="#fe2c55" transform="translate(1.1,1)"/><path d="M21 10v12a4 4 0 1 1-3.2-3.92V15.1c1.3 1.6 3.2 2.4 5.2 2.4v-3.1c-1.1 0-2-.9-2-2.1z" fill="#fff"/></svg>',
  xhs:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#ff2442"/><path d="M20 14.5c-2.2-1.6-5.2-1.6-7.5 0v11c2.3-1.6 5.3-1.6 7.5 0 2.2-1.6 5.2-1.6 7.5 0v-11c-2.3-1.6-5.3-1.6-7.5 0z" fill="#fff"/><path d="M20 14.5v11" stroke="#ff2442" stroke-width="1.3"/></svg>'
}

/** 插件名 → 品牌 logo key。命中关键词即用；否则 null（走字母头像）。 */
function logoKeyFor(name: string): string | null {
  const n = name.toLowerCase()
  const has = (...ks: string[]): boolean => ks.some((k) => n.includes(k))
  if (has('github')) return 'github'
  if (has('figma')) return 'figma'
  if (has('notion')) return 'notion'
  if (has('slack')) return 'slack'
  if (has('gmail')) return 'gmail'
  if (has('word')) return 'word'
  if (has('excel')) return 'excel'
  if (has('powerpoint', 'ppt')) return 'ppt'
  if (has('高德', 'amap')) return 'amap'
  if (has('知乎', 'zhihu')) return 'zhihu'
  if (has('微信公众号', '公众号')) return 'wechatmp'
  if (has('微博', 'weibo')) return 'weibo'
  if (has('b站', 'bilibili', '哔哩')) return 'bilibili'
  if (has('抖音', 'douyin')) return 'douyin'
  if (has('小红书', 'xiaohongshu')) return 'xhs'
  return null
}

export function PluginLogo({
  name,
  brandColor,
  size = 42,
  radius = 11,
  iconDataUrl
}: {
  name: string
  iconDataUrl?: string
  brandColor?: string
  size?: number
  radius?: number
}): JSX.Element {
  const [failed,setFailed]=useState<string|null>(null)
  if(iconDataUrl&&iconDataUrl!==failed)return <img className="pl-logo" src={iconDataUrl} alt="" style={{width:size,height:size,borderRadius:radius,objectFit:'contain'}} onError={()=>setFailed(iconDataUrl)}/>
  const key = logoKeyFor(name)
  if (key) {
    return (
      <span
        className="pl-logo"
        style={{ width: size, height: size, borderRadius: radius }}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: LOGOS[key] }}
      />
    )
  }
  const bg = brandColor ?? '#3a3f4b'
  return (
    <span
      className="pl-av"
      style={{ width: size, height: size, borderRadius: radius, background: bg + '33', color: bg }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  )
}
