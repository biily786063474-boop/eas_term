// 右键归属。**这一层原来一条测试都没有**，而它的坏法是静默的：
// 漏掉一个选择器，右键照样弹一个菜单，只是弹错了那个。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  menuOwnerOf,
  OVERLAY_SELECTOR,
  type ClosestLike
} from './menuOwnership.ts'

/** 假节点：声明「我在这些选择器里面」，closest 就照着答。
 *  **不需要 jsdom** —— 被测函数只用到 closest 这一个方法。 */
function at(...inside: string[]): ClosestLike {
  return {
    closest(sel: string): unknown {
      // 真 closest 接受逗号分隔的选择器组，任一命中即算 —— 这里照做
      const wanted = sel.split(',').map((s) => s.trim())
      return inside.some((i) => wanted.includes(i)) ? {} : null
    }
  }
}

// ── 画布之外 ──────────────────────────────────────────────────────
test('三层都不在 = 落在画布之外，让给系统菜单', () => {
  assert.equal(menuOwnerOf(at(), false), 'outside')
  assert.equal(menuOwnerOf(at('.titlebar'), false), 'outside')
})

test('**标记层是兄弟层，必须单独认** —— 漏了它，标记上的右键整个不可达', () => {
  assert.equal(menuOwnerOf(at('.canvas-shape-layer'), false), 'canvas')
})

test('画布的另外两层也认', () => {
  assert.equal(menuOwnerOf(at('.canvas-viewport'), false), 'canvas')
  assert.equal(menuOwnerOf(at('.pane-layer'), false), 'canvas')
})

// ── 内层认领 ──────────────────────────────────────────────────────
test('表单控件里让给系统菜单 —— 用户要的是复制/粘贴', () => {
  for (const s of ['input', 'textarea', '[contenteditable="true"]', '.term-input', '.cshape.editing']) {
    assert.equal(menuOwnerOf(at('.canvas-viewport', s), false), 'inner', s)
  }
})

// **这一条对着 2026-08-30 用户报的那个 bug。**
// 登录面板的「点我去登录」把右键定义成了「复制登录链接」，
// 而修复前弹出来的是画布的「关闭终端」—— 想复制链接，差一点把节点关掉。
// 组件里的 preventDefault 挡不住（画布菜单挂在 document 上），
// **这份名单是唯一的挡法**，漏了没有任何别处能补救。
test('**登录面板里右键不归画布**（用户报过：弹出了「关闭终端」）', () => {
  assert.equal(menuOwnerOf(at('.pane-layer', '.ac-login'), false), 'inner')
})

test('安装 / 首次设置面板同理 —— 里面有命令原文和报错，右键要的是复制', () => {
  assert.equal(menuOwnerOf(at('.pane-layer', '.ac-setup'), false), 'inner')
})

test('既有的那些浮层一个都不能掉', () => {
  // 逐个断言，而不是笼统跑一遍 —— 掉了哪个要能一眼看出是哪个
  for (const s of [
    '.canvas-drawer',
    '.wiki-drawer',
    '.cskill-panel',
    '.canvas-ctxmenu',
    '.cset-box',
    '.ctodo-lightbox'
  ]) {
    assert.equal(menuOwnerOf(at('.canvas-viewport', s), false), 'inner', s)
  }
})

test('浮层名单和实现里的选择器串是同一份 —— 不会各写一份', () => {
  for (const s of ['.ac-login', '.ac-setup', '.canvas-drawer']) {
    assert.ok(OVERLAY_SELECTOR.includes(s), `${s} 不在 OVERLAY_SELECTOR 里`)
  }
})

// ── 最大化 ────────────────────────────────────────────────────────
test('**最大化时**内容区不归画布 —— 画布已经看不见了，弹它的菜单没有意义', () => {
  assert.equal(menuOwnerOf(at('.pane-layer', '.pane-body'), true), 'inner')
  assert.equal(menuOwnerOf(at('.canvas-viewport', '.cfile-body'), true), 'inner')
})

test('**没最大化时不挡** —— 那时画布就在眼前，右键要节点操作不会让人意外', () => {
  assert.equal(menuOwnerOf(at('.pane-layer', '.pane-body'), false), 'canvas')
})

test('最大化只挡内容区，**不挡头部那条 chrome**（标题栏/关闭钮仍归画布）', () => {
  assert.equal(menuOwnerOf(at('.pane-layer', '.pane-head'), true), 'canvas')
})
