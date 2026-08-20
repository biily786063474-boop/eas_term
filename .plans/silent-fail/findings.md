# silent-fail —— 「返回成功但其实没生效」清单

范围：`git log --oneline -25` → **2026-08-19 ~ 08-20 两天**，主要是 team 系列
（E-07 worktree / E-10 花费 / E-11·E-12 花名册 / E-13 交活自检）、agentHistory、canvasBackup。
**只读，没改任何代码。**

已读完：`src/shared/team{Cost,Findings,Roster,Worktree}.ts`、`src/main/teamWorktreeOps.ts`、
`src/main/agentHistory.ts`、`src/main/canvas.ts`、`src/shared/canvasBackup.ts`、
`src/renderer/src/mcpHandler.ts`（team_status / team_send / team_dissolve / team_spawn / resolveFrame）、
`src/renderer/src/features/team/brief.ts`、`src/main/mcpBridge.ts`（mcpEnv）、
`src/main/agentChat/session.ts`（stop / mcpEnv 调用点）。

按严重度排。**S-01 是这一批里最贵的一条**：它把 08-19 刚修好的东西在隔离 agent 上又打回原形。

---

## S-01 【最严重】worktree agent 的 `EAS_PROJECT` 是工作树路径 → `resolveFrame` 认错项目

08-19 的 `ae03989`「调用方说了自己在哪个项目就信它」修的正是这个 bug；
当天晚些的 `42d4b80`（worktree）把它的前提打掉了 —— **两个 commit 单独看都对，合起来错**。

**判据**：判定依赖「`ctx.project` 一定等于某个已注册项目的 path」，隔离 agent 上不成立；
且不成立时不报错，而是**静默回落到「用户当时正看着的那个 Frame」**。

**证据链**（四处，缺一不可）：
1. `src/renderer/src/mcpHandler.ts:1001-1017` —— 隔离 agent 的 cwd 被指向工作树：
   `agentCwd = r.absPath`（= `<项目>/.worktrees/<6位>-<role>`）
2. `src/main/agentChat/session.ts:424` —— `mcpEnv({ project: opts.cwd, ... })`，
   **注进去的 EAS_PROJECT 就是这个 cwd**，不是项目根
3. `src/main/mcpBridge.ts:56` —— `if (ctx.project) env.EAS_PROJECT = ctx.project`
4. `src/renderer/src/mcpHandler.ts:82-92` ——
```ts
const byCtx = ctx.project
  ? s.canvas.frames.find(f => !f.parentId && s.projects.find(p => p.id === f.projectId)?.path === ctx.project)
  : undefined                       // ← 工作树路径不等于任何项目 path，必然 undefined
const fallback = byCtx ?? frames.find(f => f.projectId === s.activeProjectId) ?? frames.find(f => !f.parentId)
...
return { frameId: fallback.id, projectPath: proj?.path ?? ctx.project ?? '' }   // ← 用的是**别人项目**的 path
```
注意 `projectPath` 取的是 `proj?.path`（那个错项目的真实路径），
`ctx.project` 这个兜底根本轮不到 —— 所以连「至少还是自己的路径」都不成立。

同一段的注释（73-80 行）自己写着：「后果是：一个没有 ptyId 的调用方（**agentChat 会话走的就是这条路**）
问 team_status，拿到的是用户当时正看着的那个 Frame 的项目」。隔离 agent 正是没有 ptyId 的 agentChat 会话。

**失败场景**：用户在项目 A 的画布上派一批带写码角色的 agent → writer 跑在
`A/.worktrees/123456-writer` → 用户切到项目 B 的 Frame 看别的东西 →
writer 调任何一个走 `resolveFrame` 的 MCP 工具：
- `team_status` → `where.projectPath` = **B** → `belongsToProject(cwd_in_A, B)` 全 false →
  回「这个项目里没有团队派生的 agent」，并且去读 **B 的 `.plans/team.json`**
- 画布类工具（`canvas_add_node` / 便签 / 快照）→ 节点**加到项目 B 的 Frame 上**
- `safePath`（`mcpHandler.ts:94-121`）的 allow 列表是 `[ctxProject, projectPath]` →
  **把项目 B 的整个目录加进了这个 agent 的可读写白名单**，而它跟 B 毫无关系

**补充核实**（写完这条之后又去确认的两点，都成立）：
- `spawn(built.bin, args, { cwd: opts.cwd, env: { ...mcpEnv({ project: opts.cwd, ... }) } })`
  （`session.ts:420-424`）—— **进程的 cwd 和注进去的 EAS_PROJECT 是同一个值**，
  没有任何地方把它换回项目根。
- `isTeamOwnedCaller`（`mcpHandler.ts:49-51`）只拦 `notify` / `team_spawn` / `team_send` /
  `team_dissolve`。**`team_status` 和所有画布 / 文件类工具对团队 agent 是开放的** ——
  也就是说这条路径确实走得通，不是「反正它也调不了」。

**边界**：
- 我**没有真机复跑**这条，是从上面四处代码推出来的；`3ec1fc3` 的 commit message 里那次真机验证
  （reader + writer）**恰好不会暴露它** —— 那次用户全程停在同一个 Frame 上，
  `activeProjectId` 兜底刚好回落到正确的项目。所以「804 全过」不能反驳这一条。
- 只影响**隔离（worktree）**的 agent。非隔离 agent 的 cwd 就是项目根，`byCtx` 命中，一切正常。
- 修法不该是放宽 `byCtx` 的比较（那会把 `safePath` 的边界一起放宽），
  更像是在 `team_spawn` 起会话时把「项目根」和「工作目录」分成两个字段传。

---

## S-02 `team_dissolve` 算不出批次 id 时，用一个**看起来合法的假路径**去查工作树，然后什么都不说就停进程

**判据**：返回 ok（`dissolved: N`）但语义上漏掉了最要紧的那部分；
失败被折叠成一个不会报错的默认值。

**证据**：`src/renderer/src/mcpHandler.ts:820-826`
```ts
const batchIdOfFactory = (rosterRaw) => {
  const r = parseRoster(rosterRaw)
  return (x) => r.batches.find(b => b.agents.some(a => a.role === x.role))?.id ?? ''   // ← 找不到给空串
}
```
接到 `src/shared/teamWorktree.ts:25-35`：
```ts
export function shortBatch(batchId) { const digits = batchId.replace(/\D/g,''); return digits.slice(-6) || '000000' }
export function worktreePath(batchId, role) { if (!/^[a-z0-9-]+$/.test(role)) return null; return `${WORKTREE_DIR}/${shortBatch(batchId)}-${role}` }
```
`worktreePath('', 'writer')` → **`.worktrees/000000-writer`**，不是 null。
于是 `mcpHandler.ts:856-859` 的 `if (!rel) return null` 这道守卫**永远拦不住**，
`worktreeStat` 拿一个不存在的路径去查，如实返回 `{exists:false, changed:0}` →
`treeMap` 里没有这个 role → `report` 里没有 `worktree`/`changedFiles` 字段 →
`next` 里那段「`<role>` 在 `<path>/` 改了 N 个文件（**没有自动合，也没删那棵树**）——`git -C … diff` 看它改了什么」
**整段不出现**。

**失败场景**（三条路都会踩到，任一条即可）：
1. 花名册当时没写成（S-04）
2. 花名册文件坏了 → `parseRoster` 返回空（S-05）
3. 这批已经被 `MAX_BATCHES = 8` 挤出去（`src/shared/teamRoster.ts:39,62`）——
   派满 8 批之后再解散一批老的就会这样

→ `team_dissolve` 返回 `dissolved: 3`、`已停掉 3 个 agent。产出都在 .plans/<role>/ 下，进程停了文件不受影响。`
→ 主 agent 与用户**完全不知道磁盘上还躺着一棵有未提交改动的工作树**。
而这个工具的整个设计理由（`mcpHandler.ts:881-884` 的注释）就是「工作树一律不删，只报告、指路」——
**不删这一半做到了，报告那一半静默地没做**。改动不会丢，但会变成没人知道的孤儿目录，
下次派同名角色还会撞上「目录已存在」。

**边界**：`shortBatch` 的 `|| '000000'` 是它自己单测覆盖到的行为，不是笔误；
问题在于调用方把「查不到」和「查到了一个 id」用同一个字符串类型表达。
我没有实测第 3 条（派满 8 批）。

---

## S-03 `team_dissolve` / `team_status` 的「产出在不在」查不动时，一律报「**根本没建 findings.md**」

**判据**：`.catch(() => ({}))` 把「没查成」折叠成「查过了，确认没有」，
而下游给的是一句**语气非常肯定**的话。

**证据**：`src/renderer/src/mcpHandler.ts:690-694` 与 `843-848`（两处一模一样）
```ts
const sizes = where && roles.length
  ? await window.api.agentChat.teamFindings(where.projectPath, roles).catch(() => ({}))
  : {}
```
`sizes[x.role] ?? null` → `deliveredOf(null)` → `'missing'`（`src/shared/teamFindings.ts:24-26`）
→ `deliveredHint` 输出（`teamFindings.ts:32-34`）：
> **`<role>` 根本没建 findings.md** —— 它说跑完了，但没有任何产出。别把它当成完成，去看它那个节点里说了什么。

**失败场景**：IPC 因为窗口正在重载 / 主进程忙 / 任意异常而 reject（哪怕只是一瞬）→
**这一批每一个 agent 都被断言成「根本没建 findings.md」**。主 agent 收到这句会去重派或者
判定这批白跑了，而 findings 其实好好地躺在盘上。
注意这条和 S-01 会叠加：S-01 让 `where.projectPath` 指向错的项目，
`teamFindings` 那侧**不会报错**（`agentHistory.ts:93-97` 的 statSync catch → null），
于是同样得到一整排 `missing` —— 这次连 catch 都没走，是「成功地查了错的地方」。

**边界**：`teamFindings` 本身（`src/main/agentHistory.ts:85-101`）区分 null / 数字是对的，
问题只在渲染层这两处 catch。另外我**推翻了自己的一个假设**：见下面「已排除」第 1 条。

---

## S-04 花名册是 fire-and-forget 写的：`team_spawn` 报成功时，它可能一个字都还没落盘

**判据**：`void (async () => {...})()` + `.catch(() => undefined)`，
返回值里没有任何关于它的信息。

**证据**：`src/renderer/src/mcpHandler.ts:1030-1050`
```ts
void (async (): Promise<void> => {
  const raw = await window.api.agentChat.teamRoster(where.projectPath).catch(() => null)
  const next = addBatch(parseRoster(raw), { ... })
  await window.api.agentChat.teamRosterSave(where.projectPath, JSON.stringify(next, null, 2)).catch(() => undefined)
})()
```
主进程那侧同样只有 `console.error`（`src/main/agentHistory.ts:72-82`），IPC 返回 void。

**失败场景**：
- 项目在只读挂载上 / `.plans` 权限不对 / 磁盘满 → 写失败 → 用户看不到、主 agent 看不到 →
  `team_spawn` 照样返回 `spawned: [...]`。**E-11（上下文压缩）/ E-12（重启）的兜底静默地不存在**，
  而这份文件的全部存在理由就是「进程没了之后它才是唯一还在的东西」（`teamRoster.ts:11-13`）。
- 更快踩到的：这段是 `void` 的，**没人 await**。用户在 `team_spawn` 返回后立刻退出 app，
  或者 MCP 调用返回后渲染层被重载 → 这一批从没进过花名册。
- 连锁：花名册没写 → S-02 的 `batchIdOf` 返回 `''` → 解散时工作树信息整段消失。

**边界**：这是**刻意的设计**（注释：「写失败不影响这次派活，它是记录不是前提」），
我不反对不阻塞派活；反对的是**连一句「花名册没记上」都不放进返回值**。
返回值里加一个字段是零成本的，而现在主 agent 没有任何办法知道。

---

## S-05 花名册解析走一次 catch，下一次派活就把历史全洗掉

**判据**：容错分支的下游是破坏性写入（读→解析失败→当空→写回）。

**证据**：`src/shared/teamRoster.ts:45-62` + `mcpHandler.ts:1032-1034`（就是 S-04 那段）
```ts
export function parseRoster(raw) { ... catch { return EMPTY_ROSTER } }
export function addBatch(prev, batch) { return { v:1, batches:[batch, ...prev.batches].slice(0, MAX_BATCHES) } }
```

**失败场景**：`.plans/team.json` 被截断（`fs.writeFileSync` 非原子，写一半退出）
或被用户手改坏 → `parseRoster` → 空 → `addBatch(空, 新批)` → 写回去**只剩新的这一批**，
之前最多 7 批的记录一次性没了，全程零提示。
注释说的「这份文件坏了不该让派活失败」成立，但代价被低估了一档：
不是「这次读不到」，是「以后也读不到了」。

**顺带**：这条读-改-写没有任何锁。两次 `team_spawn` 挨得近（或者跟别的写并发）→
后写的覆盖先写的 → 丢一批记录。这正是团队纪律里写着的「并发写是静默覆盖」，
只不过这次被覆盖的是记录团队的那个文件本身。

**边界**：这个仓库现在的 `.plans/team.json` 我没有打开看（它是 untracked 的实时状态，
读它不影响结论）。我也没有实测截断场景。

---

## S-06 `worktree remove` 的「有未提交改动就拒绝」在 git 出错时静默失效，然后 `--force` 删掉

**判据**：失败被折叠成一个安全值，而那个值的方向恰好反了。

**证据**：`src/main/teamWorktreeOps.ts:84-100`
```ts
const st = await git(abs, ['status', '--porcelain'])
const changed = st.ok ? st.out.split('\n').filter(Boolean).length : 0   // ← git 失败 = 0 处改动
if (changed > 0) return { ok:false, changed, error: '...没有删...' }
const r = await git(projectPath, ['worktree', 'remove', '--force', relPath])
```
而 `git()`（17-23 行）把**任何** err 都变成 `{ok:false}`，包括那个 **30 秒 timeout**。

**失败场景**：写码 agent 在一棵大工作树里改了几十个文件没 commit → 收活时调
`worktreeRemove`（不带 force）→ `git status --porcelain` 因为超时 / `index.lock` 被别的
git 进程占着 / gitdir 指针坏了而失败 → `changed = 0` → 守卫放行 →
`remove --force` **把这一趟全部未提交成果抹掉**，返回 `{ok:true}`。

讽刺的是这个守卫的注释（76-83 行）写得很清楚：
「我一开始写的是无条件 `--force`……**那句是错的**：`--force` 抹掉的是它这一趟全部的成果」。
守卫本身写对了，退化路径又绕回了同一个后果。

**边界**：`force !== true && fs.existsSync(abs)` 这层还在，所以只在 git 真的失败时才踩到。
我没有构造 timeout / index.lock 实测。**当前 `team_dissolve` 不调 remove**（它一律不删树），
所以这条现在主要影响 `team_spawn` 失败清理（那里带 force=true，本来就绕过守卫，不受影响）
和将来任何调它的地方 —— 也就是说**这是一颗埋着的雷，不是正在冒烟的**。

---

## S-07 `worktreeRemove` 对着一个「不是工作树」的目录返回 `ok:true`，目录原封不动

**判据**：返回 ok:true 但语义上没完成。

**证据**：`src/main/teamWorktreeOps.ts:98-104`
```ts
if (!r.ok && !r.out.includes('is not a working tree')) return { ok:false, error: ... }
void branch
return { ok: true }
```

**失败场景**：`.worktrees/123456-writer/` 退化成普通目录（worktree 元数据被
`git worktree prune` 清了 / 上一批留下的残骸 / 用户手工 mv 过）→
`git worktree remove` 报 "is not a working tree" → 被吞掉 → 返回 ok:true。
**目录还在磁盘上**，于是下次 `worktreeAdd` 撞上 `52-53` 行的 `fs.existsSync(abs)`：
「已经存在 —— 可能是上一批留下的，先删掉再派」。
形成死循环：**删说成功、建说已存在**，用户只能手工去删，而两条消息互相矛盾。

**边界**：`is not a working tree` 是英文子串匹配。git 有中文翻译，
用户环境是 `LANG=zh_CN` 时匹配不上 → 走 `ok:false` 分支 → 行为不同（会如实报错），
不算更糟，但意味着这条的触发跟 locale 相关，不是稳定复现。

---

## S-08 `canvas:save-sync` 永远回 `true`，写盘失败也一样 —— 退出前的「阻塞到写完」是假的

**判据**：ipc 返回值与实际结果无关；`writeScene` 的 catch 完全静默、**连日志都没有**。

**证据**：`src/main/canvas.ts:88-98`
```ts
  fs.writeFileSync(storeFile(), JSON.stringify(scene, null, 2), 'utf8')
} catch {
  // 写盘失败（磁盘满 / 权限）不阻塞 UI，静默跳过
}
...
ipcMain.on('canvas:save-sync', (e, scene) => { writeScene(scene); e.returnValue = true })
```
对比同一函数里 82-85 行（备份失败）是有 `console.error` 的 —— **这处更要紧反而没有**。

**失败场景**：磁盘满 / userData 权限被改 / 文件被占用（Windows）→ 用户 beforeunload 触发
save-sync → 主进程写失败 → 渲染层收到 `true` 判定「已落盘」→ 放行退出 →
**这一整场画布改动全丢**，无提示、无日志。94 行注释说的「阻塞到写完再放行」
只做到了「阻塞」，没做到「写完」。

**边界**：我没有实测（没造磁盘满），这是读代码得出的必然结论。
`canvas:save`（异步那条）同样静默，但它本来就没承诺返回值，危害小一档。

---

## S-09 画布备份的前提是「读不到 = 盘上是空的」，而**坏文件也读不到**

**判据**：判定依赖一个在最该生效的场景里不成立的前提。

**证据**：`src/main/canvas.ts:51-59` + `src/shared/canvasBackup.ts:24-28`
```ts
const framesOnDisk = () => { try { ... JSON.parse(readFileSync(...)) } catch { return 0 } }
export function shouldBackup(prevFrames, nextFrames) { if (prevFrames <= 0) return false; ... }
```

**失败场景**：canvas.json 已经损坏（上次写到一半被杀 / 磁盘写坏）→ `framesOnDisk()` 走 catch
返回 0 → `shouldBackup(0, n)` 恒 false → **不备份** → `writeFileSync` 把那份坏文件原地覆盖。
坏文件里很可能还留着大部分可人工救回的 JSON 文本，覆盖之后彻底没了。
也就是说：**这层备份在「文件好好的、只是被清空」时生效，在「文件已经出问题」这个更该救的场景必定不生效。**

**同一处的第二个洞**：`fs.writeFileSync`（`canvas.ts:88`）不是原子写 —— 先截断再写。
写到一半进程被杀（强退 / 崩溃 / 断电）就产出半截 JSON，下次 `canvas:load` 走 catch 返回 null
→ 空画布。**这条链路上没有 `.tmp` + `rename` 的原子替换**，`.plans/team.json`（`agentHistory.ts:77`）
和 agent 历史（`agentHistory.ts:184`）也一样。

**边界**：我没有构造坏文件实测，也没有去读用户 userData 看现在有没有 .bak 文件
（那超出「只读代码」的范围）。08-20 的 `aedbaa8` 加的备份**本身是有效的**，
这条说的是它的覆盖面比注释宣称的窄。

---

## S-10 `team_dissolve` 说「已停掉 N 个」，但 stop 是单向 send，没人确认停没停

**判据**：返回值里的数字来自「发了几条指令」，不是「几个真的停了」；
而且会话记录**在 kill 之前就被删掉**，事后无法核对。

**证据**：
- `src/renderer/src/mcpHandler.ts:874` —— `for (const x of mine) window.api.agentChat.stop(x.id)`
  （不 await，没有返回值）
- `src/preload/index.ts:887-890` —— `stop: (sessionId) => { stopAgentChatBuffering(id); ipcRenderer.send('agentChat:stop', id) }`
  （`send` 不是 `invoke`，天然没有回执）
- `src/main/agentChat/session.ts:787-792`
```ts
ipcMain.on('agentChat:stop', (_e, sessionId) => {
  const live = sessions.get(id); if (!live) return
  sessions.delete(id)      // ← 先从会话表删
  live.proc?.kill()        // ← 再 kill；默认 SIGTERM，而且 proc 为空时什么都不做
})
```

**失败场景**：CLI 进程忽略 SIGTERM，或卡在一个不可中断的子进程上 →
`sessions.delete(id)` **已经先执行了** → 这个会话从 `listSessions()` 里消失 →
团队面板列不出、`team_status` 查不到、`team_send` 送不进 →
**一个还活着、还在烧钱、而且现在连管理入口都没有的进程**。
这正是 `3ec1fc3` commit message 里写的「纪律第 4 条要防的那种」，只是入口从「过滤条件」
换成了「先删记录再 kill」。而 `team_dissolve` 同一次调用返回 `dissolved: 3`、`已停掉 3 个 agent`。

**边界**：SIGTERM 对正常的 `claude -p` 进程是有效的，多数情况下真的会停 ——
这条不是「经常发生」，而是「发生了就完全没有痕迹，且不可恢复地失去管理入口」。
我没有构造一个忽略 SIGTERM 的 CLI 实测。`live.proc?.kill()` 里 `proc` 为空时静默跳过这一点，
我没有查清 `proc` 什么情况下会是 undefined。

---

## S-11 `agentHistory:list` 用 `cwd` 精确相等过滤 —— 工作树里的对话记录永远捞不回来

**判据**：跟 `belongsToProject` 是同一个前提，一处修了、一处没修。

**证据**：`src/main/agentHistory.ts:156` `if (raw.cwd !== cwd || !Array.isArray(raw.turns) || !raw.turns.length) continue`
对比 08-20 刚加的 `src/shared/teamWorktree.ts:74-80`（`belongsToProject`：项目根**或** `.worktrees/` 下）。

**失败场景**：写码 agent 跑在 `<项目>/.worktrees/123456-writer`，
它的历史存的 `cwd` 是工作树路径 → 在项目里打开空对话框看「上次那个对话去哪了」的列表 →
**写码 agent 的记录一条都不出现**，而它恰恰是最想回看的那个（改了代码的那个）。
跟 `3ec1fc3` 修掉的是同一类「隔离目录不等于项目根」，只是这一处没被扫到。

**边界**：**这条我后来查实了，不再是推测。** 团队会话确实会写 agentHistory：
`team_spawn` 走 `addAgentNode`（`mcpHandler.ts:1015`）建出带 leafId 的画布节点，
`AgentChatView` 挂上去后 `saveHistory(leafId, ..., cwd)`（`AgentChatView.tsx:232`）
里的 `cwd` 就是 pane 的 cwd —— 隔离 agent 那份是工作树绝对路径。
我没有实测过「工作树 agent 跑完后在项目里打开空态列表」这一步，
但两端的字符串来源已经对上了。

---

## S-12 `agentHistory:save` 收到空 turns 就删文件（**已查清：目前不会被触发，是一颗埋着的雷**）

**判据**：主进程侧把「空数组」当成「删掉盘上那份」，且这个语义没有任何调用方守卫之外的保护。

**证据**：`src/main/agentHistory.ts:174-183`
```ts
if (!f || !Array.isArray(turns)) return
try {
  fs.mkdirSync(dir(), { recursive: true })
  if (turns.length === 0) { fs.rmSync(f, { force: true }); return }   // ← 空数组 = 删盘上那份
```

**我去查了唯一的调用方，结论是它现在拦得住**：
`src/renderer/src/features/agentChat/AgentChatView.tsx:228-229`
```ts
const turns = view?.turns
if (!turns?.length) return        // ← 空的根本不会往下走
```
所以 **S-12 不是活的 bug**，我把它从「疑似」降级为「防御缺失」：
删除语义放在主进程、而唯一的保护放在渲染层的一行 early-return 上，
任何新调用方（比如将来某个「清空这个对话」的入口）都会直接踩到不可逆的删除。
`84d3efe`（0.4.45）刚承诺过「关掉的对话记录留着，并且能捞回来」，这条语义与那个承诺是反的。

**边界**：我只查了 `AgentChatView.tsx` 这一个调用点（`grep saveHistory` 只有这一处）。
`adoptOrphan`（`AgentChatView.tsx:468` 附近）会主动删旧的那份，那是有意为之，不算这条。

---

## S-13 聊天记录的「节流 1 秒」实际是**防抖** —— 流式输出期间一次都不落盘

**判据**：注释宣称的行为（节流 = 每秒至少写一次）与实现（防抖 = 停下来 1 秒后才写一次）不同，
而两者的差别恰好落在这个功能要防的那个场景上。

**证据**：`src/renderer/src/features/agentChat/AgentChatView.tsx:225-236`
```ts
// 聊天记录落盘。节流 1 秒：流式输出时 view 每个 token 都在变，不节流会把磁盘写爆。
useEffect(() => {
  const turns = view?.turns
  if (!turns?.length) return
  const t = window.setTimeout(() => { void window.api.agentChat.saveHistory(...).catch(() => undefined) }, 1000)
  return () => window.clearTimeout(t)          // ← 每次 view 变化都把上一次的取消掉
}, [view, restored, leafId, savedResumeId, cwd])
```
`view` 每个 token 变一次 → cleanup 每次都 `clearTimeout` → **只要 token 间隔小于 1 秒，
这个 setTimeout 永远排不到执行**。节流（throttle）会保证「每 1 秒至少写一次」，
防抖（debounce）保证的是「不写，直到安静 1 秒」。

**失败场景**：
1. agent 连续输出 5 分钟（长回答 / 长任务）→ 这 5 分钟里**一次都没落盘** →
   app 崩溃 / 用户强退 / 断电 → 这一整轮全丢。而注释里给的理由「不节流会把磁盘写爆」
   说明作者想要的是前者。
2. 更容易踩到的：**卸载时 cleanup 会把还没到期的那次取消掉**。
   用户在最后一次输出后 1 秒内关掉节点 / 切走视图导致组件卸载 →
   最后那段对话从没写进磁盘，而界面上明明显示过。

**边界**：token 之间通常有间隙，所以场景 1 不是必现 —— 它取决于输出密度。
场景 2 是确定性的（只要在 1 秒窗口内卸载）。
我**没有实测**，没有测量真实的 token 间隔分布。
另外 `.catch(() => undefined)` 让写盘失败在渲染层也无痕（主进程那侧至少有 console.error）。

---

## S-14 `belongsToProject` 硬编码 `/` 分隔符，Windows 上等于没修

**判据**：判定依赖「路径用 `/` 分隔」这个在目标平台上不成立的前提。

**证据**：
- `src/shared/teamWorktree.ts:79` —— `sessionCwd.startsWith(\`${projectPath}/${WORKTREE_DIR}/\`)`
- `src/shared/teamWorktree.ts:34` —— `worktreePath` 也是硬拼 `/`
- 而 `src/main/teamWorktreeOps.ts:51` 用的是 `path.join(projectPath, relPath)` ——
  **Windows 上产出反斜杠**，`absPath` 回传后就成了会话的 cwd

**失败场景**：Windows 上派一批带写码 agent → cwd = `C:\proj\.worktrees\123456-writer` →
`belongsToProject` 拿它跟 `C:\proj/.worktrees/` 比 startsWith → false →
**`3ec1fc3` 想修的「隔离 agent 在所有 team_* 工具和面板里凭空消失」在 Windows 上原样复现**。

**边界**：本项目确实出 Windows 版（发版流程里 Windows 走 CI）。
我**没有在 Windows 上实测**，是从两处路径构造方式不一致推出来的。
`3ec1fc3` 的真机验证是在 mac 上做的，覆盖不到这条。
如果 Windows 上 `git worktree add` 回来的 absPath 恰好被 normalize 成正斜杠，这条不成立 ——
我没查到这一步的证据，所以标为**待验证**而不是确认。

---

## 已排除（推翻了我自己的假设，写出来免得别人重复查）

1. **「worktree agent 的 findings 写进了工作树，`teamFindings` 查主工作区 → E-13 整个失效」——
   不成立，已经修好了。** `src/renderer/src/features/team/brief.ts:41-50, 64-66` 明确在简报里
   给了绝对路径 `${worktree.mainRoot}/.plans/${role}/`，并写清「这棵树可能被删掉，
   写在里面的结论会跟着没」。注释里还记着 08-19 真机撞到过（wt-probe）。
   —— 但它是**靠提示词约束 agent 行为**，不是靠机制保证；agent 不听话时仍会落错地方，
   而那种情况下 S-03 的 `missing` 是真的。这是「设计上的残余风险」，不算 bug，我不列为发现。
2. **`tally()` 的 token 累加 / 花费取最新**（`src/shared/teamCost.ts:40-46`）——
   语义我核对过注释里的实测表，`costUsd: costUsd ?? prev.costUsd` 也正确处理了「某轮不带这个字段」。
   `fmtCost` 拿不到时返回空串而不是 `$0.00`，也是对的。**这块没问题。**
3. **`team_status` 的 wait 模式**（`mcpHandler.ts:676-684`）—— 三层超时的大小关系
   （shim 15min > 主进程 10min > 这里 8min）注释和常量对得上，`rows.length === 0` 也会 break。
   **没找到问题。**

---

## 我没做什么（覆盖面边界，请别高估）

- **一行代码都没跑、没构造任何失败场景**。全部结论来自读代码 + git 历史，
  凡是标「实测」的都是引用别人 commit message 里的记录，不是我做的。
- `mcpHandler.ts` 我只读了 team_* 五个工具 + `resolveFrame` + `safePath`，
  剩下约 900 行（画布 / 密钥 / wiki / 快照类工具）**没读**。
- `src/main/agentChat/session.ts` 只读了 stop 和 mcpEnv 调用点两处，2000+ 行没通读。
- 渲染层的 `AgentChatView.tsx` 只读了历史加载/保存/孤儿列表三段（为了定性 S-11 / S-12 / S-13），
  `TeamPanel.tsx` / `batchSpec.ts` **完全没读**。
- 用户数据丢失场景（画布/知识库/密钥）不是我这条线的任务，
  S-08 / S-09 是顺手撞到的，那块的系统性覆盖应该由负责①的那位来做 ——
  **我这两条可以直接并给他，但不要当成那块已经查完了。**

## 谁来补
- **S-14** 需要一次 Windows 真机（或至少一次 `path.sep` 层面的代码核对）才能定性 ——
  这是唯一一条我确实过不去的。其余 13 条都已经把证据链走到底了。
- **S-08 / S-09** 属于「用户数据丢失」那条线，可以直接并给负责①的那位；
  但**我这两条是顺手撞到的，不代表画布那块已经查过了。**
