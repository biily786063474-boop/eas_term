import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickChatFrame, frameRoot } from './pluginChatFrame.ts'
import { chatEligible, panelEligible } from './pluginDrawerGate.ts'

const projects = [{ id: 'p1', path: '/work/a' }, { id: 'p2', path: '/work/b' }]
const frames = [
  { id: 'f1', x: 0, y: 0, w: 1000, h: 700, projectId: 'p1' },
  { id: 'f2', x: 3000, y: 0, w: 1000, h: 700, projectId: 'p2' },
  { id: 'free', x: 1500, y: 0, w: 800, h: 600, projectId: null }            // 没有项目目录
]
const base = { frames, projects, canvasSel: [] as string[], viewport: { x: 0, y: 0, scale: 1 }, view: { w: 1200, h: 800 } }

test('选中了哪个 Frame（或其中的节点）就用哪个', () => {
  assert.deepEqual(pickChatFrame({ ...base, canvasSel: ['f:f2'] }), { frameId: 'f2', root: '/work/b' })
  assert.deepEqual(pickChatFrame({ ...base, canvasSel: ['n:f2:cnode-9'] }), { frameId: 'f2', root: '/work/b' })
})

test('没选中：取离视口中心最近、且有项目目录的 Frame；没目录的 Frame 永远不选', () => {
  assert.equal(pickChatFrame(base)?.frameId, 'f1')
  // 视口挪到 f2 附近（screen = world*scale + viewport）
  assert.equal(pickChatFrame({ ...base, viewport: { x: -2900, y: 0, scale: 1 } })?.frameId, 'f2')
  // 视口正对着没目录的 free，也要跳过它
  assert.notEqual(pickChatFrame({ ...base, viewport: { x: -1300, y: 0, scale: 1 } })?.frameId, 'free')
  // 选中的是没目录的 Frame：退回最近的有目录的
  assert.notEqual(pickChatFrame({ ...base, canvasSel: ['f:free'] })?.frameId, 'free')
})

test('画布上没有任何带项目目录的 Frame：返回 null（界面提示先建项目 Frame）', () => {
  assert.equal(pickChatFrame({ ...base, frames: [frames[2]] }), null)
  assert.equal(frameRoot({ ...frames[2], folderPath: '/work/c' }, projects), '/work/c')
})

test('抽屉卡片：有面板的开面板；没面板但有工具的开对话；关掉的或只有技能的自家插件都不开', () => {
  const eas = { id: 'eas:github', name: 'github', displayName: 'GitHub（只读）', cli: 'eas' as const, enabled: true }
  const remote = { ...eas, remote: { transport: 'streamable-http', url: 'https://x.example/mcp', approvedOrigins: ['https://x.example'], auth: 'bearer', bearer: { field: 'token' } } } as never
  assert.equal(chatEligible(remote), true)
  assert.equal(chatEligible({ ...(remote as object), enabled: false } as never), false)
  assert.equal(chatEligible(eas as never), false, '自家插件没有 mcp 也没有 remote：没有工具可接')
  const withPanel = { ...(remote as object), panels: [{ id: 'main' }] } as never
  assert.equal(panelEligible(withPanel), true); assert.equal(chatEligible(withPanel), false)
  assert.equal(chatEligible({ id: 'codex:x', name: 'x', displayName: 'X', cli: 'codex', enabled: true } as never), true)
})
