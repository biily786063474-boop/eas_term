import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePlanOwner } from './executionPlanOwner.ts'

test('persisted agent node yields stable owner across sessions; project and pane are verified', t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-owner-'))
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-root-'))
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-other-'))
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }) })
  fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify([{ id: 'p', path: root }, { id: 'q', path: other }]))
  fs.writeFileSync(path.join(userData, 'canvas.json'), JSON.stringify({ frames: [
    { projectId: 'p', nodes: [{ id: 'n-a', pane: { kind: 'agent' } }, { id: 'n-b', pane: { kind: 'agent' } }, { id: 'n-file', pane: { kind: 'code' } }] },
    { projectId: 'q', nodes: [{ id: 'n-q', pane: { kind: 'agent' } }] }
  ] }))
  const args = { userData, cwd: root, agentNodeId: 'n-a', sessionId: 's-a' }
  assert.deepEqual(resolvePlanOwner(args), { root: fs.realpathSync(root), ownerKey: 'node:n-a' })
  assert.deepEqual(resolvePlanOwner({ ...args, sessionId: 'after-restart' }), { root: fs.realpathSync(root), ownerKey: 'node:n-a' })
  assert.deepEqual(resolvePlanOwner({ ...args, agentNodeId: 'n-b' }), { root: fs.realpathSync(root), ownerKey: 'node:n-b' })
  assert.throws(() => resolvePlanOwner({ ...args, agentNodeId: 'n-q' }), /项目/)
  assert.throws(() => resolvePlanOwner({ ...args, agentNodeId: 'n-file' }), /AI|agent/)
  assert.throws(() => resolvePlanOwner({ ...args, agentNodeId: 'missing' }), /节点/)
})

test('temporary split is session-scoped, absent identity is rejected', t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-owner-'))
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-root-'))
  t.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }) })
  assert.deepEqual(resolvePlanOwner({ userData, cwd, sessionId: 's-a', agentLeafId: 'leaf-a' }), { root: fs.realpathSync(cwd), ownerKey: 'session:s-a' })
  assert.throws(() => resolvePlanOwner({ userData, cwd, sessionId: 's-a' }), /归属/)
})
