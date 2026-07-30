// 个人知识库：一个用户自选位置的 markdown 文件夹。
//
// 设计依据是 Karpathy 的 LLM wiki 模式（原文存档在 docs/reference/karpathy-llm-wiki.md）：
// 不做 RAG，让 agent 把原始素材「编译」成互相链接的笔记，并持续维护。
// 三层：原始素材（不可变）/ wiki（agent 全权拥有）/ schema（CLAUDE.md + AGENTS.md）。
//
// 这个文件现在**只做 IPC 编排**，具体实现分在四块里：
//   paths.ts   位置与盘上形态（在哪、有几个）
//   schema.ts  库内约定文件与建骨架（写给 agent 看的规矩）
//   git.ts     快照与回滚（AI 动用户文件唯一的整体撤销手段）
//   scan.ts    扫全库笔记（图谱和体检共用同一份数据）
// 「agent 什么时候该来查」那套规则在 agentRules.ts。
import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'

import type {
  WikiInboxItem,
  Backlink,
  WikiHit,
  ArchiveItem,
  WikiCommit,
  WikiGraph,
  LintFinding,
  WikiStats
} from '../../shared/types'

import {
  INBOX,
  cfgFile,
  inboxOf,
  sourcesOf,
  transcriptsOf,
  SOURCES,
  TRANSCRIPTS,
  WIKI_DIRS,
  isMd,
  setWikiPath,
  walkNotes,
  wikiPath,
  wikiStatus
} from './paths'
import { dirNames, initWiki, uniqueName } from './schema'
import { MARK, commitAll, git, gitOk, isDirty, isRepo } from './git'
import { scanNotes } from './scan'

// 上游还从这里取这两个（agentRules 要知道库在哪，index 要注册 handler）
export { wikiPath, wikiStatus }

/**
 * 启动时把已配置的库对齐到当前版本：补上新增的目录、把约定文件升到最新 schema。
 *
 * 为什么要有这一步：initWiki 只在「建库」和「换位置」时跑，于是升级 app 之后
 * 老库里不会出现新加的目录（比如 me/），说明文件也停在旧版本 —— 而用户完全没有
 * 理由知道自己该去点一下「换个位置」。
 *
 * 两条保险：
 *   · initWiki 是幂等的（已存在的目录和文件一律不动），所以重复跑安全
 *   · **只对「看起来确实是个知识库」的目录动手**（looksEmpty 为 false）。
 *     否则一旦绑错路径或网络卷读不出来，这里就会往一个不相干的目录里撒骨架文件。
 *
 * 不再调 syncRules()：知识库已经不往任何全局文件里写东西了（见 agentRules.ts
 * 顶部注释——那条路本身就是「换个终端也读得到」的洞），wiki_query 每次都当场
 * 读盘，没有「规则过期需要重新同步」这回事。
 */
function reconcileOnStartup(): void {
  try {
    const st = wikiStatus()
    if (!st.configured || !st.exists || st.looksEmpty) return
    initWiki(st.path!)
  } catch (e) {
    console.error('[wiki] 启动对齐失败（不影响使用）', e)
  }
}

export function registerWikiHandlers(): void {
  reconcileOnStartup()

  /**
   * 知识图谱：节点=笔记，边=[[双链]]。
   *
   * 卡帕西原话说 Obsidian 的图谱是「看清 wiki 形状最好的方式 —— 什么连着什么、
   * 哪些是枢纽、哪些是孤儿」。注意他说的用途是**看形状**，不是日常查询，
   * 所以这块和体检放在一起做（孤儿页正是体检要处理的东西）。
   */
  ipcMain.handle('wiki:graph', (): WikiGraph => {
    const root = wikiPath()
    if (!root) return { nodes: [], edges: [] }
    const notes = scanNotes(root)
    const byTitle = new Map(notes.map((n) => [n.title, n.rel]))
    const inbound = new Map<string, number>()
    const edges: { from: string; to: string }[] = []
    for (const n of notes) {
      for (const l of new Set(n.links)) {
        const target = byTitle.get(l)
        if (!target || target === n.rel) continue // 死链不画（体检会单独报）
        edges.push({ from: n.rel, to: target })
        inbound.set(target, (inbound.get(target) ?? 0) + 1)
      }
    }
    return {
      nodes: notes.map((n) => ({
        id: n.rel,
        title: n.title,
        tags: n.tags,
        inbound: inbound.get(n.rel) ?? 0,
        outbound: new Set(n.links.filter((l) => byTitle.has(l))).size
      })),
      edges
    }
  })

  /**
   * 体检的**结构部分**。
   *
   * 分工要说清楚：矛盾、过期结论这些需要真读懂内容，那是 agent 的活；
   * 这里只做纯结构检查 —— 免费、瞬时、结果确定。
   * agent 拿到这份清单后再去做语义那半边，不用自己先把整个库扫一遍。
   */
  ipcMain.handle('wiki:lint', (): LintFinding[] => {
    const root = wikiPath()
    if (!root) return []
    const notes = scanNotes(root)
    const byTitle = new Map(notes.map((n) => [n.title, n.rel]))
    const inbound = new Map<string, number>()
    for (const n of notes)
      for (const l of new Set(n.links))
        if (byTitle.has(l) && byTitle.get(l) !== n.rel)
          inbound.set(byTitle.get(l)!, (inbound.get(byTitle.get(l)!) ?? 0) + 1)

    const out: LintFinding[] = []
    const SKIP = new Set(['index', 'log', '从这里开始'])
    const now = Date.now()
    for (const n of notes) {
      if (SKIP.has(n.title)) continue
      // 死链：写了 [[X]] 但库里没有 X。最该先修的一类——它是「本该有页却还没写」的信号
      for (const l of new Set(n.links)) {
        if (!byTitle.has(l))
          out.push({ kind: 'deadlink', file: n.rel, detail: `[[${l}]] 指向的笔记不存在`, hint: '要么建这一页，要么改掉链接' })
      }
      if (!n.summary)
        out.push({ kind: 'nosummary', file: n.rel, detail: '缺 summary', hint: 'agent 靠它判断相关性，缺了这个库一过百篇就没法用' })
      if (!n.tags.length) out.push({ kind: 'notags', file: n.rel, detail: '缺 tags', hint: '同上' })
      if (!(inbound.get(n.rel) ?? 0))
        out.push({ kind: 'orphan', file: n.rel, detail: '没有任何笔记链接到它', hint: '要么从相关笔记连过来，要么它本来就该被合并掉' })
      const days = Math.floor((now - n.mtime) / 86400000)
      if (days > 180)
        out.push({ kind: 'stale', file: n.rel, detail: `${days} 天没动过`, hint: '看看还成不成立，或者有没有被新素材推翻' })
      if (n.bodyChars < 80)
        out.push({ kind: 'thin', file: n.rel, detail: `正文只有 ${n.bodyChars} 字`, hint: '要么写完，要么并进别的页' })
    }
    // index.md 该收录却没收录的
    try {
      const idx = fs.readFileSync(path.join(root, 'index.md'), 'utf8')
      // 聚合成一条：漏收通常是成片发生的（比如索引一直没人维护），
      // 逐条列出来就是几十行一模一样的内容，没人看得下去
      const miss = notes.filter((n) => !SKIP.has(n.title) && !idx.includes(n.title))
      if (miss.length)
        out.push({
          kind: 'noindex',
          file: 'index.md',
          detail: `${miss.length} 篇没进索引：${miss.slice(0, 6).map((n) => n.title).join('、')}${miss.length > 6 ? ' 等' : ''}`,
          hint: '索引是 agent 回答问题时唯一先读的东西，漏了等于这几页不存在'
        })
    } catch {
      /* 没有 index.md */
    }
    return out
  })

  /**
   * 往 log.md 追加一条。格式固定成 `## [日期] 动作 | 标题`，
   * 这样 `grep "^## \[" log.md | tail -5` 能直接看最近动静（原文给的技巧）。
   * 同时它也是「放入 vs 查询」统计的唯一数据源。
   */
  ipcMain.handle('wiki:log', (_e, action: string, title: string) => {
    const root = wikiPath()
    if (!root) return { ok: false }
    const act = ['ingest', 'query', 'lint'].includes(String(action)) ? String(action) : 'query'
    try {
      const f = path.join(root, 'log.md')
      const day = new Date().toISOString().slice(0, 10)
      const line = `\n## [${day}] ${act} | ${String(title).replace(/\n/g, ' ').slice(0, 120)}\n`
      fs.appendFileSync(f, line)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  /**
   * 放入 vs 查询。
   *
   * 这是「这东西是不是变成了数字仓鼠窝」的唯一判据：
   * 一个月后如果放 100 次问 3 次，说明它没长成工具、只长成了仓库。
   * 数据来自 log.md（agent 按约定记）+ 我们自己记的放入次数，两边都不完美，
   * 但方向足够说明问题。
   */
  ipcMain.handle('wiki:stats', (): WikiStats => {
    const root = wikiPath()
    const empty = { added: 0, ingest: 0, query: 0, lint: 0, notes: 0 }
    if (!root) return empty
    let ingest = 0
    let query = 0
    let lint = 0
    try {
      for (const l of fs.readFileSync(path.join(root, 'log.md'), 'utf8').split('\n')) {
        const m = /^## \[[\d-]+\]\s*(\w+)/.exec(l.trim())
        if (!m) continue
        if (m[1] === 'ingest') ingest++
        else if (m[1] === 'query') query++
        else if (m[1] === 'lint') lint++
      }
    } catch {
      /* 没有 log.md */
    }
    let added = 0
    try {
      added = Number(
        (JSON.parse(fs.readFileSync(cfgFile(), 'utf8') || '{}') as { added?: number }).added ?? 0
      )
    } catch {
      added = 0
    }
    return { added, ingest, query, lint, notes: walkNotes(root).length }
  })

  ipcMain.handle('wiki:gitInit', () => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    try {
      if (!isRepo(root)) {
        git(root, ['init'])
        // **收件箱绝不能 gitignore。**
        // 曾经这么写过（理由是「大视频不该进版本库」），结果是个会毁文件的洞：
        // 归档把文件从「不受管的收件箱」搬进「受管的素材/」，回滚时 git 会把它从
        // 素材/ 删掉，而收件箱里早就没有了 —— 文件彻底消失。
        // 而且那个理由本身不成立：同一批大文件归档后照样进 素材/ 并被跟踪，
        // 忽略收件箱一个字节都没省下，只换来了这个洞。
        const ig = path.join(root, '.gitignore')
        if (!fs.existsSync(ig)) fs.writeFileSync(ig, '.DS_Store\n.eas-sources.json\n')
      }
      const sha = commitAll(root, '初始化')
      return { ok: true, sha, status: wikiStatus() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 归档前的快照：把当前状态先落一个提交，回滚就退到这里 */
  ipcMain.handle('wiki:snapshot', (_e, label: string) => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return { ok: false, error: '知识库还没用 git 管起来' }
    const sha = commitAll(root, `归档前快照 · ${label}`)
    return sha ? { ok: true, sha } : { ok: false, error: '快照失败' }
  })

  ipcMain.handle('wiki:commit', (_e, message: string) => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return { ok: false, error: '知识库还没用 git 管起来' }
    const sha = commitAll(root, message)
    return sha ? { ok: true, sha } : { ok: false, error: '提交失败' }
  })

  ipcMain.handle('wiki:history', (_e, limit = 20): WikiCommit[] => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return []
    try {
      return git(root, ['log', `-${limit}`, '--pretty=format:%H\u0001%at\u0001%s'])
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [sha, at, subject] = l.split('\u0001')
          return { sha, at: Number(at) * 1000, subject, mine: subject.startsWith(MARK) }
        })
    } catch {
      return []
    }
  })

  /** 一键回滚到某个提交。**只在我们自己打的提交之间用**，且会先把当前状态另存一个提交，
   *  这样「回滚」本身也是可撤销的——用户后悔了还能再回来。 */
  ipcMain.handle('wiki:rollback', (_e, sha: string) => {
    const root = wikiPath()
    if (!root || !isRepo(root)) return { ok: false, error: '知识库还没用 git 管起来' }
    try {
      commitAll(root, '回滚前保留现场')
      git(root, ['reset', '--hard', sha])
      return { ok: true, status: wikiStatus() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * 执行归档的**文件搬运**部分：把收件箱里的原件挪到 素材/<年月>/。
   * 写笔记是 agent 的活，这里只负责搬得安全：
   *   · 只移动，不删除、不覆盖（重名加后缀）
   *   · 目标固定在 素材/ 下，不接受任意路径 —— 防止一个坏计划把文件扔到库外
   */
  ipcMain.handle('wiki:archive', (_e, items: ArchiveItem[]) => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    const ym = new Date().toISOString().slice(0, 7)
    // 目录名按这个库盘上的实际情况取（新库英文、老库中文），不能写死
    const inbox = inboxOf(root)
    const sources = sourcesOf(root)
    const destDir = path.join(root, sources, ym)
    const moved: { from: string; to: string }[] = []
    const failed: { name: string; error: string }[] = []
    try {
      fs.mkdirSync(destDir, { recursive: true })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    for (const it of items ?? []) {
      const name = path.basename(String(it?.name ?? ''))
      if (!name) continue
      const src = path.join(root, inbox, name)
      try {
        if (!fs.existsSync(src)) {
          failed.push({ name, error: '收件箱里没有这个文件' })
          continue
        }
        // 允许 agent 指定新名字，但只取 basename —— 不接受任何路径成分
        const want = path.basename(String(it.rename || name))
        const finalName = uniqueName(destDir, want)
        fs.renameSync(src, path.join(destDir, finalName))
        moved.push({ from: `${inbox}/${name}`, to: `${sources}/${ym}/${finalName}` })
        // 逐字稿跟着走：它是这份素材的一部分，留在收件箱里会变成孤儿
        try {
          const tSrc = path.join(root, inbox, transcriptsOf(path.join(root, inbox)), name + '.txt')
          if (fs.existsSync(tSrc)) {
            const tDir = path.join(destDir, 'transcripts')
            fs.mkdirSync(tDir, { recursive: true })
            fs.renameSync(tSrc, path.join(tDir, uniqueName(tDir, finalName + '.txt')))
          }
        } catch {
          /* 逐字稿搬不动不影响主文件已经归位 */
        }
      } catch (e) {
        failed.push({ name, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return { ok: true, moved, failed, status: wikiStatus() }
  })

  ipcMain.handle('wiki:status', () => wikiStatus())

  /**
   * 知识库内容离开本机进程边界的**唯一**通道，供 MCP 工具 wiki_query 调用。
   *
   * 这个 handler 本身不做任何「是不是 Eas-Term 会话」的判断——它信任调用方，
   * 因为真正的门禁在更上游：mcp/eas-mcp.mjs 的 tools/list 只在检测到
   * EAS_TERM_PORT/TOKEN（PTY 创建时才会注入）时才把 wiki_query 列出来。
   * 能调到这里，就已经证明是合法的 Eas-Term 终端会话。
   *
   * 每次都当场读盘，不缓存——换位置、建库、解绑立即生效，没有「规则过期」这回事。
   */
  ipcMain.handle('wiki:query', () => {
    const st = wikiStatus()
    if (!st.configured || !st.exists || st.looksEmpty) {
      return { configured: st.configured, exists: st.exists, looksEmpty: st.looksEmpty }
    }
    let index = ''
    try {
      index = fs.readFileSync(path.join(st.path!, 'index.md'), 'utf8')
    } catch {
      /* 没有 index.md 就空着，模型会自己判断"索引里没有" */
    }
    return { configured: true, exists: true, looksEmpty: false, path: st.path, index, dirs: dirNames(st.path!) }
  })

  ipcMain.handle('wiki:pickPath', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择知识库位置',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '就用这里'
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  /** 默认建议位置。两条硬约束：
   *  1. 绝不放 app 内部 —— 卸载或升级会连人带货一起没
   *  2. **不带空格、不带中文** —— 这个路径会被拼进 shell 命令、agent 规则、脚本参数，
   *     带空格就得处处记得加引号，漏一处就出错（本项目被 `vibe coding` 那个空格
   *     坑掉过 node-pty 编译）。老的默认值是「Eas 知识库」，正是空格的来源。 */
  ipcMain.handle('wiki:suggestPath', () => path.join(app.getPath('documents'), 'eas-wiki'))

  /** 收件箱的「＋」入口：多选文件。拖拽之外必须有这个——不习惯拖的人也得进得来 */
  ipcMain.handle('wiki:pickFiles', async (): Promise<string[]> => {
    const r = await dialog.showOpenDialog({
      title: '选择要放进收件箱的文件',
      properties: ['openFile', 'multiSelections'],
      buttonLabel: '放进收件箱'
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('wiki:init', (_e, root: string) => {
    if (!root || !path.isAbsolute(root)) return { ok: false, error: '需要绝对路径' }
    try {
      const r = initWiki(root)
      setWikiPath(root)
      return { ok: true, ...r, status: wikiStatus() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('wiki:forget', () => {
    // 只忘掉位置，不删任何文件 —— 用户的笔记不该因为一次点击消失
    setWikiPath(null)
    return wikiStatus()
  })

  ipcMain.handle('wiki:reveal', (_e, sub?: string) => {
    const p = wikiPath()
    if (!p) return
    const target = sub ? path.join(p, sub) : p
    shell.openPath(target)
  })

  /**
   * 往收件箱放文件。**默认复制不移动** —— 移动会让用户原来放文件的地方东西没了，
   * 这是最容易挨骂的一类操作。来源路径记在旁边的 .source 里，归档时能追溯。
   */
  ipcMain.handle('wiki:addToInbox', async (_e, files: string[], move = false) => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    const dir = path.join(root, inboxOf(root))
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* 已存在 */
    }
    const done: string[] = []
    const failed: { file: string; error: string }[] = []
    const srcFile = path.join(dir, SOURCES)
    let sources: Record<string, string> = {}
    try {
      sources = JSON.parse(fs.readFileSync(srcFile, 'utf8')) as Record<string, string>
    } catch {
      sources = {}
    }
    for (const f of files) {
      try {
        const st = await fs.promises.stat(f)
        if (st.isDirectory()) {
          failed.push({ file: f, error: '暂不支持整个文件夹' })
          continue
        }
        const name = uniqueName(dir, path.basename(f))
        const dest = path.join(dir, name)
        if (move) await fs.promises.rename(f, dest)
        else await fs.promises.copyFile(f, dest)
        // 记来源：归档写笔记时 front-matter 的 source 就有出处，不靠猜。
        // 用一份隐藏的映射表而不是每个文件一个 .source 旁车——
        // 旁车会在访达里和原文件并排显示，把收件箱弄得很脏（而且会被数进徽章）
        sources[name] = f
        done.push(name)
      } catch (e) {
        failed.push({ file: f, error: e instanceof Error ? e.message : String(e) })
      }
    }
    // 记一笔「放入」次数：和 log.md 里的 query 次数一起构成「仓鼠窝判据」
    try {
      const cur = JSON.parse(fs.readFileSync(cfgFile(), 'utf8') || '{}') as Record<string, unknown>
      cur.added = Number(cur.added ?? 0) + done.length
      fs.writeFileSync(cfgFile(), JSON.stringify(cur, null, 2))
    } catch {
      /* 统计失败无所谓，不影响文件已经放进来 */
    }
    try {
      fs.writeFileSync(srcFile, JSON.stringify(sources, null, 2))
    } catch {
      /* 来源表写不进去不影响文件已经放进来这件事 */
    }
    // inboxDir 一并返回：调用方要拼刚放进来那些文件的完整路径（比如排队转录）。
    // 让它自己去拼目录名的话，新库（00-inbox）和老库（00-收件箱）必须各猜一次，
    // 猜错就是静默失败——这里现成算过了，直接给出去。
    return { ok: true, done, failed, inboxDir: inboxOf(root), status: wikiStatus() }
  })

  ipcMain.handle('wiki:inbox', (): WikiInboxItem[] => {
    const root = wikiPath()
    if (!root) return []
    const dir = path.join(root, inboxOf(root))
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.'))
        .map((d) => {
          const full = path.join(dir, d.name)
          let size = 0
          let at = 0
          try {
            const st = fs.statSync(full)
            size = st.size
            at = st.birthtimeMs || st.mtimeMs
          } catch {
            /* 读不到就给 0 */
          }
          return { name: d.name, path: full, isDir: d.isDirectory(), size, at }
        })
        .sort((a, b) => a.at - b.at) // 最早的排前面：要处理的正是它
    } catch {
      return []
    }
  })

  /**
   * 全库搜索：标题 + summary + 正文。
   *
   * 不做索引、不做向量——按原文给的刻度，几百篇之内直接扫就够快，
   * 「省掉了整套 embedding RAG 基建」。真越过那个规模再接 qmd（本地混合搜索，
   * 同时提供 CLI 和 MCP server，agent 和界面都能用）。
   */
  ipcMain.handle('wiki:search', (_e, q: string, limit = 40): WikiHit[] => {
    const root = wikiPath()
    const query = String(q ?? '').trim().toLowerCase()
    if (!root || query.length < 1) return []
    const out: WikiHit[] = []
    for (const rel of walkNotes(root)) {
      if (out.length >= limit) break
      const title = path.basename(rel, path.extname(rel))
      let text = ''
      try {
        text = fs.readFileSync(path.join(root, rel), 'utf8')
      } catch {
        continue
      }
      const low = text.toLowerCase()
      const inTitle = title.toLowerCase().includes(query)
      const at = low.indexOf(query)
      if (!inTitle && at < 0) continue
      // 命中处的上下文：标题命中就给 summary，正文命中就给那一行
      let snippet = ''
      if (at >= 0) {
        const s0 = low.lastIndexOf('\n', at) + 1
        const e0 = low.indexOf('\n', at)
        snippet = text.slice(s0, e0 < 0 ? text.length : e0).trim().slice(0, 140)
        // 命中落在 front-matter 的字段行上时，把 `summary:` 这类前缀去掉——
        // 列表里显示 "summary: xxx" 是把实现细节漏给用户看
        snippet = snippet.replace(/^\w+:\s*/, '')
      } else {
        const m = /^summary:\s*(.+)$/m.exec(text)
        snippet = (m?.[1] ?? '').trim().slice(0, 140)
      }
      // 标题命中排前面：找笔记时通常是记得名字
      out.push({ file: rel, title, snippet, titleHit: inTitle })
    }
    out.sort((a, b) => Number(b.titleHit) - Number(a.titleHit))
    return out
  })

  /** 换位置：只改指向，**不搬文件也不删文件**——搬家的决定该由用户在访达里做 */
  ipcMain.handle('wiki:setPath', (_e, root: string) => {
    if (!root || !path.isAbsolute(root)) return { ok: false, error: '需要绝对路径' }
    // **必须拦住不存在的目录。** 以前这里照收，于是绑到一个打错的路径上之后，
    // 界面显示的是「知识库是空的」——和「文件真的被删了」长得一模一样。
    // 真实踩过：路径少了一个空格，人以为整个知识库丢了。
    // 建新库走 wiki:init（它负责创建），这个接口只管「指向一个已经存在的库」。
    try {
      if (!fs.statSync(root).isDirectory()) return { ok: false, error: '这不是一个文件夹' }
    } catch {
      return { ok: false, error: `这个路径不存在：${root}` }
    }
    setWikiPath(root)
    return { ok: true, status: wikiStatus() }
  })

  /**
   * 反向链接：谁引用了这一篇。
   * 全库扫一遍 [[链接]] —— 几百篇的规模下这点 IO 可以忽略，
   * 上千篇再谈索引缓存（那时候本来也该接 qmd 了）。
   */
  /**
   * 存逐字稿。
   *
   * 落点是**收件箱里的隐藏目录**，不是 wiki 正文区 —— 两个理由：
   *   1. 转录是「预处理」，按定的纪律它是自动跑的，而自动的部分不该往 wiki 里写东西
   *   2. 三万字逐字稿是中间产物不是知识，直接进知识库等于污染
   * 点号开头 → 访达里看不见、也不会被数进收件箱徽章。
   * 归档时它会跟着媒体文件一起搬进 素材/。
   */
  ipcMain.handle('wiki:saveTranscript', (_e, mediaName: string, text: string) => {
    const root = wikiPath()
    if (!root) return { ok: false, error: '还没设置知识库位置' }
    try {
      const inbox = inboxOf(root)
      const dir = path.join(root, inbox, transcriptsOf(path.join(root, inbox)))
      fs.mkdirSync(dir, { recursive: true })
      const f = path.join(dir, path.basename(String(mediaName)) + '.txt')
      fs.writeFileSync(f, text)
      return { ok: true, path: f, rel: path.relative(root, f) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 读某个收件箱条目的逐字稿（agent 归档时用它来写笔记） */
  ipcMain.handle('wiki:transcript', (_e, mediaName: string): string | null => {
    const root = wikiPath()
    if (!root) return null
    try {
      const inbox = inboxOf(root)
      return fs.readFileSync(
        path.join(root, inbox, transcriptsOf(path.join(root, inbox)), path.basename(String(mediaName)) + '.txt'),
        'utf8'
      )
    } catch {
      return null
    }
  })

  ipcMain.handle('wiki:backlinks', (_e, target: string): Backlink[] => {
    const root = wikiPath()
    if (!root) return []
    // [[链接]] 里写的通常是标题（不带扩展名），也允许写相对路径
    const stem = path.basename(target, path.extname(target))
    const out: Backlink[] = []
    for (const rel of walkNotes(root)) {
      if (path.basename(rel, path.extname(rel)) === stem) continue // 自己不算
      let text: string
      try {
        text = fs.readFileSync(path.join(root, rel), 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // [[标题]] 或 [[标题|显示名]]、[[路径/标题]]
        for (const m of lines[i].matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
          const nameOnly = path.basename(m[1].trim())
          if (nameOnly === stem || m[1].trim() === stem) {
            out.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160) })
            break
          }
        }
      }
    }
    return out
  })
}

