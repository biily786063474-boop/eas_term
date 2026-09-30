// 设置 → 关于与开源致谢（2026-09-29）。
// 上半是人工挑的重点致谢（src/shared/ossCredits.ts：真正借鉴的放最前 + 语音模型的署名义务），
// 下半是构建时自动生成的完整第三方许可清单（scripts/gen-third-party-notices.mjs → out/renderer/third-party-notices.txt），
// 点开才读，不常驻内存。开发模式下没有这个文件，照实说。
// 文案在 settings 词典（settings.about.*）；致谢条目本身的中英文在 ossCredits.ts 里成对写。
import { useState } from 'react'
import { MODEL_CREDITS, OSS_CREDITS, ossText, type OssCredit } from '../../../../shared/ossCredits'
import { useLang, useT } from '../../i18n.ts'

function Credit({ c }: { c: OssCredit }): JSX.Element {
  const lang = useLang()
  return (
    <div className="cset-credit">
      <div className="cset-credit-head">
        <a
          className="cset-link"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            void window.api.shell.openExternal(c.url)
          }}
        >
          {ossText(c.name, lang)}
        </a>
        <span className="cset-credit-license">{ossText(c.license, lang)}</span>
      </div>
      <div className="cset-sub">{ossText(c.author, lang)} · {ossText(c.role, lang)}</div>
    </div>
  )
}

export function AboutPanel(): JSX.Element {
  const t = useT()
  const [notices, setNotices] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const featured = OSS_CREDITS.filter((c) => c.featured)
  const rest = OSS_CREDITS.filter((c) => !c.featured)
  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await fetch('./third-party-notices.txt')
      setNotices(r.ok ? await r.text() : t('settings.about.noticesMissing'))
    } catch {
      setNotices(t('settings.about.noticesMissing'))
    } finally {
      setLoading(false)
    }
  }
  const key = (c: OssCredit): string => ossText(c.name, 'en')
  return (
    <>
      <section className="cset-group">
        <h3>{t('settings.about.featured')}</h3>
        <div className="cset-card">
          <div className="cset-note">{t('settings.about.thanks', { version: window.api.build.version })}</div>
          {featured.map((c) => <Credit key={key(c)} c={c} />)}
        </div>
      </section>
      <section className="cset-group">
        <h3>{t('settings.about.foundation')}</h3>
        <div className="cset-card">{rest.map((c) => <Credit key={key(c)} c={c} />)}</div>
      </section>
      <section className="cset-group">
        <h3>{t('settings.about.models')}</h3>
        <div className="cset-card">
          <div className="cset-note">{t('settings.about.modelsNote')}</div>
          {MODEL_CREDITS.map((c) => <Credit key={key(c)} c={c} />)}
        </div>
      </section>
      <section className="cset-group">
        <h3>{t('settings.about.full')}</h3>
        <div className="cset-card">
          <div className="cset-note">{t('settings.about.fullNote')}</div>
          <div className="cset-actions">
            <button className="cset-btn" disabled={loading} onClick={() => void load()}>
              {loading ? t('settings.about.loading') : notices ? t('settings.about.reload') : t('settings.about.view')}
            </button>
          </div>
          {notices && <pre className="cset-pre cset-notices">{notices}</pre>}
        </div>
      </section>
    </>
  )
}
