import { fileURLToPath } from 'node:url'

/** Decode only a local HTML file URL; `URL.pathname` is not a native Windows path. */
export function reportFilePathFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:' || url.search || url.hash || !/\.html?$/i.test(url.pathname)) return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}
