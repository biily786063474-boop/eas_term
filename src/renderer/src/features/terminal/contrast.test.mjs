import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

test('terminal enables per-cell contrast correction for CLI custom-background headers', () => {
  const source = readFileSync(new URL('./TerminalView.tsx', import.meta.url), 'utf8')
  assert.match(source, /minimumContrastRatio:\s*4\.5/)
})
