import {useState} from 'react'
// 插件图标：已知品牌用真实品牌 logo（内联 SVG），其余用品牌色字母头像兜底。
// 用户要求「有真实品牌 logo 就用人家的」（2026-09-15）。SVG 是可信静态串，dangerouslySetInnerHTML 安全。
// sentry / wikipedia 图形取自 Simple Icons（CC0）；商标归各自所有者。
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
  sentry:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#362D59"/><path fill="#fff" transform="translate(7 7) scale(1.1)" d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z"/></svg>',
  wikipedia:
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#fff"/><path fill="#000" transform="translate(7 7) scale(1.1)" d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264s-.318-.654-.428-.872c-.728-1.443-.712-1.518-1.447-1.617-.207-.023-.313-.05-.313-.149v-.468l.06-.045h4.292l.113.037v.451c0 .105-.076.15-.227.15l-.308.047c-.792.061-.661.381-.136 1.422l1.582 3.252 1.758-3.504c.293-.64.233-.801.111-.947-.07-.084-.305-.22-.812-.24l-.201-.021c-.052 0-.098-.015-.145-.051-.045-.031-.067-.076-.067-.129v-.427l.061-.045c1.247-.008 4.043 0 4.043 0l.059.045v.436c0 .121-.059.178-.193.178-.646.03-.782.095-1.023.439-.12.186-.375.589-.646 1.039l-2.301 4.273-.065.135 2.792 5.712.17.048 4.396-10.438c.154-.422.129-.722-.064-.895-.197-.172-.346-.273-.857-.295l-.42-.016c-.061 0-.105-.014-.152-.045-.043-.029-.072-.075-.072-.119v-.436l.059-.045h4.961l.041.045v.437c0 .119-.074.18-.209.18-.648.03-1.127.18-1.443.421-.314.255-.557.616-.736 1.067 0 0-4.043 9.258-5.426 12.339-.525 1.007-1.053.917-1.503-.031-.571-1.171-1.773-3.786-2.646-5.71l.053-.036z"/></svg>',
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
export function logoKeyFor(name: string): string | null {
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
  if (has('sentry')) return 'sentry'
  if (has('wikipedia', '维基')) return 'wikipedia'
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
