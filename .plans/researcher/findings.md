# researcher · 结论（第 3 批）

> 第 1、2 批（多 agent 编排 / 确认清单超时）的结论已归档到
> `.plans/researcher/archive/round1-2-findings.md`，本文件只讲这一批。

**批次目标**：摸清 `src/main/wiki/` 的目录约定、`wiki_query` 的数据形状、哪些操作真的写盘。
**读了**：`paths.ts` / `taxonomy.ts` / `customSchema.ts` / `schema.ts` / `scan.ts` / `git.ts` / `index.ts`
（共 2249 行，全部读完），外加消费侧 `mcp/eas-mcp.mjs`、`src/renderer/src/mcpHandler.ts`、
`src/shared/types.ts`。基线：`node --test src/main/wiki/*.test.ts` → 43 pass / 0 fail。

## 一句话结论

目录结构是**两条互不相通的路**（有没有 `.eas-wiki.json` 决定），`wiki_query` 的返回形状
也跟着分叉；而**最容易踩的坑是分叉分得不干净** —— 自定义库的 `dirs` 字段里
`inbox` 是真的、另外七个是内置名（盘上不存在），一个"半真"的对象比全假的更骗人。

## 一、目录结构怎么决定的

判据只有一个：库根目录有没有 `.eas-wiki.json`（`taxonomy.ts:TAXONOMY_FILE`）。
入口是 `taxonomyState(root)` 的**三态**，`libraryDirs()` / `readTaxonomy()` 只是它的下游。

| 状态 | 触发条件 | 目录从哪来 | 说明书正文 | 写入是否放行 |
|---|---|---|---|---|
| `none` | 文件不存在（ENOENT）| `BUILTIN_DIRS` 内置八目录，经 `dirOf()` 做中文老库回落 | `schema.ts:schemaBody`（八个具名字段，**字节级不可变**）| 放行 |
| `valid` | 存在 + 合法 JSON + 过 `validateTaxonomy` | 配置里的 `dirs[]`，名字原样，`resolve` 不介入 | `customSchema.ts:customSchemaBody`（按配置逐条列）| 放行 |
| `broken` | 读不出来 / 不是 JSON / 校验不过 | **不给** —— 拒绝回落到内置 | 不写 | **闸门拦住** |

内置八目录（顺序与名字被注释标为"不许动"，改了会让所有老库的 CLAUDE.md 被重写）：
`00-inbox`(inbox) · `me` · `people` · `methods` · `domains` · `projects` · `sources`(raw) · `_templates`(templates)。
老库中文名回落表在 `paths.ts:LEGACY`，判据是**盘上有哪个用哪个**，不自动搬迁。

`validateTaxonomy` 的硬约束（拒绝比放行安全）：`dirs` 非空；每项要有 `name` + 非空 `purpose`；
name 不能含斜杠 / 不能点开头 / 不能撞 `.eas-wiki.json` / 不能重名；
**`role:"inbox"` 必须恰好一个**；`role:"templates"` 最多一个；`frontMatter.required` 非空。
`role:"raw"` 是**可选**的 —— 这一条不对称是 `archiveDirOf` 唯一会失败的原因。

三个角色的实际作用：`inbox` → 徽章计数、`.eas-sources.json` 落点、`walkNotes` 跳过；
`raw` → `walkNotes` 跳过 + 归档落点（取**第一个**）；`templates` → 只从 index.md 分区里排除。

## 二、`wiki_query` 返回的数据形状

一次调用穿过三层，每层都会改形状 —— **agent 最终看到的不是 IPC 那份**：

`ipcMain.handle('wiki:query')`（`index.ts:392`）→ `mcpHandler.ts:733` 重包 → MCP `wiki_query`。

| 库的状态 | IPC 层返回 | agent 实际收到 |
|---|---|---|
| 没配置 | `{configured:false, exists, looksEmpty}` | `{configured:false, hint:'…也别主动建议他去建一个'}` |
| 目录没了 / `looksEmpty` | 同上三个字段 | `{configured:true, exists, looksEmpty, hint:…}` |
| `taxonomyBroken` | `{configured, exists, looksEmpty:false, taxonomyBroken:true, taxonomyError}`<br>**提前 return，不带 dirs / library / index** | `{configured:true, hint:'什么都别做…去把 .eas-wiki.json 改好'}` |
| 内置库（`none`）| `{path, index, dirs}` —— **无 `library` 字段**（老库响应形状的不变量）| 同字段 + `hint`（教它看 `dirs.me`）|
| 自定义库（`valid`）| `{path, index, dirs, library: t.dirs}` | 同字段 + `hint`（教它**忽略 dirs**、按 `library` 走）|

- `index` = `index.md` 原文全文，读不到就空字符串（不报错）。
- `dirs` = `WikiDirNames`，八个固定键：`inbox/me/people/methods/domains/projects/sources/templates`。
- `library` = `TaxonomyDir[]`，逐条 `{name, purpose, role?}`。**它的存在与否就是"是不是自定义库"的信号。**
- 每次调用都当场读盘，不缓存（换位置/建库/解绑立即生效）。

## 三、哪些操作真的改硬盘

| IPC / 入口 | 改什么 | 位置 | broken 闸门 |
|---|---|---|---|
| **`reconcileOnStartup`（无 IPC，注册时自动跑）** | 调 `initWiki` 建目录 + 升级 CLAUDE/AGENTS 围栏 | 库内 | initWiki 自挡 |
| `wiki:init` | `mkdir` 全部分类目录；写 `CLAUDE.md`/`AGENTS.md`/`index.md`/`log.md`/`START-HERE.md`（已存在不覆盖）；老格式迁移前写 `.eas-backup` | 库内 + `wiki.json` | 自挡（原样返回 `blocked`）|
| `wiki:archive` | `mkdir <raw>/<YYYY-MM>`，`renameSync` **移动**原件 + 逐字稿 | 库内 | `archiveDirOf` 挡 |
| `wiki:addToInbox` | `copyFile`（默认）或 `rename`（move=true）进收件箱；写 `.eas-sources.json`；`wiki.json` 的 `added` 计数 +N | 库内 + `wiki.json` | 有 |
| `wiki:saveTranscript` | `mkdir .transcripts` + 写 `<媒体名>.txt` | 库内 | 有 |
| `wiki:log` | `appendFileSync` 追加一行到 `log.md` | 库内 | **无**（log.md 与分类无关，可接受）|
| `wiki:gitInit` | `git init` + 写 `.gitignore`（首次）+ commit | 库内 `.git` | 无 |
| `wiki:snapshot` / `wiki:commit` | `git add -A` + commit（无改动则不产生空提交）| 只动 `.git` | 无 |
| **`wiki:rollback`** | 先 commit 保留现场，再 `git reset --hard <sha>` —— **会真删/真改工作区文件**，本模块破坏力最大的一个 | 库内 | 无 |
| `wiki:setPath` / `wiki:forget` | 只改 `userData/wiki.json` 的 `path`（保留 `added`）| **库外** | — |
| 只读：`graph`/`lint`/`stats`/`status`/`query`/`inbox`/`search`/`backlinks`/`transcript`/`archiveDirCheck`/`history` | 不写 | — | — |
| 副作用非写盘：`pickPath`/`pickFiles`（对话框）、`reveal`（`shell.openPath`）| 不写 | — | — |

三条贯穿的安全约定：**只移动不删除**（重名走 `uniqueName` 加后缀）；
**归档落点写死在 raw 目录下**，`it.rename` 只取 `basename`，不接受任何路径成分；
**收件箱绝不 gitignore**（注释里记着：那会让回滚把已归档文件从素材区删掉、而收件箱里早没了 → 文件彻底消失）。

## ⚠️ 最容易踩的一处：自定义库的 `dirs` 是"半真"的

`wiki:query` 对自定义库**照样返回 `dirs: dirNames(st.path!)`**（`index.ts:437`）。
而 `dirNames()`（`schema.ts:46`）内部：

```ts
inbox: inboxOf(root),        // ← 走 libraryDirs，自定义库返回配置里的 inbox 名：真的
me: dirOf(root, 'me'),       // ← dirOf 只查 LEGACY 表和盘上存在性，
people: dirOf(root, 'people'),//   完全不看 .eas-wiki.json → 一律返回内置英文名：假的
… sources / templates 同理
```

于是一个自定义库拿到的 `dirs` 是 **1 个字段正确 + 7 个字段指向盘上不存在的目录**。

**为什么这比全错更危险**：现在靠三道纯提示词防线堵它 —— MCP 工具描述说"有 library 就忽略 dirs"、
`mcpHandler` 的 hint 再说一遍、库内 CLAUDE.md 第三遍。三道全是**说给模型听的**，没有一道是代码约束。
而模型去核对时会发现 `dirs.inbox` 确实存在于盘上 —— 这个"抽样验证通过"恰好会把它推向信任整个 `dirs`，
接着按 `dirs.me` 写笔记，在自定义库里凭空建出配置外的 `me/`。这正是仓库注释里 Critical 2 的
伤害形态，代码只堵住了 `broken` 那条路（提前 return），**`valid` 这条路是敞开的**。

**并且这一处测不到**：`dirNames` 在 `schema.ts`，`schema.ts` → `paths.ts` → `electron`，
`node --test` 在模块解析阶段就失败。43 个现有用例里没有一条覆盖它 ——
`taxonomy.test.ts` 只验了 `library` 字段的数据源，`paths.test.ts` 只验 `rawDirOf`/`isRawName`。
整个模块最讲究的"纯 node 可测"分层，恰好在这个字段上失效了。

**最小修法**（供后续批次参考，本批未改代码）：`wiki:query` 里改成
`...(t ? { library: t.dirs } : { dirs: dirNames(st.path!) })` —— 自定义库干脆不给 `dirs`，
把"忽略它"从提示词降级成物理事实。风险：`dirs` 对内置库的形状必须一字不动（老库不变量）。

## 顺带记下的两处（不在本批三问范围，未深挖）

- `walkNotes` 的 `budget = { n: 20000 }` 是**递归共享**的计数器，超了直接静默返回。
  库超过两万个条目后，笔记数、图谱、体检、搜索会一起变得不完整且不报警。
- `isRawName` 只匹配顶层目录名（`rel` 在顶层等于目录名）。这与"目录名禁止含斜杠"的校验是配套的，
  当前自洽；但若哪天放开嵌套分类，raw 判定会静默失效。
