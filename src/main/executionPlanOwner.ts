import fs from 'node:fs'
import path from 'node:path'
import { projectRootOf } from '../shared/roleWorktree.ts'

interface OwnerInput { userData: string; cwd: string; sessionId: string; agentNodeId?: string; agentLeafId?: string }
interface ProjectRow { id?: unknown; path?: unknown }
interface CanvasNode { id?: unknown; pane?: { kind?: unknown } }
interface CanvasFrame { projectId?: unknown; nodes?: CanvasNode[] }

function readSmallJson(file: string): unknown {
  if (fs.statSync(file).size > 8 * 1024 * 1024) throw Error('归属资料过大')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
function realRoot(cwd: string): string {
  if (!path.isAbsolute(cwd)) throw Error('项目路径无效')
  return fs.realpathSync(projectRootOf(cwd))
}

/** Resolve a persisted canvas identity; caller-supplied node ID is only a lookup hint. */
export function resolvePlanOwner(input: OwnerInput): { root: string; ownerKey: string } {
  const root = realRoot(input.cwd)
  if (!input.agentNodeId) {
    if (!input.agentLeafId || !input.sessionId) throw Error('临时对话缺少会话归属')
    return { root, ownerKey: `session:${input.sessionId}` }
  }
  if (!/^[\w-]{1,160}$/.test(input.agentNodeId)) throw Error('AI 节点 ID 无效')
  const projects = readSmallJson(path.join(input.userData, 'projects.json'))
  const canvas = readSmallJson(path.join(input.userData, 'canvas.json')) as { frames?: CanvasFrame[] }
  if (!Array.isArray(projects) || !Array.isArray(canvas?.frames)) throw Error('归属资料无效')
  const matches = canvas.frames.flatMap(frame => Array.isArray(frame.nodes)
    ? frame.nodes.filter(node => node?.id === input.agentNodeId).map(node => ({ frame, node })) : [])
  if (matches.length !== 1) throw Error('AI 节点不存在或重复')
  const { frame, node } = matches[0]
  if (node.pane?.kind !== 'agent') throw Error('目标不是 AI 对话节点')
  const project = (projects as ProjectRow[]).find(row => row?.id === frame.projectId)
  if (!project || typeof project.path !== 'string' || realRoot(project.path) !== root) throw Error('AI 节点项目不匹配')
  return { root, ownerKey: `node:${input.agentNodeId}` }
}

/** Renderer card lookup after restart, before a new managed session exists. */
export function resolveNodePlanOwner(userData: string, nodeId: string): { root: string; ownerKey: string } {
  const projects = readSmallJson(path.join(userData, 'projects.json')) as ProjectRow[]
  const canvas = readSmallJson(path.join(userData, 'canvas.json')) as { frames?: CanvasFrame[] }
  if (!Array.isArray(projects) || !Array.isArray(canvas?.frames)) throw Error('归属资料无效')
  const frames = canvas.frames.filter(frame => Array.isArray(frame.nodes) && frame.nodes.some(node => node?.id === nodeId))
  if (frames.length !== 1) throw Error('AI 节点不存在或重复')
  const project = projects.find(row => row.id === frames[0].projectId)
  if (typeof project?.path !== 'string') throw Error('AI 节点项目不存在')
  return resolvePlanOwner({ userData, cwd: project.path, sessionId: 'lookup', agentNodeId: nodeId })
}
