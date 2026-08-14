// Skill 管理面板。挂在 CanvasWikiDrawer 里：抽屉左上角名称切到「Skill」时，整个内容换成
// 这个组件（知识库那套 UI 完全不显示，是下拉切换、不是上下分区，见 design 文档 §六 第 5 条）。
//
// 完整背景见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md。
// 这个文件负责四件事里的三件（第四件是 MCP 分类口子，在 mcpHandler.ts）：
//   1. 右键复制 skill → 切到别的目录 → 空白处右键粘贴（真的复制文件，重名拒绝）
//   2. 右键临时禁用 / 恢复（只写清单，不动文件；面板上置灰并说明只在本软件生效）
//   3. 文件树条目拖到画布上，落成**可编辑**节点（复用 useOpenInCanvas，和知识库同一条路）
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { projectIdOfFrame } from '../../store/canvasSlice'
import type { SkillDirEntry, SkillInfo, SkillListResult } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { CanvasContextMenu, type CanvasMenuItem } from './CanvasContextMenu'
import { useOpenInCanvas, viewportCenter } from './useOpenInCanvas'
import { ChevronRightIcon, CheckIcon, PlusIcon, FolderIcon, CopyIcon } from '../../ui/Icons'

/** 项目 Frame 的「项目 skill」目录：约定死的相对路径，不需要用户选。
 *  用模板字符串拼、不引 Node 的 path 模块——渲染层历来这么拼路径
 *  （见 CanvasWikiDrawer.tsx 的 queueMedia），Windows 上混用 `/` 也认。 */
const projectSkillDir = (projectPath: string): string => `${projectPath}/.claude/skills`

/** 应用内剪贴板里的一个 skill。**刻意不用系统剪贴板**：系统剪贴板放不下「一个目录」
 *  这个概念，而且会跟用户手上正在复制的文字打架（复制个 skill 就把他剪贴板里的东西冲掉，
 *  是最容易让人骂街的那种副作用）。 */
interface SkillClip {
  path: string
  name: string
}

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
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)

  const [result, setResult] = useState<SkillListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  /** 右键菜单：skill 为 null 表示点在面板空白处（那时只出「粘贴」） */
  const [menu, setMenu] = useState<{ x: number; y: number; skill: SkillInfo | null } | null>(null)
  const [clip, setClip] = useState<SkillClip | null>(null)

  // skill 文件 → 画布：可编辑节点（跟知识库那条只读的路共用同一份实现，只差这两个参数）。
  // writeVia='skill'：这些文件在 `~/.claude/skills` 之类的位置，保存不能走 fs:writeTextFile
  // （它过 fsGuard，只认项目根和知识库根），得走 skillLibrary 自己那条有窄边界的写入口。
  const { openInCanvas, startFileDrag, htmlChoice } = useOpenInCanvas({ readOnly: false, writeVia: 'skill' })

  const say = useCallback((text: string, bad = false): void => {
    setNotice({ text, bad })
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 3600)
  }, [])

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
    // activeDir 是每次渲染新算出来的对象，只用它的 path 判断要不要重新拉取；
    // reloadKey 是复制/禁用之后的手动重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDir?.path, reloadKey])

  // agent 通过 MCP 改了分类 → 面板重拉一次。不这么做的话用户得手动切个目录才看得到变化，
  // 而「让 agent 整理分类」这件事的整个价值就在于他抬头就能看见结果。
  useEffect(() => {
    const h = (): void => setReloadKey((k) => k + 1)
    window.addEventListener('skills-changed', h)
    return () => window.removeEventListener('skills-changed', h)
  }, [])

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
      say(r.error ?? '添加失败', true)
      return
    }
    const prevIds = new Set(dirs.map((d) => d.id))
    const added = r.dirs.find((d) => !prevIds.has(d.id))
    setDirs(r.dirs)
    if (added) setDirId(added.id)
  }

  /** 移除一条自定义目录。**只是把它从面板的列表里拿掉**，硬盘上那个目录一个字节都不动 */
  const removeCustomDir = async (id: string): Promise<void> => {
    const next = await window.api.skillLibrary.removeDir(id)
    setDirs(next)
    setDirId((cur) => (cur === id ? (next[0]?.id ?? null) : cur))
    say('已从列表移除（目录本身没动）')
  }

  // ── 粘贴：真的复制文件 ─────────────────────────────────────────────────
  // 重名一律拒绝、不覆盖不改名（design 文档 §六 第 4 条）。主进程那边还有一层边界校验
  // （目标必须是已登记的 skill 目录），这里不重复判断，只负责把结果讲给人听。
  const pasteHere = async (): Promise<void> => {
    if (!clip || !activeDir) return
    const r = await window.api.skillLibrary.copySkill(clip.path, activeDir.path)
    if (!r.ok) {
      say(r.error ?? '复制失败', true)
      return
    }
    say(`已复制「${clip.name}」到这里`)
    setReloadKey((k) => k + 1)
  }

  const toggleDisabled = async (skill: SkillInfo, want: boolean): Promise<void> => {
    const r = await window.api.skillLibrary.setDisabled(skill.path, want)
    if (!r.ok) {
      say(r.error ?? '操作失败', true)
      return
    }
    setReloadKey((k) => k + 1)
  }

  const disabledSet = useMemo(() => new Set(result?.disabled ?? []), [result])

  const activeDirEntry = selectedProject ? null : dirs.find((d) => d.id === dirId)
  const dirMenuItems: CanvasMenuItem[] = [
    ...dirs.map((d) => ({
      label: d.label,
      hint: d.builtin ? undefined : '自定义',
      icon: d.id === dirId ? <CheckIcon size={12} /> : undefined,
      onClick: () => setDirId(d.id)
    })),
    { label: '', sep: true, onClick: () => {} },
    { label: '添加自定义目录…', icon: <PlusIcon size={12} />, onClick: () => void addCustomDir() },
    ...(activeDirEntry && !activeDirEntry.builtin
      ? [
          {
            label: `从列表移除「${activeDirEntry.label}」`,
            hint: '不删文件',
            danger: true,
            onClick: () => void removeCustomDir(activeDirEntry.id)
          }
        ]
      : [])
  ]

  /** 右键菜单的内容。点在 skill 上多两项（复制 / 禁用），空白处只有粘贴。 */
  const menuItems = (skill: SkillInfo | null): CanvasMenuItem[] => {
    const items: CanvasMenuItem[] = []
    if (skill) {
      const off = disabledSet.has(skill.path)
      items.push({
        label: '复制',
        icon: <CopyIcon size={12} />,
        onClick: () => {
          setClip({ path: skill.path, name: skill.name })
          say(`已复制「${skill.name}」，切到别的目录后在空白处右键粘贴`)
        }
      })
      items.push({
        label: off ? '恢复使用' : '禁用',
        hint: off ? undefined : '仅本软件',
        onClick: () => void toggleDisabled(skill, !off)
      })
      items.push({ label: '', sep: true, onClick: () => {} })
      items.push({
        label: '在访达中显示',
        onClick: () => void window.api.fs.showInFolder(skill.path)
      })
      items.push({ label: '', sep: true, onClick: () => {} })
    }
    items.push(
      clip
        ? {
            label: `粘贴 skill「${clip.name}」`,
            hint: '复制到这个目录',
            disabled: !activeDir,
            onClick: () => void pasteHere()
          }
        : { label: '粘贴 skill', hint: '还没复制任何 skill', disabled: true, onClick: () => {} }
    )
    return items
  }

  return (
    <div
      className="skl-panel"
      onContextMenu={(e) => {
        // 面板空白处右键 → 只出「粘贴」。落在 skill 行上的右键由那一行自己 stopPropagation 掉了。
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, skill: null })
      }}
    >
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
      {menu && (
        <CanvasContextMenu x={menu.x} y={menu.y} items={menuItems(menu.skill)} onClose={() => setMenu(null)} />
      )}
      {notice && <div className={`skl-notice${notice.bad ? ' bad' : ''}`}>{notice.text}</div>}
      {!!clip && (
        <div className="skl-clip">
          剪贴板：<b>{clip.name}</b> · 在空白处右键粘贴
          <button className="skl-clip-x" data-tip="清掉" onClick={() => setClip(null)}>
            ×
          </button>
        </div>
      )}

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

      {/* 禁用的代价必须摆在明面上：CLI 自己仍然会加载它，这个开关只改本软件的视图。
          用户已经知情并接受（design 文档 §六 第 1 条），但不写出来的话，
          下一次他会以为点了禁用 Claude Code 那边就不加载了。
          只在真有被禁用的 skill 时出现——没禁过任何东西的人不需要看这句话。 */}
      {!loading && result?.ok && result.disabled.length > 0 && (
        <div className="skl-note">
          划掉的 {result.disabled.length} 个只在这个软件里禁用了 —— CLI 自己仍然会加载它们
          （禁用不动硬盘上的文件）
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
                      const off = disabledSet.has(sk.path)
                      return (
                        <div
                          className={`skl-item${off ? ' off' : ''}`}
                          key={sk.path}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation() // 别让面板那层再开一个只有「粘贴」的菜单
                            setMenu({ x: e.clientX, y: e.clientY, skill: sk })
                          }}
                        >
                          <button
                            className="skl-item-head"
                            onClick={() => setExpandedSkill(expanded ? null : sk.path)}
                          >
                            <span className={`skl-chevron${expanded ? ' open' : ''}`}>
                              <ChevronRightIcon size={10} />
                            </span>
                            <span className="skl-item-name">{sk.name}</span>
                            {off && <span className="skl-off-tag">已禁用</span>}
                          </button>
                          {!!sk.description && <div className="skl-item-desc">{sk.description}</div>}
                          {expanded && (
                            <div
                              className="skl-item-tree"
                              onMouseDown={(e) => {
                                // 拖文件到画布上编辑。目录行不给拖（拖一个目录进画布没有意义）。
                                // 内联输入框让给它自己——viewOnly 的树上不该出现，防御一下。
                                if ((e.target as HTMLElement).closest('input')) return
                                const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                                const fp = item?.dataset.path
                                if (!fp || item?.dataset.dir) return
                                startFileDrag(fp, e)
                              }}
                              onDoubleClick={(e) => {
                                const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                                const fp = item?.dataset.path
                                if (!fp || item?.dataset.dir) return
                                const { wx, wy } = viewportCenter()
                                openInCanvas(fp, wx - 90, wy - 15)
                              }}
                            >
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
      {htmlChoice}
    </div>
  )
}
