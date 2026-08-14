// Skill 管理面板 —— 这一半只做「读与显示」。
// 挂在 CanvasWikiDrawer 里：抽屉左上角名称切到「Skill」时，整个内容换成这个组件
// （知识库那套 UI 完全不显示，是下拉切换、不是上下分区，见 design 文档 §六 第 5 条）。
//
// 复制 skill / 右键禁用恢复 / 文件树拖到画布编辑 / 给 agent 开的分类 MCP 口子，
// 都是另一半任务。完整背景见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md。
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { projectIdOfFrame } from '../../store/canvasSlice'
import type { SkillDirEntry, SkillListResult } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { CanvasContextMenu, type CanvasMenuItem } from './CanvasContextMenu'
import { ChevronRightIcon, CheckIcon, PlusIcon, FolderIcon } from '../../ui/Icons'

/** 项目 Frame 的「项目 skill」目录：约定死的相对路径，不需要用户选。
 *  用模板字符串拼、不引 Node 的 path 模块——渲染层历来这么拼路径
 *  （见 CanvasWikiDrawer.tsx 的 queueMedia），Windows 上混用 `/` 也认。 */
const projectSkillDir = (projectPath: string): string => `${projectPath}/.claude/skills`

export function CanvasSkillPanel(): JSX.Element {
  const canvasSel = useStore((s) => s.canvasSel)
  const frames = useStore((s) => s.canvas.frames)
  const projects = useStore((s) => s.projects)

  // 只认「单选一个 Frame」，和 canvasSlice.ts 的 followSel 同一个判据——画布上选中
  // 一个 Frame 时「切到该项目」这件事，用户在别处（抽屉项目高亮）已经见过一次，
  // 这里用同一条规则，不会出现「这里判定选中了，那里没高亮」的两套标准。
  const selectedProjectId = useMemo(() => {
    if (canvasSel.length !== 1 || !canvasSel[0].startsWith('f:')) return null
    return projectIdOfFrame(frames, canvasSel[0].slice(2))
  }, [canvasSel, frames])
  const selectedProject = useMemo(
    () => (selectedProjectId ? (projects.find((p) => p.id === selectedProjectId) ?? null) : null),
    [selectedProjectId, projects]
  )

  const [dirs, setDirs] = useState<SkillDirEntry[]>([])
  const [dirId, setDirId] = useState<string | null>(null)
  const [dirMenuAt, setDirMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [addErr, setAddErr] = useState<string | null>(null)

  const [result, setResult] = useState<SkillListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  // 目录集合不写死：内置几个默认 + 用户自己加的自定义目录，见 main/skillLibrary/dirs.ts
  useEffect(() => {
    let alive = true
    void window.api.skillLibrary.listDirs().then((list) => {
      if (!alive) return
      setDirs(list)
      setDirId((cur) => cur ?? list[0]?.id ?? null)
    })
    return () => {
      alive = false
    }
  }, [])

  const activeDir: { label: string; path: string } | null = selectedProject
    ? { label: `项目 · ${selectedProject.name}`, path: projectSkillDir(selectedProject.path) }
    : (dirs.find((d) => d.id === dirId) ?? null)

  useEffect(() => {
    setExpandedSkill(null)
    setCollapsedCats(new Set())
    if (!activeDir) {
      setResult(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void window.api.skillLibrary.list(activeDir.path).then((r) => {
      if (!alive) return
      setResult(r)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // activeDir 是每次渲染新算出来的对象，只用它的 path 判断要不要重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDir?.path])

  const toggleCat = (name: string): void => {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const openDirMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDirMenuAt({ x: r.left, y: r.bottom + 4 })
  }

  const addCustomDir = async (): Promise<void> => {
    const picked = await window.api.skillLibrary.pickDir()
    if (!picked) return
    const r = await window.api.skillLibrary.addDir(picked)
    if (!r.ok) {
      setAddErr(r.error ?? '添加失败')
      window.setTimeout(() => setAddErr((m) => (m === (r.error ?? '添加失败') ? null : m)), 3200)
      return
    }
    const prevIds = new Set(dirs.map((d) => d.id))
    const added = r.dirs.find((d) => !prevIds.has(d.id))
    setDirs(r.dirs)
    if (added) setDirId(added.id)
  }

  const dirMenuItems: CanvasMenuItem[] = [
    ...dirs.map((d) => ({
      label: d.label,
      hint: d.builtin ? undefined : '自定义',
      icon: d.id === dirId ? <CheckIcon size={12} /> : undefined,
      onClick: () => setDirId(d.id)
    })),
    { label: '', sep: true, onClick: () => {} },
    { label: '添加自定义目录…', icon: <PlusIcon size={12} />, onClick: () => void addCustomDir() }
  ]

  return (
    <div className="skl-panel">
      <div className="skl-toolbar">
        {selectedProject ? (
          <div className="skl-scope" data-tip={activeDir?.path}>
            <FolderIcon size={12} />
            <span>{activeDir?.label}</span>
          </div>
        ) : (
          <button className="skl-cli-btn" onClick={openDirMenu} data-tip={activeDir?.path}>
            <span>{activeDir?.label ?? '选择目录'}</span>
            <span className={`skl-chevron${dirMenuAt ? ' open' : ''}`}>
              <ChevronRightIcon size={10} />
            </span>
          </button>
        )}
      </div>
      {dirMenuAt && !selectedProject && (
        <CanvasContextMenu x={dirMenuAt.x} y={dirMenuAt.y} items={dirMenuItems} onClose={() => setDirMenuAt(null)} />
      )}
      {addErr && <div className="wk-warn skl-adderr">{addErr}</div>}

      {loading && <div className="wk-dim wk-tiny wk-pad">加载中…</div>}

      {!loading && result && !result.ok && (
        <div className="wk-warn">
          {result.error}
          {!!activeDir?.path && (
            <>
              <br />
              <span className="wk-dim wk-tiny">{activeDir.path}</span>
            </>
          )}
        </div>
      )}

      {!loading && result?.ok && result.skills.length === 0 && (
        <div className="wk-dim wk-tiny wk-pad">
          {selectedProject ? '这个项目还没有项目 skill' : '这个目录下没有找到 skill'}
          <br />
          没有子目录带 SKILL.md
          {!!activeDir?.path && (
            <>
              <br />
              <span className="skl-path">{activeDir.path}</span>
            </>
          )}
        </div>
      )}

      {!loading && result?.ok && result.skills.length > 0 && (
        <div className="skl-list">
          {result.categories.map((cat) => {
            const collapsed = collapsedCats.has(cat.name)
            return (
              <div className="skl-cat" key={cat.name}>
                <button className="skl-cat-head" onClick={() => toggleCat(cat.name)}>
                  <span className={`skl-chevron${collapsed ? '' : ' open'}`}>
                    <ChevronRightIcon size={10} />
                  </span>
                  <span className="skl-cat-name">{cat.name}</span>
                  <span className="skl-cat-count">{cat.skillPaths.length}</span>
                </button>
                {!collapsed && (
                  <div className="skl-cat-body">
                    {cat.skillPaths.map((p) => {
                      const sk = result.skills.find((s) => s.path === p)
                      if (!sk) return null
                      const expanded = expandedSkill === sk.path
                      return (
                        <div className="skl-item" key={sk.path}>
                          <button
                            className="skl-item-head"
                            onClick={() => setExpandedSkill(expanded ? null : sk.path)}
                          >
                            <span className={`skl-chevron${expanded ? ' open' : ''}`}>
                              <ChevronRightIcon size={10} />
                            </span>
                            <span className="skl-item-name">{sk.name}</span>
                          </button>
                          {!!sk.description && <div className="skl-item-desc">{sk.description}</div>}
                          {expanded && (
                            <div className="skl-item-tree">
                              <FileTree key={sk.path} rootPath={sk.path} refreshKey={0} viewOnly />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
