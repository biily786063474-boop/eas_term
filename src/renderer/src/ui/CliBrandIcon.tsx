import claudeLogo from './cliBrands/claude.png'
import openaiLogo from './cliBrands/openai.png'
import appIcon from '../../../../build/icon.png'
import { TerminalIcon } from './Icons'

/** Packaged brand assets: CLI selectors also work offline. */
export function CliBrandIcon({ cliId, bundled = false, size = 16 }: {
  cliId?: string
  bundled?: boolean
  size?: number
}): JSX.Element {
  const brand = cliId === 'claude' ? 'claude' : cliId === 'codex' ? 'openai' : bundled || cliId === 'omp' ? 'eas-term' : null
  if (!brand) return <TerminalIcon size={size} />
  const src = brand === 'claude' ? claudeLogo : brand === 'openai' ? openaiLogo : appIcon
  return <img src={src} alt="" aria-hidden="true" draggable={false} data-cli-brand={brand}
    width={size} height={size} style={{ display: 'block', flexShrink: 0, objectFit: 'contain', borderRadius: 3 }} />
}
