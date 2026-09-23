import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDisclosurePresence } from './disclosurePresence.ts'

test('closed → opening → open → closing → unmounted', () => {
  let state = { present: false, active: false }
  state = nextDisclosurePresence(state, 'open')
  assert.deepEqual(state, { present: true, active: false })
  state = nextDisclosurePresence(state, 'entered')
  assert.deepEqual(state, { present: true, active: true })
  state = nextDisclosurePresence(state, 'close')
  assert.deepEqual(state, { present: true, active: false })
  state = nextDisclosurePresence(state, 'exited')
  assert.deepEqual(state, { present: false, active: false })
})

test('快速收起又展开后，旧的退出事件不得卸载内容', () => {
  let state = { present: true, active: true }
  state = nextDisclosurePresence(state, 'close')
  state = nextDisclosurePresence(state, 'open')
  state = nextDisclosurePresence(state, 'entered')
  state = nextDisclosurePresence(state, 'exited')
  assert.deepEqual(state, { present: true, active: true })
})
