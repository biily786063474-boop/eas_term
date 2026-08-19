# 教训注释 × 测试兜底 审查结论

**一句话**：源码里 406 条教训注释，**338 条（83.2%）所在的文件连一个测试都没有**；
其中 21 条是「纯逻辑、可单测、破坏后果严重」的真空档 —— 下面按后果严重程度排好，可直接照着补。

审查基线：`npm test` 718 用例全绿（未改动任何代码）。判定口径见 `progress.md`。

---

## 结论摘要

| | |
|---|---|
| 高信号教训注释 | 406 条 / 125 个源文件 |
| 落在**无同名测试**文件里 | 338 条（83.2%） |
| 有同名测试的源文件 | 24 个（全项目 226 个源文件） |
| 本清单列出的真空档 | **21 条**（纯逻辑 + 可测 + 破坏有实际代价） |
| 其中零改动就能补测的 | 4 条（A 级） |

**这个项目的测试不是写得差，是写得少而准。** 已有的 718 条用例质量很高
（断言精确到字面值、专门防「换个实现照样绿」），问题是它们只覆盖了那些**已经被抽成
纯函数文件**的模块。凡是还留在 `import { app, ipcMain } from 'electron'` 大文件里的
不变量，一条都没兜住 —— 而密钥柜、文件写边界、用户全局配置写入这三块**全在后者**。

---

## P0 · 破坏后 = 用户资产受损

### 1. `src/main/fsGuard.ts` — 全应用文件写操作的安全边界，零测试

| | |
|---|---|
| 位置 | `fsGuard.ts:36 realResolve` / `:54 invalidNameReason` / `:77 guardPath` / `:95 guardDir` |
| 教训注释 | `:1-10`「一句 `window.api.fs.trash('/Users/xxx')` 就能把整个 home 扔进废纸篓」；`:35`「symlink 会让字符串前缀比对形同虚设」；`:53`「`..` 是重点 —— 原来的 `/[/\\:]/` 挡不住它」 |
| 现状 | **没有 `fsGuard.test.ts`。** 全项目 10+ 个写盘入口（fs.rename/trash/mkdir、snapshot、agentChat 的 hook 安装）都靠它，一条测试都没有 |

不变量有四条，每条被破坏都是静默的：

1. `realResolve` 必须解析软链再比 —— 否则项目里放一个指向 `/` 的软链就绕过整个边界
2. 前缀比对必须是 `real.startsWith(root + path.sep)`（guardPath `:88`、guardDir `:104`）—— 少了 `path.sep`，
   `/Users/me/proj-private` 会被 `/Users/me/proj` 放行。**这条连注释都没有，纯靠代码写对了**
3. `guardPath` 拒绝根目录本身，`guardDir` 允许 —— 两个函数差这一行，改混了不会报错
4. `invalidNameReason` 必须挡 `..` / 首尾空格 / 控制字符

**建议**（B 级，抽出后可测）：`invalidNameReason` 零依赖，`realResolve` 只依赖 `fs`
—— 把这两个搬到 `src/main/fsPathGuard.ts`（照 `snapshotPaths.ts` 的先例），
`guardPath`/`guardDir` 的比对逻辑改成接受 `roots: string[]` 参数的纯函数
`matchRoot(real, roots, {allowRoot})`，`fsGuard.ts` 保留读 projects.json 的那层。
测试用例：

```
// fsPathGuard.test.ts
- invalidNameReason：'..' / '.' / ' a' / 'a ' / 'a/b' / 'a:b' / '\x00' / 256 字符 → 各自的拒绝理由
- invalidNameReason：正常中文名、带空格的中间名 → null
- matchRoot：/root/sub 命中 /root
- matchRoot：**/root-other 不命中 /root**（少 path.sep 的那个 bug，这条是核心）
- matchRoot：real === root 时，allowRoot:false 拒绝、allowRoot:true 放行
- realResolve（tmpdir 造真软链）：/tmp/x/link → /etc 时，realResolve('/tmp/x/link/passwd')
  必须解析成 /etc/passwd 而不是 /tmp/x/link/passwd
- realResolve：目标不存在时退到最深真实祖先再拼回（新建文件场景）
```

---

### 2. `src/main/secrets.ts:350` — 文件型密钥永不进环境变量

| | |
|---|---|
| 教训注释 | `:346-349`「**文件型永远不进 env。** 把 SSH 私钥的内容塞进环境变量，等于让这个终端里跑的任何东西（npm 的 postinstall 就够了）直接读走你所有服务器的登录凭证」 |
| 代码 | `if (v.file) continue` —— **一行** |
| 现状 | 没有 `secrets.test.ts`。删掉这一行，功能看起来"更完整了"（文件型也能注入了），零测试变红 |

同一个函数 `secretsEnv()` 里还有两条同级不变量：
- `:330` 锁定态一律不注入（注释：「实测下来是个洞：AI 自己就能开终端，于是锁不锁完全一样，六位码变成纯装饰」）
- `:336` 未指定 names 时只取 `autoInject` 的那些

**建议**（B 级）：把 `secretsEnv` 的挑选逻辑抽成纯函数
`pickSecretVars(items, {names, unlocked}): {itemId, varName, cipher}[]`，
放 `src/main/secretsPick.ts`，`secrets.ts` 只负责解密和写 lastUsedAt。测试用例：

```
- 文件型（v.file 为真）无论如何都不出现在结果里 —— 哪怕 names 里点名要它
- 锁定态（unlocked:false）→ 空结果，不管有多少条标了 autoInject
- names 未传 → 只有 autoInject 的组
- names 传空数组 → 空结果（"明确不要注入任何东西"，与未传区分开）
- names 点名某组里的两个变量 → 只出这两个，同组第三个不出
```

---

### 3. `src/main/dict.ts:48 sanitizeSvg` — 模型生成内容通往 innerHTML 的唯一关卡

| | |
|---|---|
| 教训注释 | `:42-46`「词条的 svg 走 dangerouslySetInnerHTML 渲染，而这段内容是**模型写的**——脚本、事件属性、外链引用一旦漏过去就是执行口子」；`:61`「javascript: 协议、外部资源引用（**单双引号都要管——只挡一种等于没挡**）」 |
| 消费点 | `src/renderer/src/features/dict/DictView.tsx:261` `dangerouslySetInnerHTML={{ __html: hover.term.svg }}` |
| 现状 | 没有 `dict.test.ts`。这是词典模块唯一的 XSS 防线 |

「单双引号都要管」这条尤其危险 —— 那是**两行长得几乎一样的正则**，任何一次
"消除重复"的重构都会把它合并掉，而合并写错了不会有任何信号。

**建议**（B 级）：`sanitizeSvg` 是零依赖纯字符串函数，搬到 `src/main/dictSvg.ts` 并导出。测试用例：

```
- 非 <svg 开头 → 返回空串（不猜、不修补）
- <script> 整段被剥
- <foreignObject> 整段被剥
- iframe/object/embed/link/style/image/use 开标签被剥
- onclick="..." 被剥；**onload='...'（单引号）也被剥** ← 防合并正则的核心用例
- href="http://evil" 被剥；href='http://evil' 被剥；**href="#local" 保留**（锚点是合法的）
- xlink:href 与 src 同样两种引号都管
- javascript: 字面量被剥（大小写混写 JaVaScRiPt: 也要中）
- 8001 字符 → 返回空串；8000 字符 → 保留
```

---

### 4. `src/main/secrets.ts:228 seal / :236 open` — 密文完整性校验

| | |
|---|---|
| 教训注释 | `:17-28` 文件头「三个会静默失效的坑」第 2 条 + `:224-227`「safeStorage 在 macOS 用 AES-CBC 没有认证标签。**实测 3000 次随机翻转一个 bit，62.9% 会通过 padding 校验、静默解出错误内容**——不是小概率」 |
| 现状 | 零测试。这是「对着 401 排查半天」的根因防护 |

不变量：`open(篡改过的密文)` 必须返回 `{ok:false, reason:'tampered'}`，
**绝不能返回 `{ok:true, value:<错的>}`**。

**建议**（B 级）：`seal`/`open` 里真正的不变量在 payload 层，与 safeStorage 无关。
抽成 `sealPayload(value): string` / `openPayload(plain): OpenResult`
（放 `src/main/secretsSeal.ts`），`secrets.ts` 里 `seal = encrypt(sealPayload(v))`。测试用例：

```
- openPayload(sealPayload('sk-xxx')) → {ok:true, value:'sk-xxx'}
- payload 的 v 被改一个字符、c 不动 → tampered
- payload 的 c 被改一个字符 → tampered
- c 长度对不上（timingSafeEqual 会抛）→ tampered，不抛异常  ← 现在靠 catch 兜的，要锁住
- 不是 JSON / 缺 v / 缺 c / v 不是字符串 → tampered
- 空字符串值也能正确 round-trip（别被 falsy 判断吞掉）
```
另外文件头第 1 条坑（ready 之前碰 safeStorage 会污染整个进程）属于 C 级，测不了 —— 见末节。

---

### 5. `src/renderer/src/features/workspace/secretRequest.ts` — 防钓鱼限流三条

| | |
|---|---|
| 教训注释 | `:3-8`「**限流是这个功能的安全组件，不是体验优化**：一个跑飞的 agent 能连弹几十个窗，弹到第五个的时候人就开始无脑点「确定」了 —— 弹窗疲劳本身就是攻击面」；`:14-16`「ptyId 存在 pending 里……回传过一次就漏过一次：取消次数记到了 '-' 上，于是「连续拒绝 2 次拉黑」整个不生效（**端测抓到的**）」 |
| 现状 | 零测试 |

**这条最刺眼的地方是对照组**：同目录风格的 `features/team/batchRequest.ts` 是几乎同构的模块
（弹窗排队 + 连续取消拉黑 + 超时兜底），它有 `batchRequest.test.ts` **10 条用例全覆盖**。
同一个模式，一个测了一个没测 —— 而没测的那个守的是密钥。
注释里那句「端测抓到的」正是没有单测的代价。

**建议**（A 级，零改动 —— 这个文件只 `import type`，写个 `secretRequest.test.ts` 直接就能跑）。
照抄 `batchRequest.test.ts` 的结构，用例：

```
- 正常弹一次 → resolve 带回用户选择
- pending 非空时第二次 askForSecret 抛异常（"直接回绝而不是排队等"）
- 60 秒内第二次 ask 抛异常，并在消息里给出剩余秒数
- **ask 和 fix 各算各的间隔**：ask 之后立刻 fix 不被挡（注释 :23-28 点名的那条路）
- 同一 ptyId 连续取消 2 次 → 第三次 askForSecret 抛"已被拒绝 2 次"
- **拉黑按 ptyId**：ptyA 被拉黑，ptyB 照常能弹  ← 那个 '-' bug 的回归用例
- 中途 saved:true 一次 → cancelStreak 清零，再取消 1 次不触发拉黑
- ptyId 为 undefined 时归到 '-' 桶，不与真实 ptyId 串台
```

---

### 6. `src/main/mcpBridge.ts:250 writeClaudeConfig` / `:355 writeCodexSection` — 写用户全局 CLI 配置

| | |
|---|---|
| 教训注释 | `:261`「文件存在但读不动/解析失败时**绝不写**——否则会把用户整份 Claude 配置覆盖没」；`:255`「没装 Claude Code 就别碰用户的 home」；`:301-303`「刻意不用正则：`[^[]*` 那种写法会被 `args = [...]` 里的方括号截断，导致只替换掉半段、把后半截留成一行孤立的 `["..."]`（TOML 里那是个 table header，**等于每次启动往用户配置里塞一行垃圾**）」；`:380-381`「段尾的空行和注释要退回去……吃掉它等于删用户的注释」；`:146-149`「2026-08-06 实测撞到：验证功能跑了几次 dev，回头发现全局配置被改了」 |
| 现状 | 零测试。这两个函数在**每次应用启动时**都跑，写的是 `~/.claude.json` 和 `~/.codex/config.toml` |

`writeCodexSection` 的段替换算法有 5 条独立不变量，全是纯字符串处理：
① 段尾 = 下一个顶格 `[` 行；② 段尾的空行/注释退回给下一个 table；
③ 内容无变化不写盘（幂等）；④ 后面有内容时补空行隔开；⑤ 目录不存在不建。

**建议**（B 级）：把纯文本部分抽成 `upsertTomlSection(raw: string, head: string, blockLines: string[]): string | null`
（返回 null = 无变化不写盘），放 `src/main/tomlSection.ts`。
项目里已有完全同款的先例可抄：`legacyDshCleanup.ts` + `legacyDshCleanup.test.ts`
就是把「摘围栏段」抽出来测的。测试用例：

```
- 空文件 → 追加一段，末尾一个换行
- 已存在且内容相同 → 返回 null（不写盘）  ← 防"每次启动塞垃圾"
- 已存在但 args 变了 → 就地替换，段外内容一字不动
- **段里含 args = ["a","b"] 时段尾判定正确**  ← 正则那个坑的回归用例
- 段后面紧跟 `# ─── 笔纵画板 ───` 注释 + 下一个 [table] → 注释必须留给下一个 table
- 段后面是另一个 [table] 且中间无空行 → 补一个空行
- 段是文件最后一段 → 不在结尾造出多余空行
同时给 writeClaudeConfig 抽 mergeMcpServers(cfg, entries): {next, dirty}：
- cfg 是 null / 数组 / 非对象 → 拒绝（dirty:false，调用方不写盘）
- 用户已有的其它顶层字段一个都不能丢
- servers 内容完全一致 → dirty:false
```

---

## P1 · 破坏后 = 功能静默失效（不报错、不崩，只是不再生效）

### 7. `src/renderer/src/store/canvas/persist.ts:104` — 坏存档防御

| | |
|---|---|
| 教训注释 | `:101-105`「磁盘 canvas.json 可能『能 parse 但成员畸形』……直接灌进 state → 渲染期 `f.nodes.forEach`、`vp.scale(NaN)` 抛错 → 无 Error Boundary 时整树白、且因订阅未挂覆盖不了坏档 → **永久打不开**」 |
| 现状 | 15 个 export（`sanitizeCanvas`/`sanitizeFrame`/`sanitizeNode`/`sanitizeShape`/`sanitizeViewport`/`clampScale`/`finiteOr`…）**一条测试都没有** |

**这是整份清单里最容易补的一条**：`persist.ts` 的 import 全是纯逻辑邻居
（`layout.ts` / `todoBoard.ts` / `viewModeRestore.ts`），而后两个**都已经有测试了**。
写个 `persist.test.ts` 零改动直接跑。

**建议**（A 级）用例：

```
- sanitizeCanvas(null) / (undefined) / ('字符串') / (数组) → 空场景 + 新默认视图，不抛
- frames 里混一个 {id: 123}（id 不是字符串）→ 那一条被丢，droppedFrames 计到 1，其余保留
- node.x = NaN / Infinity / '10' → 兜成 0（finiteOr）
- viewport.scale = NaN → 1；= 99 → 钳到 VP_SCALE_MAX(2.2)；= 0.01 → 钳到 VP_SCALE_MIN(0.2)
- frame.status 是用户自建的列名 → undefined（白名单固定那三个内置值，:163-168 注释点名）
- shape.type 不在 SHAPE_TYPES → 整条丢
- 老存档没有 todos 字段 → 空数组，**不是坏档**（:222 注释点名）
- frame.nodes 不是数组 → 空数组，frame 本身保留
- droppedFrames 精确等于被丢弃的 frame 数（用于 log，避免静默丢数据）
```

### 8. `src/main/snapshot.ts:19 withSnapshotLock` — 队列永不进 rejected 态

| | |
|---|---|
| 教训注释 | `:21-23`「队列本身永远不进入 rejected 态——否则某一次失败会连锁卡住后面所有排队的调用」；`:12-17` 并发互斥的完整推导 |
| 现状 | `snapshotTarget` 有测试（`snapshotPaths.test.ts`），**但那把锁没有** |

破坏方式很自然：有人看到 `snapshotQueue = result.then(()=>undefined, ()=>undefined)`
觉得冗余，简化成 `snapshotQueue = result` —— 测试全绿，
然后第一次截图失败之后**所有后续截图永久卡死**，还没有任何报错。

**建议**（B 级）：`withSnapshotLock` 零依赖，搬到 `src/main/serialQueue.ts` 导出。用例：

```
- 两个任务串行：第二个的开始时刻晚于第一个的结束时刻（用手动 resolve 的 Promise 编排，不用 sleep）
- 第一个任务 reject → 该次调用方拿到 reject，**第二个任务照常开始并成功**  ← 核心用例
- 连续 3 个任务，中间那个抛 → 第三个仍然跑，且拿到自己的结果
- 队列本身不产生 unhandledRejection（node --test 会把它算成失败，天然锁住）
```

### 9. `src/main/roles.ts:162` — 画师角色的生图 deny 列表

| | |
|---|---|
| 教训注释 | `:157-160`「这一条是整个角色系统里最值钱的地方：把生图红线从『靠提示词提醒』变成『工具在模型上下文里根本不存在』。Claude 的 deny **支持通配且必须匹配完整工具名**，所以这里写 `mcp__*xxx*` 形态」 |
| 现状 | 零测试。7 个通配模式（image/dalle/imagen/flux/banana/midjourney/stable*diffusion）是纯数据，删一个不会有任何信号 |

同文件 `:69` `:104` 还有两个角色的 `deny: ['Write','Edit','NotebookEdit']`（只读角色），
少一个就等于给了写权限。

**建议**（B 级）：`BUILTIN_ROLES` 已经是 export 的顶层常量，但 `roles.ts` import 了 electron。
把数组搬到 `src/main/builtinRoles.ts`（纯数据，零 import），`roles.ts` 再 re-export。用例：

```
- 画师角色的 deny 精确等于那 7 条（逐条字面量断言，不是 length >= 7）
- 每条 deny 模式都是 mcp__*…* 形态（前缀 mcp__ + 至少一个通配符）
- 只读角色（:69 :104）的 deny 精确含 Write/Edit/NotebookEdit 三项
- 「杂役」角色的 contract 是空串（:190 注释：故意留空，不给逃生口的系统会被绕过）
- 所有角色 id 唯一、group 取值在已知集合内
```
> 注：这条直接对应用户全局规范里的生图红线，破坏后果不只是软件 bug。

### 10. `src/shared/envParse.ts` — 主进程与渲染层共用的 .env 解析

| | |
|---|---|
| 教训注释 | `:1-3`「**主进程和渲染层共用同一份，别各写各的** —— 两边解析规则不一致时，用户会遇到『粘贴认出 3 个、从文件导入认出 2 个』这种鬼故事」 |
| 现状 | 34 行、**零 import 的纯函数，零测试** |

5 条解析规则全裸：`export ` 前缀剥离、单双引号剥离、同名取第一个（对齐 shell 的 source）、
空值跳过、非法变量名跳过。

**建议**（A 级，零改动）用例：

```
- FOO=bar / export FOO=bar → 同一个结果
- FOO="bar baz" / FOO='bar baz' → 值不含引号
- 引号只有一边（FOO="bar）→ 原样保留引号，不吞字符
- # 注释行、空行、没有 = 的行、= 在开头的行 → 跳过，不抛
- 1FOO=x / FO-O=x → 跳过（非法变量名）
- FOO=a 两次 → 只取第一个（:25 注释点名与 shell source 一致）
- FOO= （空值）→ 跳过（:29 注释点名理由）
- CRLF 文本正常解析
- 值里含 = （FOO=a=b）→ 值是 a=b，只切第一个 =
```

### 11. `src/main/agentRules.ts:171` / `:333` — 安装与卸载的文件清单必须对称

| | |
|---|---|
| 教训注释 | `:171`「**漏一样就是删不掉的残留**（同 MANAGED 那条教训）」；`:337-339`「落点不止一个文件……动态列出目录里实际存在的每个 .md，不写死数量或文件名，**否则「卸载会删哪些」这个隐私承诺就只报得出其中一个文件**」；`:40-45`「必须和上面的 home() 用同一个来源。这里原来是 os.homedir()……**实测踩到过**」 |
| 现状 | 零测试 |

这是**对用户的隐私承诺**（界面上如实告知动了哪些文件 + 一键移除），不是内部实现细节。

**建议**（B 级）：把 footprint 的路径收集抽成纯函数
`footprintFiles({claudeCanvasDir, detailDir, codexAgents, existingMd}): string[]`。用例：

```
- 详细正文目录里有 3 个 .md → 三个都出现在 files 里（不是只报 SKILL.md）
- codexRegionChars 为 0 时不列 AGENTS.md；> 0 时列
- 目录不存在 → 不报错、不产出幽灵路径
- 安装写过的每个落点，都出现在卸载清单里（同一份常量驱动两边，测同源）
```

### 12. `src/main/secrets.ts:841` — `EAS_E2E` 门禁

| | |
|---|---|
| 教训注释 | `:840-842`「**必须挂 EAS_E2E 门禁** —— 不设限的话就等于给渲染层开了一个『读任意路径文件』的口子，绕过 fsGuard 的项目边界」 |
| 现状 | 零测试。同样的门禁在 `:932` 还有一处（两处都得在） |

**建议**（B 级）：这条与 #2 一起抽时顺带处理 —— 抽成
`allowTestFilePath(testFile, env): string | null`，测「env 不是 '1' 时一律返回 null，
哪怕 testFile 是个合法绝对路径」，以及两个调用点都用它。

### 13. `src/main/secrets.ts:1039` — 变量名全局唯一 + 合法字符

| | |
|---|---|
| 教训注释 | `:1039`「注入到同一个 env，**重名会互相覆盖**，所以必须全局唯一」；`:1049`「环境变量名的合法字符。不挡的话注入时会拼出一个 shell 认不出的 env」 |
| 现状 | 零测试。破坏后果：注入一个错误的密钥值，然后对着 401 排查（与 #4 同一类症状） |

**建议**（B 级）：抽 `validateVarNames(rows, existingItems, editingId): {ok} | {error}`。用例：

```
- 同一组里写两遍同名 → 拒绝，消息点名是哪个
- 与另一条目占用的名字撞 → 拒绝，消息点名占用者的名字
- **编辑自己这条时不算与自己撞**（editingId 那条 continue，:1042）  ← 最容易改坏的分支
- 1ABC / A-B / 空 / 带空格 → 拒绝
- _ABC / A_B_1 → 放行
```

### 14. `src/renderer/src/features/terminal/usePastedImages.ts:112` — external 图不许删

| | |
|---|---|
| 教训注释 | `:7-8`「拖进来的文件**原地引用**，不复制一份，删缩略图时也绝不动人家的文件」；`:118`「external:true —— 文件在项目目录里、不归输入框管，松开缩略图时绝不能删它」 |
| 现状 | 零测试。破坏后果：**删掉用户项目里的原始文件** |

判据在三处重复（`:72` `:112` 各一个 `if (!im.external)`），任何一处漏掉都是删文件。

**建议**（B 级）：把「哪些该删」抽成纯函数 `removablePaths(imgs, sent): string[]`
（`sent` = 已经发出去的），hook 只负责调它。用例：

```
- external:true 的永不出现在结果里（单张、混合、全 external 三种输入）
- external:false 且未发出 → 出现
- external:false 但已发出 → 不出现（:12 注释：已经发出去的不能删，agent 还要读）
- 空数组不抛
```

### 15. `src/main/pty.ts:138 prependPath` — Windows PATH 拼接

| | |
|---|---|
| 教训注释 | `:129-136`「**必须走这个函数，别手拼。** 两个 Windows 专属的坑……分隔符是 `;` 不是 `:`，用冒号拼出来的根本不是合法 PATH，结果不是『找不到我们的命令』，是**把整个终端的 PATH 打废**……键名是 `Path`（有时是 `PATH`），直接写 env.PATH 会凭空多出一个键，真正生效的那个 Path 纹丝不动」 |
| 现状 | 零测试 |

**建议**（B 级）：6 行纯函数，抽到 `src/main/envPath.ts`，签名加一个 `delimiter` 参数
（默认 `path.delimiter`）好在 macOS 上测 Windows 行为。用例：

```
- env 里键是 'Path' → 写回 'Path'，不新建 'PATH'  ← 大小写那条，在 macOS 上也测得出
- env 里键是 'PATH' → 写回 'PATH'
- 两个键都没有 → 建 'PATH'，值就是 dir 本身（不留前导分隔符）
- 传 delimiter:';' → 用分号拼
- 已有值非空 → 新目录在最前面
```

---

## P2 · 破坏后 = 体验退化 / 可恢复

### 16. `src/main/agentSkill.ts:136` — outdated 判据必须与实际写入同源

教训注释 `:133-135`：「必须拿 syncRules 真正会写的那段来比。这里原来比的是 `codexBlock(src)`，
也就是『完整 SKILL.md 全文』—— 而实际写进去的是一段短路由，**两者永不相等，
outdated 恒为真 → 首启弹窗每次启动都弹，点了『安装』也照弹不误**」。
`:94-95` 又强调了一遍「两边必须是同一个来源」。零测试。

**建议**（B 级）：抽 `codexRegionOutdated(rawAgentsMd, expected): {installed, outdated}`。
用例：区间不存在 → 未装；区间内容 === expected → 不 outdated；差一个空格 → 不 outdated（trim 比对）；
差实质内容 → outdated；expected 为 null → 不 outdated（没有可安装内容时不该催）。

### 17. `src/main/island.ts:505` — `island:sync` 的形状校验

教训注释 `:506-509`：「running 和 notices **都要**校验：以前只查了 running，notices 若是
undefined/畸形……会在主进程里直接抛 TypeError——这个 ipcMain 处理器一炸，这一帧状态就丢了，
灵动岛跟着卡在上一帧。**防的不是『今天会发生』，是『以后改渲染层时忘了保证这个形状』**」。
—— 注释自己就点明了这是给未来重构准备的防线，而它恰恰没有测试。零测试。

**建议**（B 级）：抽 `sanitizeIslandState(state): IslandState`。用例：
null / undefined / running 不是数组 / notices 不是数组 / 两个都缺 → 各自回落 EMPTY；
两个都是数组 → 原样返回同一引用。

### 18. `src/main/island.ts:140 notchOf` — 刘海几何

教训注释 `:132-139` 带着**现成的实测夹具**：14" 3024×1964(比 1.540)、16" 3456×2234(1.547)、
非刘海屏 ≥1.6；宽度取 13.5%（实测 12.3%~12.6%，取略大是刻意的）。
判据阈值 1.58 是纯计算，零测试 —— 注释里的实测数据白记了。

**建议**（B 级）：抽 `notchGeometry(bounds, workArea, platform)`。用例直接把注释里的
三组实测分辨率做成表驱动 + 一组 16:9 + 一组超宽 + `bounds.height === 0` 不除零。

### 19. `src/main/wiki/index.ts:628 wiki:setPath` — 必须拦住不存在的目录

教训注释 `:630-633`：「以前这里照收，于是绑到一个打错的路径上之后，界面显示的是
『知识库是空的』——**和『文件真的被删了』长得一模一样**。真实踩过：路径少了一个空格，
人以为整个知识库丢了」。`wiki/paths.ts:45` 还重复记了一遍这个坑。
`paths.ts` 有测试，但**这条校验在 index.ts 里，没测到**。

**建议**（B 级）：抽 `validateWikiRoot(root, statSync): {ok} | {error}`。用例：
非绝对路径 / 不存在 / 是文件不是目录 / 正常目录 → 四种结果，且错误文案各不相同
（用户要靠文案区分「打错了」和「真没了」）。

### 20. `src/main/telemetry.ts:138` — `before-quit` 只报一次

教训注释 `:136-137`：「**实测 before-quit 在一次退出里会触发两遍**（第二遍 sec=1），
不去重的话服务端会把同一次会话记成两条」。零测试，数据质量问题，本地看不出来。

**建议**（B 级，低优先）：把 `quitReported` 那段抽成 `onceGuard()`，或在抽 #8 的 serialQueue 时顺带。

### 21. `src/renderer/src/features/canvas/media.ts:47 easfileUrl` — base64url 编码

教训注释 `:46`：「base64url，**避开 URL 转义坑**」。三个 replace（`+`→`-`、`/`→`_`、去尾 `=`）
加 `unescape(encodeURIComponent())` 的 UTF-8 处理，零测试。
破坏后果：含中文或特殊字符的路径媒体加载不出来（画布上一块空白，不报错）。

**建议**（A 级，`media.ts` 依赖 `shared.ts`/`mediaExts.ts` 都是纯逻辑）用例：
纯 ASCII 路径 round-trip；含中文路径 round-trip；含空格；结果里不含 `+` `/` `=`；
主进程侧的解码函数用同一组夹具反向验一遍（同源，防两边漂移）。

---

## 已被兜住的（说明判定口径可信，不是没看）

这 24 个文件的教训注释逐条对照过测试用例名，**确认真被兜住**，不需要动：

| 文件 | 教训注释被哪条测试锁住 |
|---|---|
| `agentChat/claudeEvents.ts` | 「拿不到分母就不填，绝不用猜的窗口大小顶上」「窗口类型不做枚举映射」「七天窗口带 utilization，五小时不带——按需出现不能假设都在」 |
| `agentChat/codexEvents.ts` | 「判据是 status 不是 error 字段」（文件头「教训（2026-08-14 实测纠正）」那条）+ output 精确等于 aggregated_output，不是 JSON dump |
| `agentChat/approvalRoute.ts` | 「超时兜底是拒绝不是允许」「只有明确的 allow 才是允许」「事后才点允许不广播第二次」 |
| `agentChat/hookInstall.ts` | 文件头「四条来自对抗性测试才撞出来的坑」→ 30 条用例逐条锁住，含 null 混入、marker 落错 matcher |
| `agentChat/sessionState.ts` | 「这是一处定义，别在别的文件里再写一个」→ 23 条覆盖待生效参数合并、restart 字段透传 |
| `agentChat/adapters/*.ts` | 「Claude 绝不能带 --bare 或 --permission-mode manual」「effort 取值与 CLI 实测一致」 |
| `agentChat/reduce.ts` | 文件头「三条硬约束（背后是实测教训）」→ 26 条用例 |
| `agentChat/startupPhase.ts` | 「awaiting 那个洞的教训：同一件事记在两个地方」→ starting 压过 failed、failed 压过 ready |
| `agentChat/toolbarModel.ts` | 「三条硬约束（背后是实测教训）」→ 用量绝不出现百分比、花费固定 4 位小数 |
| `canvas/viewModeRestore.ts` | 「亲手选了分屏和从没动过默认值长得一模一样」→ 9 条 |
| `canvas/todoBoard.ts` | 「不产生『未完成但有完成时间』的畸形数据」 |
| `wiki/paths.ts` | 「目录名不带空格（坑掉过 node-pty 编译）」「改名会让人以为知识库空了」 |
| `team/batchRequest.ts` | 「别自己维护一份会和现实脱节的状态」→ 10 条含拉黑按 Frame、超时不计入连续取消 |
| `legacyDshCleanup.ts` | 「摘掉围栏段，用户自己的条目一个字不动」 |
| `terminal/approvalParse.ts` | 「问句上方隔着空行的无关内容不许被当成正文」 |
| `canvas/teamMode.ts` | 「**默认不开**，会花钱的能力不能靠默认值放行」「查不到就不放行」 |

**这批测试的水准是清单的参照系** —— 补新测试请照这个标准写（断言字面值、
专门造「换个实现照样绿」的反例），不要写成 `assert.ok(result)`。

---

## 测不了的那一类（明确劝退，别照着补假测试）

这些教训注释同样没有测试，但**单测测不到，补了也是自欺**。它们该靠 CDP 端测、
真机验证或立档来守，不属于本清单的缺口：

- `island.ts` 的 macOS 激活节流、`verifyRealActivation`、`frontmost app ≠ key window`
  （`:564` `:641` `:674` `:688`）—— 依赖真实 AppKit 行为，且项目 memory 里
  「Eas-Term 前台判定」「灵动岛窗口坑」两份立档已经记着，那才是这块的载体
- `pty.ts` 的 ZDOTDIR 启动文件链、path_helper 顺序（`:68-86`）—— 依赖真实 login shell
- `pty.ts:504` 的 killTree 两个坑（独立进程组）—— 依赖真实进程树
- `GanttStage.tsx` / `GanttNavigator.tsx` / `CanvasStage.tsx` 的 DOM 偏移、
  取景框拖拽（16 + 7 + 7 条）—— 依赖真实布局与真实鼠标，memory 里
  「skill 面板与待办」已记着「只有真实鼠标才测得出的坑」
- `secrets.ts` 文件头第 1 条（ready 之前碰 safeStorage 污染整个进程）—— 依赖 Electron 生命周期
- `TerminalView.tsx` / `PaneLayer.tsx` 的渲染时序（12 + 8 条）
- `voiceCapture.ts` 的 ScriptProcessorNode 选型（`:3`）—— 是选型说明，不是可执行判据

---

## 建议的补测顺序

先做这四条 —— **零改动，写文件就能跑，能立刻把最脆的两块罩住**：

1. `src/renderer/src/store/canvas/persist.test.ts`（#7，防「画布永久打不开」）
2. `src/shared/envParse.test.ts`（#10，34 行纯函数）
3. `src/renderer/src/features/workspace/secretRequest.test.ts`（#5，照抄 batchRequest.test.ts）
4. `src/renderer/src/features/canvas/media.test.ts`（#21）

再做这三条抽取 —— **P0 里价值密度最高**：

5. `fsGuard` → `fsPathGuard.ts` + test（#1）
6. `dict.sanitizeSvg` → `dictSvg.ts` + test（#3）
7. `secrets.secretsEnv` 挑选逻辑 + `seal/open` payload → `secretsPick.ts` / `secretsSeal.ts` + test（#2 #4）

**两条纪律**（都是这个仓库自己的教训，写测试时会踩）：
- 值 `import` 一律带 `.ts` 扩展名（`persist.ts:8-11`）—— 不带的话整个测试文件
  ERR_MODULE_NOT_FOUND，而汇总行只会说 `fail 1`，很容易被当成某条断言挂了
- 抽文件时**原教训注释要跟着搬过去**，别留在旧文件里 —— 注释和它守的代码分家，
  下一个人只会看到一段没有上下文的判断
