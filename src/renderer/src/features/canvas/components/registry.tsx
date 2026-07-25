// 画布组件注册表（协议）。
// —— 新增一个画布组件 = 写一个 CanvasComponentDef 并 push 进 CANVAS_COMPONENTS，无需改动其它文件。
// 组件节点是「画布独有」的（不进分屏），与文件预览节点同类，走装饰层渲染。
// 详见规范文档：docs/画布组件协议.html

import type { JSX } from 'react'
import { HistoryView } from '../../git/HistoryView'
import { DesignNode, type DesignState } from '../../design/DesignNode'
import { GitBranchIcon, DesignIcon } from '../../../ui/Icons'

/** 组件渲染时拿到的上下文（由所属 Frame 注入） */
export interface CanvasComponentCtx {
  nodeId: string
  frameId: string
  /** 所属 Frame 绑定的项目；needsProject 组件保证非空 */
  projectId: string | null
  /** 项目工作目录（needsProject 组件的 cwd） */
  cwd: string
  /** 拖入时可携带的额外参数（存在 node.component.props） */
  props?: Record<string, unknown>
}

/** 一个可拖入画布的组件定义 */
export interface CanvasComponentDef {
  /** 唯一标识，持久化进 node.component.type，勿随意改名 */
  id: string
  /** 抽屉里显示的名称 */
  name: string
  /** 抽屉里的图标（接受 { size } 的组件） */
  Icon: (props: { size?: number }) => JSX.Element
  /** 一句话简介 */
  description?: string
  /** 拖入时的默认节点尺寸 */
  defaultSize: { w: number; h: number }
  /** 是否必须落在绑定了项目的 Frame 内（true → 拖到无项目 Frame 会被拒绝） */
  needsProject?: boolean
  /** 渲染组件内容；返回的元素会被放进节点 body */
  render: (ctx: CanvasComponentCtx) => JSX.Element
}

// ============ 组件清单（在这里追加新组件） ============

/** 版本管理：Git 分支图 + 提交历史（SourceTree 式轨道图，复用 HistoryView） */
const gitComponent: CanvasComponentDef = {
  id: 'git',
  name: '版本管理',
  Icon: GitBranchIcon,
  description: 'Git 分支图 / 提交历史',
  defaultSize: { w: 560, h: 460 },
  needsProject: true,
  render: (ctx) => <HistoryView cwd={ctx.cwd} />
}

/** 设计模块（Step 1：渲染 + 导出到 <项目>/demo/；后续接 Konva 设计画布） */
const designComponent: CanvasComponentDef = {
  id: 'design',
  name: '设计模块',
  Icon: DesignIcon,
  description: '设计 / 动效，导出到项目 demo/',
  defaultSize: { w: 380, h: 320 },
  needsProject: true,
  render: (ctx) => (
    <DesignNode
      cwd={ctx.cwd}
      frameId={ctx.frameId}
      nodeId={ctx.nodeId}
      savedState={(ctx.props?.designState as DesignState | undefined) ?? null}
    />
  )
}

export const CANVAS_COMPONENTS: CanvasComponentDef[] = [gitComponent, designComponent]

export const getCanvasComponent = (id: string): CanvasComponentDef | undefined =>
  CANVAS_COMPONENTS.find((c) => c.id === id)
