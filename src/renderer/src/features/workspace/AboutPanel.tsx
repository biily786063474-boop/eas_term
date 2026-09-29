// 设置 → 关于与开源致谢（2026-09-29）。
// 上半是人工挑的重点致谢（src/shared/ossCredits.ts：真正借鉴的放最前 + 语音模型的署名义务），
// 下半是构建时自动生成的完整第三方许可清单（scripts/gen-third-party-notices.mjs → out/renderer/third-party-notices.txt），
// 点开才读，不常驻内存。开发模式下没有这个文件，照实说。
import { useState } from 'react'
import { MODEL_CREDITS, OSS_CREDITS, type OssCredit } from '../../../../shared/ossCredits'

function Credit({ c }: { c: OssCredit }): JSX.Element {
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
          {c.name}
        </a>
        <span className="cset-credit-license">{c.license}</span>
      </div>
      <div className="cset-sub">{c.author} · {c.role}</div>
    </div>
  )
}

export function AboutPanel(): JSX.Element {
  const [notices, setNotices] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const featured = OSS_CREDITS.filter((c) => c.featured)
  const rest = OSS_CREDITS.filter((c) => !c.featured)
  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await fetch('./third-party-notices.txt')
      setNotices(r.ok ? await r.text() : '开发模式下没有生成完整清单：它在构建时生成（npm run build / dist），打包后这里能看到。')
    } catch {
      setNotices('开发模式下没有生成完整清单：它在构建时生成（npm run build / dist），打包后这里能看到。')
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <section className="cset-group">
        <h3>站在这些开源项目上</h3>
        <div className="cset-card">
          <div className="cset-note">Eas-Term {window.api.build.version} 由一个人写成，但离不开下面这些项目和它们的作者。谢谢。</div>
          {featured.map((c) => <Credit key={c.name} c={c} />)}
        </div>
      </section>
      <section className="cset-group">
        <h3>地基</h3>
        <div className="cset-card">{rest.map((c) => <Credit key={c.name} c={c} />)}</div>
      </section>
      <section className="cset-group">
        <h3>语音模型</h3>
        <div className="cset-card">
          <div className="cset-note">不随安装包分发，第一次使用语音输入时从上游下载。</div>
          {MODEL_CREDITS.map((c) => <Credit key={c.name} c={c} />)}
        </div>
      </section>
      <section className="cset-group">
        <h3>完整许可</h3>
        <div className="cset-card">
          <div className="cset-note">
            打包进应用的每一个第三方包，连同许可原文，构建时自动列出。Electron 与 Chromium 的许可、Apache-2.0 与 FunASR 模型协议原文
            另附在安装包的 Resources/licenses/，内置 Harness 的第三方声明在 Resources/omp/。
          </div>
          <div className="cset-actions">
            <button className="cset-btn" disabled={loading} onClick={() => void load()}>
              {loading ? '读取中…' : notices ? '重新读取' : '查看完整许可清单'}
            </button>
          </div>
          {notices && <pre className="cset-pre cset-notices">{notices}</pre>}
        </div>
      </section>
    </>
  )
}
