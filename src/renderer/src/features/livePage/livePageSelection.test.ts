import test from 'node:test'
import assert from 'node:assert/strict'
import { pickLivePage } from './livePageSelection.ts'
import type { LivePageState } from '../../../../shared/livePage.ts'

const page = (owner: string, leafId: string): LivePageState => ({ owner, leafId, url: 'http://localhost:5173/', title: leafId, loading: false, visible: true, popout: false })

test('active AI conversation owns split preview, not latest frame updater', () => {
  const first = page('leaf:a', 'a'), second = page('leaf:b', 'b')
  assert.equal(pickLivePage([first, second], 'a', true), first)
  assert.equal(pickLivePage([first, second], 'missing', true), undefined)
  assert.equal(pickLivePage([first, second], undefined, false), second)
})
