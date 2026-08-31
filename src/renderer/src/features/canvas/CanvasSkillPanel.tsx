// Skill 管理面板。挂在 CanvasWikiDrawer 里：抽屉左上角的胶囊切到「技能库」时，整个内容换成
// 这个组件（知识库那套 UI 完全不显示，是整换、不是上下分区，见 design 文档 §六 第 5 条）。
//
// 完整背景见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md。
// 这个文件负责四件事里的三件（第四件是 MCP 分类口子，在 mcpHandler.ts）：
//   1. 右键复制 skill → 切到别的目录 → 空白处右键粘贴（真的复制文件，重名拒绝）
//   2. 右键临时禁用 / 恢复（只写清单，不动文件；面板上置灰并说明只在本软件生效）
//   3. 文件树条目拖到画布上，落成**可编辑**节点（复用 useOpenInCanvas，和知识库同一条路）
//
// ── 来源分段（项目级 + 全局并存）─────────────────────────────────────────
// 早先选中项目 Frame 时，面板把目录**整个换成**该项目的 `.claude/skills`，
// 全局那几个目录连同下拉按钮一起消失。但在项目里干活时用得最多的恰恰是全局 skill
// （项目级通常只有寥寥几个，全局上百个），把常用的那批藏起来是反的。
// 现在两段并存：**项目段在上、全局段在下，各自带来源标注**。
// 分段规则本身是纯函数，在 skillSections.ts，可单测。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { UNCATEGORIZED } from '../../../../shared/types'
import { useStore } from '../../store'
import { projectIdOfFrame } from '../../store/canvasSlice'
import { soleFrameIdOfSel } from '../../store/canvas/selKey'
import type { SkillDirEntry, SkillInfo, SkillListResult } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { CanvasContextMenu, type CanvasMenuItem } from '../../ui/CanvasContextMenu'
import { planSkillSections, type SkillSection } from './skillSections'
import { useOpenInCanvas, viewportCenter } from './useOpenInCanvas'
import { FileLightbox } from './FileLightbox'
import { ChevronRightIcon, CheckIcon, PlusIcon, CopyIcon, CloseIcon } from '../../ui/Icons'

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

  // 判据是「选中的东西在哪个 Frame 里」，不是「选中的是不是 Frame 本身」——
  // 点中项目 Frame 里的一个终端/文件节点同样算在这个项目里（用户明确要的语义）。
  // 映射规则在 store/canvas/selKey.ts，canvasSlice.ts 的 followSel 用的是同一份，
  // 不会出现「这里判定选中了，抽屉里那个项目却没高亮」的两套标准。
  const selectedProjectId = useMemo(() => {
    const fid = soleFrameIdOfSel(canvasSel)
    return fid ? projectIdOfFrame(frames, fid) : null
  }, [canvasSel, frames])
  const selectedProject = useMemo(
    () => (selectedProjectId ? (projects.find((p) => p.id === selectedProjectId) ?? null) : null),
    [selectedProjectId, projects]
  )

  // 点开一个文件先进灯箱看（看完即走），不再默认往画布上落节点 —— 落画布是
  // 灯箱里那个按钮和拖拽的事，见 FileLightbox 文件头。
  // 手动分类：拖一个 skill 卡片到某个分类头上。分类是**纯视图标记**，
  // 不动硬盘上的 skill 文件、不影响任何 CLI 怎么加载它们（数据层见
  // main/skillLibrary/README.md 那张表）。拖过的会被「锁住」，AI 的
  // skill_categorize 之后不许再改它。
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropCat, setDropCat] = useState<string | null>(null)
  /** 正在建新分类（工具栏那个 +）。分类是全局的，不属于某一段。 */
  const [newCat, setNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const [lightbox, setLightbox] = useState<string | null>(null)
  const [dirs, setDirs] = useState<SkillDirEntry[]>([])
  const [dirId, setDirId] = useState<string | null>(null)
  const [dirMenuAt, setDirMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)

  /** 每段一份结果，按段的 path 索引。段是并列的，一段读失败不该影响另一段。 */
  const [results, setResults] = useState<Record<string, SkillListResult>>({})
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [collapsedSecs, setCollapsedSecs] = useState<Set<string>>(new Set())
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  /** 右键菜单：skill 为 null 表示点在空白处（那时只出「粘贴」）。
   *  destPath 是「粘到哪」——点在哪一段的地盘上就粘到哪一段，见 menuItems。 */
  const [menu, setMenu] = useState<{ x: number; y: number; skill: SkillInfo | null; destPath: string | null } | null>(
    null
  )
  const [clip, setClip] = useState<SkillClip | null>(null)

  // skill 文件 → 画布：可编辑节点（跟知识库那条只读的路共用同一份实现，只差这两个参数）。
  // writeVia='skill'：这些文件在 `~/.claude/skills` 之类的位置，保存不能走 fs:writeTextFile
  // （它过 fsGuard，只认项目根和知识库根），得走 skillLibrary 自己那条有窄边界的写入口。
  const { openInCanvas, startFileDrag, htmlChoice } = useOpenInCanvas({ readOnly: false, writeVia: 'skill' })

  const say = useCallback((text: string, bad = false): void => {
    setNotice({ text, bad })
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 3600)
  }, [])

  /** 把一个 skill 归到某个分类。`cat` 传 null = 拿回未分类，同时解锁（交还给 AI 管）。 */
  const assign = useCallback(
    async (skillPath: string, cat: string | null): Promise<void> => {
      const r = await window.api.skillLibrary.assignCategory(skillPath, cat)
      if (!r.ok) return say(r.error ?? '归类失败', true)
      setReloadKey((k) => k + 1)
      say(cat ? `已归到「${cat}」` : '已拿回未分类')
    },
    [say]
  )

  const addCategory = useCallback(
    async (name: string): Promise<void> => {
      const n = name.trim()
      if (!n) return
      const r = await window.api.skillLibrary.addCategoryName(n)
      if (!r.ok) return say(r.error ?? '建不了这个分类', true)
      setReloadKey((k) => k + 1)
      say(`已建分类「${n}」，把 skill 拖进去`)
    },
    [say]
  )

  const removeCategory = useCallback(
    async (name: string): Promise<void> => {
      // 删分类**不删里面的 skill**，它们回到未分类。分类是视图上的标记，
      // 删标记不该牵连被标记的东西 —— 所以这里不弹确认，代价很小且可逆。
      const r = await window.api.skillLibrary.removeCategoryName(name)
      if (!r.ok) return say(r.error ?? '删不掉', true)
      setReloadKey((k) => k + 1)
      say(r.applied ? `已删「${name}」，${r.applied} 个 skill 回到未分类` : `已删「${name}」`)
    },
    [say]
  )

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

  const globalDir = useMemo(() => dirs.find((d) => d.id === dirId) ?? null, [dirs, dirId])

  const sections: SkillSection[] = useMemo(
    () =>
      planSkillSections({
        projectName: selectedProject?.name,
        projectPath: selectedProject ? projectSkillDir(selectedProject.path) : null,
        globalLabel: globalDir?.label,
        globalPath: globalDir?.path
      }),
    [selectedProject, globalDir]
  )

  /** 拉取的依赖只看路径集合——sections 是每次渲染新算的数组，直接进依赖会无限重拉。 */
  const sectionKey = sections.map((s) => s.path).join('\n')

  useEffect(() => {
    setExpandedSkill(null)
    setCollapsedCats(new Set())
    const paths = sectionKey ? sectionKey.split('\n') : []
    if (paths.length === 0) {
      setResults({})
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void Promise.all(paths.map((p) => window.api.skillLibrary.list(p))).then((list) => {
      if (!alive) return
      const next: Record<string, SkillListResult> = {}
      paths.forEach((p, i) => {
        next[p] = list[i]
      })
      setResults(next)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // reloadKey 是复制/禁用之后的手动重拉
  }, [sectionKey, reloadKey])

  // agent 通过 MCP 改了分类 → 面板重拉一次。不这么做的话用户得手动切个目录才看得到变化，
  // 而「让 agent 整理分类」这件事的整个价值就在于他抬头就能看见结果。
  useEffect(() => {
    const h = (): void => setReloadKey((k) => k + 1)
    window.addEventListener('skills-changed', h)
    return () => window.removeEventListener('skills-changed', h)
  }, [])

  /** 分类折叠 key 带段前缀：两段可能有同名分类（「未分类」几乎必然同时存在），
   *  不加前缀的话折叠上面那段会把下面同名的一起折了。 */
  const toggleCat = (key: string): void => {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSec = (key: string): void => {
    setCollapsedSecs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
  // （目标必须是已登记的 skill 目录或某个项目的 .claude/skills），这里不重复判断，
  // 只负责把结果讲给人听。
  const pasteInto = async (destPath: string): Promise<void> => {
    if (!clip) return
    const r = await window.api.skillLibrary.copySkill(clip.path, destPath)
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

  /** 禁用清单跨段合并：一个 skill 在哪一段被禁用，判据都是它自己的绝对路径。 */
  const disabledSet = useMemo(() => {
    const s = new Set<string>()
    for (const r of Object.values(results)) for (const p of r.disabled) s.add(p)
    return s
  }, [results])

  const disabledCount = useMemo(
    () => Object.values(results).reduce((n, r) => n + r.disabled.length, 0),
    [results]
  )
  const totalSkills = useMemo(
    () => Object.values(results).reduce((n, r) => n + r.skills.length, 0),
    [results]
  )

  const activeDirEntry = globalDir
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

  /** 右键菜单的内容。点在 skill 上多几项（复制 / 禁用 / 在访达中显示），空白处只有粘贴。
   *  粘贴的落点是 destPath：点在哪一段的地盘上就粘到哪一段——两段并存之后，
   *  「粘到当前目录」已经不是一个明确的说法了。 */
  const menuItems = (skill: SkillInfo | null, destPath: string | null): CanvasMenuItem[] => {
    const items: CanvasMenuItem[] = []
    if (skill) {
      const off = disabledSet.has(skill.path)
      items.push({
        label: '复制',
        icon: <CopyIcon size={12} />,
        onClick: () => {
          setClip({ path: skill.path, name: skill.name })
          say(`已复制「${skill.name}」，在目标那段的空白处右键粘贴`)
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
    const destSec = sections.find((s) => s.path === destPath)
    items.push(
      clip
        ? {
            label: `粘贴 skill「${clip.name}」`,
            hint: destSec ? `复制到${destSec.tag} · ${destSec.label}` : '先在某一段里右键',
            disabled: !destPath,
            onClick: () => void (destPath && pasteInto(destPath))
          }
        : { label: '粘贴 skill', hint: '还没复制任何 skill', disabled: true, onClick: () => {} }
    )
    return items
  }

  /** 一段的正文：分类分组 + skill 列表。段头由外层画，这里只管内容。 */
  const renderSectionBody = (sec: SkillSection): JSX.Element => {
    const result = results[sec.path]
    if (!result) return <div className="wk-dim wk-tiny wk-pad">加载中…</div>
    if (!result.ok) {
      return (
        <div className="wk-warn">
          {result.error}
          <br />
          <span className="wk-dim wk-tiny">{sec.path}</span>
        </div>
      )
    }
    if (result.skills.length === 0) {
      return (
        <div className="wk-dim wk-tiny wk-pad">
          {sec.scope === 'project' ? '这个项目还没有项目 skill' : '这个目录下没有找到 skill'}
          <br />
          没有子目录带 SKILL.md
          <br />
          <span className="skl-path">{sec.path}</span>
        </div>
      )
    }
    return (
      <>
        {result.categories.map((cat) => {
          const catKey = `${sec.key}\n${cat.name}`
          const collapsed = collapsedCats.has(catKey)
          return (
            <div
              className={`skl-cat${dropCat === catKey ? ' dropping' : ''}`}
              key={catKey}
              // 整个分类块都是落点（不只是标题那一行）—— 拖到一半松手落在下面的
              // 卡片上是很自然的动作，只认标题会让人以为「拖不进去」。
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropCat(catKey)
              }}
              onDragLeave={(e) => {
                // 只有真的离开这一块才清高亮：在内部子元素之间移动也会触发 dragleave
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setDropCat((c) => (c === catKey ? null : c))
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDropCat(null)
                const path = dragging
                setDragging(null)
                if (!path) return
                // 拖回「未分类」= 清掉分类并解锁，不是归到一个叫「未分类」的分类
                void assign(path, cat.name === UNCATEGORIZED ? null : cat.name)
              }}
            >
              <div className="skl-cat-head-row">
                <button className="skl-cat-head" onClick={() => toggleCat(catKey)}>
                  <span className={`skl-chevron${collapsed ? '' : ' open'}`}>
                    <ChevronRightIcon size={10} />
                  </span>
                  <span className="skl-cat-name">{cat.name}</span>
                  <span className="skl-cat-count">{cat.skillPaths.length}</span>
                </button>
                {/* 「未分类」是兜底的桶，不是用户建的分类，删不得 */}
                {cat.name !== UNCATEGORIZED && (
                  <button
                    className="skl-cat-x"
                    data-tip="删掉这个分类（里面的 skill 回到未分类，不会被删）"
                    onClick={() => void removeCategory(cat.name)}
                  >
                    <CloseIcon size={10} />
                  </button>
                )}
              </div>
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
                          e.stopPropagation() // 别让外面那层再开一个只有「粘贴」的菜单
                          setMenu({ x: e.clientX, y: e.clientY, skill: sk, destPath: sec.path })
                        }}
                      >
                        <button
                          className="skl-item-head"
                          // 拖头部而不是整张卡：展开后卡里挂着文件树，那棵树自己
                          // 也要拖（拖文件到画布），两套拖拽不能抢同一块区域。
                          draggable
                          onDragStart={(e) => {
                            setDragging(sk.path)
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', sk.path)
                          }}
                          onDragEnd={() => {
                            setDragging(null)
                            setDropCat(null)
                          }}
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
                              // 第三个参数是「没拖动，只是点了一下」的回调（5px 阈值内）
                              startFileDrag(fp, e, () => setLightbox(fp))
                            }}
                            // 单击那条通常已经把灯箱开起来了，第二击会落在灯箱外的遮罩上，
                            // 于是这个 handler 多数时候走不到。留着是为了兜住「灯箱还没挂载完
                            // 第二击就到了」的时序 —— 两条路结果一致，都是开灯箱。
                            onDoubleClick={(e) => {
                              const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                              const fp = item?.dataset.path
                              if (!fp || item?.dataset.dir) return
                              setLightbox(fp)
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
      </>
    )
  }

  return (
    <div
      className="skl-panel"
      onContextMenu={(e) => {
        // 面板真空白处右键（不在任何段里）→ 只出「粘贴」，落点用第一段。
        // 第一段在有项目时就是项目段，正好是「把全局 skill 复制进这个项目」这个
        // 最常见用法的目标（design 文档 §五）。
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, skill: null, destPath: sections[0]?.path ?? null })
      }}
    >
      <div className="skl-toolbar">
        <button className="skl-cli-btn" onClick={openDirMenu} data-tip={globalDir?.path}>
          <span>{globalDir?.label ?? '选择目录'}</span>
          <span className={`skl-chevron${dirMenuAt ? ' open' : ''}`}>
            <ChevronRightIcon size={10} />
          </span>
        </button>
        {/* 分类是**全局的**（不属于某个目录/某一段），所以入口在工具栏而不是段头 ——
            段头只在项目段和全局段并存时才出现，放那儿单段时就没有入口了。 */}
        <button
          className="skl-newcat-btn"
          data-tip="新建一个分类，然后把 skill 拖进去"
          onClick={() => {
            setNewCat(true)
            setNewCatName('')
          }}
        >
          <PlusIcon size={12} />
        </button>
      </div>
      {newCat && (
        <div className="skl-newcat">
          <input
            className="skl-newcat-input"
            autoFocus
            value={newCatName}
            placeholder="分类名，回车建好"
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              // 输入法拼字途中的回车是「选词」，不是「提交」——不挡的话建出一个半截名字
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                void addCategory(newCatName)
                setNewCat(false)
              } else if (e.key === 'Escape') setNewCat(false)
            }}
            onBlur={() => setNewCat(false)}
          />
        </div>
      )}
      {dirMenuAt && (
        <CanvasContextMenu x={dirMenuAt.x} y={dirMenuAt.y} items={dirMenuItems} onClose={() => setDirMenuAt(null)} />
      )}
      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.skill, menu.destPath)}
          onClose={() => setMenu(null)}
        />
      )}
      {notice && <div className={`skl-notice${notice.bad ? ' bad' : ''}`}>{notice.text}</div>}
      {!!clip && (
        <div className="skl-clip">
          剪贴板：<b>{clip.name}</b> · 在目标那段的空白处右键粘贴
          <button className="skl-clip-x" data-tip="清掉" onClick={() => setClip(null)}>
            ×
          </button>
        </div>
      )}

      {loading && <div className="wk-dim wk-tiny wk-pad">加载中…</div>}

      {/* 禁用的代价必须摆在明面上：CLI 自己仍然会加载它，这个开关只改本软件的视图。
          用户已经知情并接受（design 文档 §六 第 1 条），但不写出来的话，
          下一次他会以为点了禁用 Claude Code 那边就不加载了。
          只在真有被禁用的 skill 时出现——没禁过任何东西的人不需要看这句话。 */}
      {!loading && disabledCount > 0 && (
        <div className="skl-note">
          划掉的 {disabledCount} 个只在这个软件里禁用了 —— CLI 自己仍然会加载它们
          （禁用不动硬盘上的文件）
        </div>
      )}

      {!loading &&
        sections.map((sec) => {
          const collapsed = collapsedSecs.has(sec.key)
          const r = results[sec.path]
          return (
            <div
              className={`skl-sec skl-sec-${sec.scope}`}
              key={sec.key}
              onContextMenu={(e) => {
                // 段内空白处右键 → 粘到这一段。落在 skill 行上的由那一行自己 stopPropagation 掉了。
                e.preventDefault()
                e.stopPropagation()
                setMenu({ x: e.clientX, y: e.clientY, skill: null, destPath: sec.path })
              }}
            >
              {/* 单段时不画段头：工具栏那个按钮已经写着目录名了，再来一行是重复。
                  两段并存才需要标注谁是谁——那正是用户要的「标注清楚」。 */}
              {sections.length > 1 && (
                <button className="skl-sec-head" onClick={() => toggleSec(sec.key)} data-tip={sec.path}>
                  <span className={`skl-chevron${collapsed ? '' : ' open'}`}>
                    <ChevronRightIcon size={10} />
                  </span>
                  <span className={`skl-sec-tag ${sec.scope}`}>{sec.tag}</span>
                  <span className="skl-sec-name">{sec.label}</span>
                  {!!r?.ok && <span className="skl-sec-count">{r.skills.length}</span>}
                </button>
              )}
              {/* 滚动容器包住**全部四种状态**（加载中 / 错误 / 空态 / 列表）。
                  原来只有列表那一支自己开 .skl-list，另外三支裸着 —— 而 .skl-sec 是
                  可压缩的 flex 子项且 overflow:visible，段被挤扁时那三支的内容
                  既不裁剪也不滚动，直接画到下一段的段头上（项目目录不存在时那段
                  长路径最明显，实测溢出 101px、和下一个段头重叠 89px）。 */}
              {!collapsed && <div className="skl-list">{renderSectionBody(sec)}</div>}
            </div>
          )
        })}

      {!loading && sections.length === 0 && (
        <div className="wk-dim wk-tiny wk-pad">还没有任何 skill 目录，点上面的按钮添加一个</div>
      )}
      {!loading && sections.length > 0 && totalSkills === 0 && sections.length > 1 && (
        <div className="wk-dim wk-tiny wk-pad">这两处都还没有 skill</div>
      )}
      {htmlChoice}
      {!!lightbox && (
        <FileLightbox
          filePath={lightbox}
          onClose={() => setLightbox(null)}
          saveVia={window.api.skillLibrary.writeFile}
          onSendToCanvas={(fp) => {
            const { wx, wy } = viewportCenter()
            openInCanvas(fp, wx - 90, wy - 15)
          }}
        />
      )}
    </div>
  )
}
