# 用户数据丢失场景排查（data-safety）

> 只读调研，**未改任何代码**。范围：`src/main/` 下所有覆盖/删除用户数据的路径，
> 以及触发它们的渲染层调用点。排序 ＝ 丢了多难受 × 多容易触发。

## 一句话结论

8-20 事故的补丁（canvas 缩水时备份）挡住的是**那一下**，没挡住同类的另一半。
最该先修的不是新增备份，而是三件事：
**① 删项目没有二次确认，而它的破坏面比有确认的「删画布节点」大得多（H0）；
② 备份判据只数 frames，看不见「Frame 还在、里面空了」这半类（H3），而 H0 正好走这条；
③ 「读失败→当成空→空被写回覆盖」是全项目通用模式（H5），canvas/projects/secrets 都在里面。**

## 风险排序总表

| # | 风险 | 丢什么 | 能恢复吗 | 触发难度 |
|---|---|---|---|---|
| H0 | 删项目零确认（3 个入口）| tab 结构 / 画布摆放 / 正在跑的终端 | 文件可逆，布局与进程**不可逆** | **最低**（一个 × 按钮）|
| H1 | 「接上上次的对话」先删后存 | 一整段聊天记录 | **不可恢复** | 低（正常操作一次点击）|
| H3 | 备份判据只数 frames | 画布节点摆放 | 视触发路径 | —（是 H0/未来事故的放大器）|
| H4 | wiki 回滚前的快照失败也照样 `reset --hard` | 知识库未提交的笔记修改 | **不可恢复** | 中 |
| H5 | 读失败→空→覆盖（通用模式）| canvas / projects / **secrets** | **不可恢复** | 中（需一次异常退出）|
| H2 | agent-history 超 200 份静默删最旧 | 老聊天记录 | **不可恢复** | 中（重度用户几个月）|
| H6 | `git status` 失败→当成 0 改动→`--force` 删 worktree | agent 一整趟的产出 | **不可恢复** | 低-中 |
| M1 | 预览编辑保存盲覆盖外部改动 | agent 刚写的内容 | git 里可恢复 | 中高 |
| M2 | `.eas-backup` 固定名被下次写入冲掉 | 用户**原始**的 CLI 配置 | 第一次之后就没了 | 高（升级即触发）|
| M3 | `syncRules` 无条件删 `~/.claude/skills/eas-wiki/` | 同名目录里的用户文件 | **不可恢复** | 低 |
| M5 | 待办文本 >500 字静默截断 | 粘进待办的长文 | **不可恢复** | 中 |
| M7 | `.plans/team.json` 并发写静默覆盖 | 花名册批次记录 | 成果本身不受影响 | 中 |

## 已确认的高危项

### H0. 删项目：三个入口、零次确认，一次误点抹掉画布布局 + 杀掉正在跑的终端
> 编号 H0 是因为它比下面所有条目都更容易触发，且**正好落在 8-20 那个补丁的盲区里**。

- **判据**：`removeProject` 的三个 UI 入口没有任何一个做二次确认；它会同时
  ① kill 该项目名下**全部** PTY ② 删掉全部 tab ③ `pruneOrphanNodes()` 改画布，
  而 Frame 本身保留 —— 于是 **frames.length 不变，`shouldBackup` 返回 false，不备份**。
- **证据**：
  - 入口 1：Sidebar 上的 × 按钮，**紧挨着「打开终端」按钮**
    `src/renderer/src/features/workspace/Sidebar.tsx:231-238` → `void removeProject(p.id)`
  - 入口 2：`SwipeRow` 横滑删除 `Sidebar.tsx:159`（触控板横滑即触发）
  - 入口 3：右键菜单「从列表移除」`src/renderer/src/features/workspace/projectMenu.ts:67-73`
  - 后果链：`src/renderer/src/store/projectsSlice.ts:95-116`
    —— `killPanePty`（`:97-99`）→ `window.api.projects.remove(id)`（`:100`）
    → `set({ tabs: remainingTabs, ... })` → `pruneOrphanNodes()`（`:116`）
  - 主进程侧无备份：`src/main/projects.ts:54-58` `projects:remove` → `saveProjects` 裸覆盖
  - 备份盲区：`:113-115` 的注释明说「**Frame 本身留着不删**」
    → `src/main/canvas.ts:82-84` 只数 frames → `src/shared/canvasBackup.ts:34`
    `nextFrames * 2 <= prevFrames` 不成立 → **不备份**
- **丢什么 / 能不能恢复**：
  - 项目**文件**没事（tooltip「不删除文件」是真的），重新添加文件夹能回来 —— 这部分可逆
  - **不可逆的**：该项目所有 tab 的分屏结构、画布上那些节点的摆放、正在跑的终端进程
    （`killPanePty` 直接杀，跑到一半的构建/部署就没了）
  - 聊天记录文件本身不删，但 `agentHistory:list` 是按 `cwd` 列的
    （`src/main/agentHistory.ts:137-172`），项目没了就没有入口再列出它们 —— **软丢失**
- **难受度**：高 × **触发容易度**：**最高**（一个和常用按钮并排的 × + 一个横滑手势）
- **和 8-20 事故的关系**：同一性质 —— 一次点击、破坏画布、无确认无撤销、
  且这次连新补的备份都挡不住。**H3 说的「判据维度不足」，这条就是它的实际触发路径。**
- **项目内标准不一致（最有力的一条论据）**：画布上删节点/Frame **是有二次确认的**，
  而且会先查 pty 忙不忙、把「会终止 N 个正在运行的终端」写进文案：
  `src/renderer/src/features/canvas/CanvasStage.tsx:356-365`。
  删项目的后果更大（该项目**全部**终端 + 全部 tab + 画布节点），却一次确认都没有。
- **边界（自我修正）**：滑动删除**不是**「一碰就走」—— `useSwipeRemove` 有 72px 位移阈值
  （`src/renderer/src/ui/useSwipeRemove.ts:11`，注释原话「太短容易误删」）。
  所以入口 2 的误触风险比我最初写的低。**真正一次点击就生效的是入口 1 那个 × 按钮**
  （`Sidebar.tsx:231-238`），它和「打开终端」按钮并排，且只有 tooltip 没有确认。
  另外我**没有**打开 `CanvasDrawer.tsx:515` 那一处看它有没有自己的确认层 —— 需要有人补看。

### H1. 「接上上次的对话」会先删后存 —— 中途退出=记录永久消失
- **判据**：`adoptOrphan` 把孤儿记录读进内存 state 后**立刻**删掉磁盘上那份，而新的一份要等
  「有 view.turns」才会写盘；用户不发消息就不会有 view。
- **证据**：
  - `src/renderer/src/features/agentChat/AgentChatView.tsx:469-477`
    `loadHistory(h.leafId)` → `setRestored(...)` → `forgetHistory(h.leafId)`（无 await、无确认）
  - 落盘 effect：`AgentChatView.tsx:225-236`，守卫是 `const turns = view?.turns; if (!turns?.length) return`
    —— `view` 只有起了会话、CLI 回了事件才有值
  - 主进程侧：`src/main/agentHistory.ts:205-208` `agentHistory:forget` → `fs.rmSync(f, { force: true })`，
    **无备份、无回收站、无确认**
- **后果**：这条路径正是为「误关了要能捞回来」（2026-08-19 需求）造的，结果它自己会把记录弄丢。
  点了「接上上次」之后关掉节点 / 退出应用 / 应用崩溃 → 那段对话既不在旧 leafId 文件里，
  也没写进新 leafId，**不可恢复**。
- **难受度**：高（聊天记录是用户唯一的对话档案）× **触发容易度**：高（正常操作路径，一次点击）
- **边界**：我没有真机验证「点了接管但不发消息」是否真的不落盘 —— 结论是从
  effect 依赖与守卫读出来的静态判断。要坐实需在 CDP 里点一次孤儿条目再看
  `~/Library/Application Support/Eas-Term/agent-history/` 少没少文件。

### H2. agent-history 超过 200 份静默删最旧 —— 删的正是「想捞回来的那些」
- **判据**：`prune()` 按 mtime 排序删到只剩 200 份，catch 全吞，无任何提示。
- **证据**：`src/main/agentHistory.ts:22`（`MAX_FILES = 200`）、`:31-47`（`fs.unlinkSync(f.p)`，
  `catch { /* 清理失败不影响主流程 */ }`）；每次 `agentHistory:save` 结尾都会调 `prune()`（`:197`）
- **后果**：关掉的节点不再删记录（有意为之），所以这个目录只增不减；到 200 份以后每存一次新记录
  就悄悄干掉一份最老的。**不可恢复**，用户不会收到任何信号。
- **难受度**：中高 × **触发容易度**：中（重度用户几个月就能攒到 200 个对话节点）
- **边界**：没有实测一台真机上现有多少份；MAX_FILES 是否够用属于经验判断，不是实测。

### H3. 画布备份判据只看 Frame 个数，看不见「Frame 还在、里面全空了」
- **判据**：`shouldBackup(prevFrames, nextFrames)` 的输入只有两个 **frames.length**，
  完全不看每个 Frame 内的节点/shapes。
- **证据**：`src/shared/canvasBackup.ts:31-35`；调用点 `src/main/canvas.ts:82-84`
  （`const next = (scene as { frames?: unknown[] })?.frames`）
- **后果**：8-20 事故的原话是「用户丢了所有 Frame 里的节点摆放」。如果下一次事故是
  **Frame 数不变、每个 Frame 里的分屏树被清空**（例如某个 bug 把 root 重置成单个空 leaf），
  `shouldBackup` 返回 false，照样**无备份直接覆盖**。这个补丁挡住的是上次那一下，
  没挡住同类的另一半。
- **难受度**：高 × **触发容易度**：低-中（需要一个 bug，但事故就是 bug 造成的）
- **边界**：我没有去确认 scene 的实际结构里节点树挂在哪个字段（frames[].root?），
  这条只证明「判据的输入维度不足」，没有给出具体的替代判据。

### H4. `wiki:rollback` 的「回滚前保留现场」失败了也照样 `reset --hard`
- **判据**：`commitAll()` 内部 catch 全吞、失败返回 `null`；`wiki:rollback` **不检查返回值**
  就执行 `git reset --hard`，而且无论如何都返回 `{ ok: true }`。
- **证据**：
  - `src/main/wiki/index.ts:301-311`
    ```
    commitAll(root, '回滚前保留现场')      // 返回值丢弃
    git(root, ['reset', '--hard', sha])
    ```
  - `src/main/wiki/git.ts:46-56` `commitAll` → `catch { return null }`
  - 对照：同文件 `wiki:snapshot`（`:269-274`）和 `wiki:commit`（`:276-281`）**都检查了** sha
    是否为空并回报失败 —— 只有 rollback 这一条没检查，是不一致而非有意设计
- **失败触发条件（都不罕见）**：git 没配 `user.email`/`user.name`（新机器常态）、
  `.git/index.lock` 还在（用户/AI 正好在另一个终端里对同一个库跑 git）、磁盘满。
  任一条命中 → 快照没落 → `reset --hard` 抹掉工作区里所有**已跟踪文件的未提交修改**。
- **后果**：知识库是「AI 动用户文件时唯一能整体撤销的机制」（git.ts:1 的原话），
  这条路径把那个机制的最后一道保险悄悄跳过了。丢的是「上次快照之后写的所有笔记修改」。
  **未跟踪的新文件不会被 reset --hard 删掉**，所以损失范围限于对已有笔记的编辑。
- **难受度**：高 × **触发容易度**：中（要用户点回滚 + 一个 git 侧的失败条件同时成立）
- **同时属于「返回成功但没生效」**：快照根本没打，界面照样显示回滚成功。
- **边界**：我没有实测 `git commit` 在未配 user.email 时的具体退出码，只依据 git 的通行行为；
  也没有验证 `commitAll` 在 detached HEAD / 空仓库下的表现。

### H5. 「读失败 → 静默当成空 → 空被写回覆盖」是全项目通用模式
- **判据**：几乎所有 JSON 存档的 load 都是 `try { JSON.parse(readFileSync) } catch { return 空 }`，
  而紧接着的任何一次写操作都是**整份覆盖**。读失败的原因不一定是永久损坏
  （IO 抖动、被同步盘锁住、写到一半被杀进程留下的截断文件），但覆盖是永久的。
- **证据（同一模式的多处实例）**：
  - `src/main/projects.ts:13-26` —— `loadProjects` catch → `[]`；`saveProjects` 直接
    `fs.writeFileSync`（**非原子**，没有 tmp+rename），`projects:remove/setStatus/rename`
    每一条都会把这个 `[]` 写回去 → **项目列表整个清空**
  - `src/main/canvas.ts:44-50 / :53-60` —— `canvas:load` catch → `null`（空画布）；
    `framesOnDisk()` catch → `0`，而 `shouldBackup(0, n) === false`
    （`src/shared/canvasBackup.ts:32`）→ **恰恰在存档损坏时不备份**，
    那份「只是尾部截断、前面 90% 还能人工救回来」的 canvas.json 被空场景直接覆盖
  - `src/main/todos.ts:56-57`、`src/main/board.ts:45-46`、`src/main/gantt.ts:57-58`
    —— 同样是 catch→空 + 裸 `writeFileSync`
  - `src/main/secrets.ts:132-153` —— readStore catch → `emptyStore()`；
    虽然 `writeStore` 是原子的（`:194-218` tmp+chmod+rename），但**原子性防的是写一半崩，
    防不了「拿空库覆盖」**。任何一次 `secrets:add`/`remove` 都会把空库落盘
  - `src/main/secrets.ts:155-192` `migrateItem` 返回 null 的条目被静默丢弃，
    下一次 writeStore 就把它永久写没了（密钥是最难重建的一类数据）
- **后果**：canvas.json / projects.json 是这次事故的同一类风险的**根**：
  8-20 的补丁只挡住「有效场景变小」，挡不住「存档读不出来 → 当成空 → 覆盖」。
- **难受度**：极高（画布 + 项目 + 密钥）× **触发容易度**：低-中
  （需要一次异常退出或 IO 故障，但 Electron 应用被强退是家常便饭）
- **边界**：我**没有实测**「写 25KB JSON 时强杀进程能否产生截断文件」——
  在 macOS APFS 上单次 `write(2)` 未必会撕裂。这条的严重性依赖那个前提，
  需要有人做一次真机实验（反复 `kill -9` 写入中的进程，看 canvas.json 是否出现过半截 JSON）。
  在实验坐实之前，这条按「结构性隐患」而不是「已知会发生」看待。

### H6. worktree 删除的保护会在 `git status` 失败时静默失效
- **判据**：`changed` 的取值是 `st.ok ? 计数 : 0` —— git 命令失败被降级成「没有改动」，
  于是保护条件 `changed > 0` 不成立，直接走 `git worktree remove --force`。
- **证据**：`src/main/teamWorktreeOps.ts:84-98`
  ```
  const st = await git(abs, ['status', '--porcelain'])
  const changed = st.ok ? st.out.split('\n').filter(Boolean).length : 0   // ← 失败=0
  if (changed > 0) return { ok:false, ... }
  const r = await git(projectPath, ['worktree', 'remove', '--force', relPath])
  ```
  `git()` 带 `timeout: 30_000`（`:19`）—— 大仓库冷缓存下 `status` 超时是真实存在的。
- **后果**：`--force` 抹掉的正是「agent 这一趟全部的成果」（`:76-83` 的注释就是为这个写的，
  2026-08-19 真机验证过：树删掉后分支还在但一个新提交都没有）。这里等于把那条教训
  留了一个后门。**不可恢复**（worktree 目录整个没了，改动没进任何 commit）。
- **附带**：`git status --porcelain` **不列 .gitignore 忽略的文件**，而 `remove --force`
  会连它们一起删。agent 在 worktree 里产出的落在忽略路径的东西（构建产物、
  `.plans/*/entries.json`、`*.log`）既不计入 `changed` 也不会有任何提示。
- **难受度**：高 × **触发容易度**：低-中
- **文档与代码矛盾（显式记一笔）**：`.gitignore` 里 `.worktrees/` 那条的注释写着
  「改动本身在各自的 eas-team/* 分支上，不会丢」—— 这句话已被
  `teamWorktreeOps.ts:76-83` 明确推翻（agent 多半没 commit）。留着会误导下一个改这块的人。

## 中等风险

### M1. 预览里「编辑→保存」会盲覆盖外部改动（无冲突检测）
- **判据**：`fs:writeTextFile` 只校验路径边界、大小和类型，**不比对打开时的内容基线**，
  直接 tmp+rename 覆盖。
- **证据**：`src/main/fs.ts:155-179`
- **后果**：这个应用的核心场景就是「AI 在终端里改文件，用户同时在预览里看着」。
  用户打开文件 → agent 改了它 → 用户点保存 → **agent 的改动被静默抹掉，没有任何提示**。
  可以从 git 恢复（如果在仓库里且已提交）；不在仓库里就没了。
- **难受度**：中 × **触发容易度**：中高（这个软件的主场景）
- **边界**：我没有确认渲染层是否在保存前做过 mtime 检查 —— 只查了主进程侧。

### M2. `~/.claude.json`、`~/.codex/AGENTS.md` 的 `.eas-backup` 是固定文件名，会被下一次写入冲掉
- **判据**：备份路径恒为 `<原文件>.eas-backup`，每次写前 `copyFileSync` 覆盖，只留最近一份。
- **证据**：`src/main/mcpBridge.ts:297`、`:348`、`:414`、`:470`、`:502`；
  `src/main/agentRules.ts:194`；`src/main/statuslineRuntime.ts:59`；`src/main/agentHook.ts:108`；
  `src/main/dict.ts:133`；`src/main/roles.ts:285`；`src/main/wiki/schema.ts:187`
- **后果**：第一次写入时 `.eas-backup` 确实是用户的原始配置；第二次写入之后，
  它变成「已经被我们改过的版本」，**真正的原始配置永久消失**。想回到「装 Eas-Term 之前」
  的状态就没有依据了。对比：canvas.json 的备份带时间戳并保留 5 份
  （`src/shared/canvasBackup.ts:37-47`）—— 同一个项目里两套标准。
- **难受度**：中（`~/.claude.json` 里有用户全部项目历史）× **触发容易度**：高（升级即触发）

### M3. `syncRules()` 无条件递归删除 `~/.claude/skills/eas-wiki/`
- **判据**：`fs.rmSync(dir, { recursive: true, force: true })`，没有任何「这是不是我们装的」判定。
- **证据**：`src/main/agentRules.ts:318-322`（syncRules 里）、`:360-368`（removeRules 里，
  连 `eas-term` 一起删）
- **后果**：用户如果自己在 `~/.claude/skills/eas-wiki/` 下放过东西，点一次「安装规则」
  就整个目录消失。**不可恢复**（rmSync 不进废纸篓）。
- **难受度**：中高 × **触发容易度**：低（要求名字正好撞上；且 `syncRules` 只由
  `rules:sync` 手动触发，不是每次启动 —— 启动跑的是 `refreshInstalledRules`，
  它只重写文件内容不删目录，见 `src/main/index.ts:330`）
- **边界**：我**没有**去数用户机器上 `~/.claude/skills/` 里有没有叫 eas-wiki 的目录。

### M4. `~/.claude/skills/eas-term/`、`~/.eas/agent/` 里的改动每次启动被静默覆盖回去
- **判据**：`refreshInstalledRules()` 比对内容，不一致就 `writeDistributed()` 重写（先 chmod 644 解锁）。
- **证据**：`src/main/agentRules.ts:280+`、`:238-248`；启动调用点 `src/main/index.ts:330`
- **后果**：这是**有意设计**（注释解释得很清楚：防 agent「顺手优化说明」）。
  但对用户来说效果是「我改的东西第二天没了」，且没有任何提示。列在这里是为了让它被知情，
  不是当 bug。

### M5. 待办文本超过 500 字会被静默截断，条目超过 300 条被静默丢弃
- **判据**：`cleanItems()` 在**每一次保存**时做 `.slice(0, MAX_ITEMS)` 和
  `String(it.text).slice(0, MAX_TEXT)`，没有任何返回值告诉调用方「截了」。
- **证据**：`src/main/todos.ts:20-24`（`MAX_TEXT = 500` / `MAX_ITEMS = 300`）、`:60-71`、
  写入点 `:84-90`
- **后果**：往待办里粘一段长文（会议纪要、报错日志、一段方案）→ 保存 → 重开只剩前 500 字，
  **没有任何提示，且原文只在渲染层内存里，重开就没了**。
- **难受度**：中 × **触发容易度**：中（粘长内容进待办不罕见）
- **边界**：我没看渲染层是否在输入框上做了 maxLength 前置限制 —— 如果做了，
  用户在输入时就会被挡住，这条的实际触发面会小很多。**这一点需要有人补查
  `features/*/Todo*.tsx`**。

### M6. 用户词典超过 500 条后，每加一条就丢掉最旧的一条
- **判据**：`writeUser(cur.slice(-500))`，无提示、无备份（`.eas-backup` 只在
  `migrateLegacyShells()` 里打过一次）。
- **证据**：`src/main/dict.ts:243`（`cur.slice(-500)`）、`:128-136`（唯一一次备份）
- **难受度**：低-中（词条可重建）× **触发容易度**：低（要攒到 500 条）

### M7. `.plans/team.json` 是「读—改—写」跨 await，并发派活会静默互相覆盖
- **判据**：`teamRoster()` → `addBatch()` → `teamRosterSave()` 三步之间有 await，
  没有任何锁或版本校验；主进程侧 `team:rosterSave` 是整份 `writeFileSync` 覆盖。
- **证据**：`src/renderer/src/mcpHandler.ts:1031-1049`；`src/main/agentHistory.ts:72-82`
- **后果**：两次并发 `team_spawn`（或两个窗口开着同一个项目）→ 后写的赢，
  前一批的花名册记录消失。`addBatch` 还会 `.slice(0, MAX_BATCHES)`
  （`src/shared/teamRoster.ts:62`）静默丢老批次。
- **难受度**：低（花名册是记录不是产出，`.plans/<role>/findings.md` 才是成果）×
  **触发容易度**：中
- **值得单独指出**：项目自己的纪律里写着「并发写是静默覆盖」
  （`teamWorktreeOps.ts:47`、memory「多 agent 编排」），这一处正好是那条纪律的反例。

### M8. `board:list` 在列表被清空/损坏时回落成默认三列，然后被写回
- **判据**：`load()` 里 `if (ok.length) return ok` —— 空数组走到最后 `return DEFAULTS`。
- **证据**：`src/main/board.ts:29-42`
- **后果**：用户删光所有列（或存档损坏）后，界面显示默认三列，任何一次
  `board:save` 就把默认三列固化到盘上。用户「我要空看板」的意图被覆盖。属于
  H5 那个模式的小号版本。**难受度低**，列出来是为了让 H5 的修法覆盖到它。

## 查过但风险低（记下来免得别人重复查）
- `src/main/fs.ts` 的 `fs:trash` 走 `shell.trashItem`（进废纸篓，**可恢复**）；
  `fs:rename` / `fs:move` 有 `existsSync` 前置拒绝覆盖；`fs:copy` 自动加「副本 N」不覆盖；
  `fs:createFile` 用 `'wx'` 独占创建。这一组是全项目做得最规范的。
- `src/main/skillLibrary/write.ts:159-180` `copySkillDir`：临时目录 → rename，
  失败清理，落点已存在就拒绝，symlink 按链接复制不跟随。没有覆盖风险。
- `src/main/secrets.ts:194-218` `writeStore`：tmp + chmod 0600 + rename，原子。
  （它的风险在 H5 那条，不在写入本身。）
- `src/main/agentChat/session.ts:165-175`：`.eas-backup` + tmp + rename，双保险。
- `src/main/snapshot.ts:72-92`：有互斥锁 + 序号探测，且刻意不吞 ENOTDIR/EACCES
  （`:76-88` 的注释解释了为什么吞了会覆盖用户旧图）。
- `src/main/pasteImages.ts`：24 小时后清理系统 temp 里的粘贴图。这些图不进画布
  （只在 `features/terminal/usePastedImages.ts` 用），删了不影响持久数据。
  唯一的小坑：贴了图但一直没发送、隔天重启 → 图没了，输入框状态也没了。
- `src/main/wiki/index.ts:479-483` `wiki:forget` 只清配置不删文件；
  `:628-641` `wiki:setPath` 会拒绝不存在的路径（注释里记着「路径少一个空格，
  人以为整个知识库丢了」的真实事故）。这两条处理得对。

## 我推翻的一个前提

任务里写「（备份）现已补上」。**补上的是一半。** `shouldBackup` 的输入只有
`frames.length` 两个数字（`src/shared/canvasBackup.ts:31-35`），而 H0 那条路径
（删项目 → `pruneOrphanNodes`）明确保留 Frame、只清里面的节点
（`src/renderer/src/store/projectsSlice.ts:113-115` 的注释原话），
所以**它走不到备份分支**。把「已经有备份了」当成这一类风险已关闭，是不成立的。

另外 `.gitignore` 里 `.worktrees/` 那条的注释写着「改动本身在各自的 eas-team/* 分支上，
不会丢」—— 这句话已被 `src/main/teamWorktreeOps.ts:76-83` 明确推翻（agent 多半没 commit）。
两处说法矛盾，留着会误导下一个改这块的人。

## 这块需要谁来补

我只做了静态代码审查，下面这些**必须真机验证**，我没做：

1. **验 H1（最该验的一条）**：CDP 里点一次「接上上次的对话」孤儿条目，然后**不发消息**
   直接关掉，看 `~/Library/Application Support/Eas-Term/agent-history/` 是不是少了一个文件、
   而且没有新增。—— 需要会用 CDP 验证的人（memory 里有《Eas-Term CDP 验证方法》）。
2. **验 H5 的前提**：反复 `kill -9` 正在写 canvas.json 的进程，看 APFS 上是否真会产生
   截断的半截 JSON。如果实测不会撕裂，H5 的严重性要下调一档。
3. **补查 M5 的实际触发面**：`features/` 下待办输入框有没有 `maxLength` 前置限制。
   有的话用户在输入时就被挡住，静默截断基本不会发生。
4. **补看 `CanvasDrawer.tsx:515`** 那一处 `removeProject` 有没有自己的确认层。
5. **静默失败那条线**（这一批的目标②）我只顺手捞到三条交叉的：
   `wiki:rollback` 快照没打也返回 ok（H4）、`git status` 失败降级成 0（H6）、
   `团队花名册写失败只 console.error`（`src/main/agentHistory.ts:78-81`）。
   系统性地扫「返回 ok 但没生效」不在我这一趟的范围里 —— 那是另一个人的活。

## 我没做什么

- 没跑应用、没做任何真机验证，全部结论来自读代码
- 没审 `src/main/agentChat/`、`pty.ts`、`stt.ts`、`updater.ts`、`island.ts`、
  `statuslineInstall.ts`、`agentInstall.ts`、`bizone.ts`、`design.ts` 的写路径
  （它们主要写运行态/安装态，不是用户创作数据；`updater.ts:150` 的 rename 只动下载的包）
- 没查 MCP 工具侧（`mcp/eas-mcp.mjs`）暴露给 agent 的写能力
- 没估算任何一条的修复成本
