// HTML 网页预览器：用 <iframe sandbox> 承载（严禁 BrowserView/WebContentsView——
// 那是原生叠加层，不受 CSS transform 控制，无法跟随画布缩放平移）。
// 用途：预览 docs 里的 HTML 报告（file://）+ 嵌 dev server（localhost）实时预览。

import { useState } from 'react'
import { GlobeIcon, RefreshIcon } from '../../ui/Icons'
import './web.css'

export function WebView({ url }: { url: string | null }): JSX.Element {
  const [nonce, setNonce] = useState(0)

  if (!url) {
    return <div className="pane-placeholder">拖 .html 进来，或此节点暂无地址</div>
  }

  return (
    <div className="web-view">
      <div className="web-bar">
        <GlobeIcon size={12} />
        <span className="web-url" title={url}>
          {url}
        </span>
        <button className="web-reload" title="刷新" onClick={() => setNonce((n) => n + 1)}>
          <RefreshIcon size={12} />
        </button>
      </div>
      <iframe
        key={nonce}
        className="web-frame"
        src={url}
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
      />
    </div>
  )
}
