export function reportNavigationAllowed(candidate: string, authorized: string): boolean {
  try {
    const next = new URL(candidate)
    const source = new URL(authorized)
    return source.protocol === 'file:' && next.protocol === 'file:' && next.origin === source.origin && next.pathname === source.pathname && next.search === source.search
  } catch { return false }
}
