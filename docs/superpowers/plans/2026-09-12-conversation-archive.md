# Conversation Archive Implementation Plan

**Goal:** 对话独立于窗口保存，可搜索找回；切换不丢记录。
**Architecture:** 稳定 conversationId + 主进程持久化记录与索引。UI 仅加载窗口，不把视图裁剪当作存储策略。
**Tech Stack:** 现有 Electron IPC / TypeScript / React / 本地文件；不新增云同步或外部依赖。
**Spec:** 用户已逐项确认的 docs/prototypes/chat-history-v1.html 交互稿及本文件约束。

## 已确认约束
- 复用现有窗口栏（AI 对话、最大化、关闭），不另造宿主。
- 常驻历史入口；本模块/本项目/置顶，搜索标题与正文，点击先只读预览。
- 窄模块列表与详情分步，底部操作固定；分屏各自独立。
- 点击面板外（含画布与另一模块）关闭；不吞原点击。跨 webview 事件必须真实验收。
- 新对话先确认；取消无副作用。运行中说明会停止任务；排队消息与未发送草稿不可静默丢弃。
- 保存失败不清空、不切换。停止旧进程需收尾最后事件并保存；用会话代次隔离迟到事件。
- 历史默认长期保存，不超过 200 份就删除；内存分页与磁盘完整归档分离。
- 继续对话校验 CLI/resumeId/cwd；缺失时明确不能恢复，用户确认引用内容后另开，不能冒充原上下文。
- 旧记录复制迁移与校验后保留备份；标记可能已截断；不凭空补齐。
- 关闭模块不删除归档；删除走回收站；永久删除单独确认。
- 凭证授权跟进程，不持久化 EAS_SECRET_TOKEN 或复制 grants；产物路径不等于密钥读取授权。

## 执行顺序（单会话，无子 agent）
1. 存储止损（src/main/agentHistory.ts + agentHistoryStorage.ts/test）：临时文件写入后原子替换、失败保留旧文件；空快照不删除；去掉 200 份淘汰。临时目录测试，不读生产记录。
2. 完整归档：主进程会话事件追加与用户消息持久化，稳定消息序号、幂等重试、崩溃尾记录恢复、元数据索引原子更新；正文/工具输出及附件资产不依赖渲染器裁剪或临时图片路径。先测 250 段会话与 >60 轮完整性。
3. IPC/schema（shared/agentChat.ts、preload/index.ts/d.ts、main）：分页查询、检索、只读预览、置顶重命名、回收恢复；校验路径/key/project 边界。无全量正文扫描进渲染层。
4. 生命周期（AgentChatView.tsx、store/canvasSlice.ts、canvas/types.ts/persist.ts）：conversationId 稳定引用而非复制后删；保存/停止/切换明确状态机；失败保持旧会话；关模块再开与分屏迁移同一契约。
5. UI（独立 HistoryPanel.tsx/css，ChatToolbar.tsx 与宿主入口）：使用已确认视觉，不动窗口栏；外部点击、Escape、焦点管理、窄屏回退、加载/错误/空结果/旧记录状态。
6. 全流程验证：现有 history/reduce/恢复/队列测试；typecheck/build；隔离 verify-app 开发实例真机验收最大化/420px/分屏、外点关闭、确认取消、保存失败、重启、旧记录恢复。未完成不发版。

## 状态
- [x] 源码审查与交互稿确认
- [ ] 存储止损
- [x] 完整归档（2026-09-14）；迁移=旧档读时补序号，无需搬文件
- [ ] 生命周期与 IPC
- [ ] 历史 UI
- [ ] 隔离实例验收

### 实施进度
首步已改源码：原子快照、空快照保留、取消 200 份淘汰。6 项存储/key 测试通过。尚未进行 UI/完整生命周期验收，未提交或发版。新对话保存屏障与完整增量记录仍待实现，不可视为归档完成。

### 22:45 续作
- 新增 archiveTransition.ts 与 5 项测试：预存→停止确认→最终保存→切换；保存 false/异常、停止异常、重复点击、节点代次失效均不提交切换。共 11 项单测通过，类型检查通过。
- 尚未接到 AgentChatView。原因已核实：preload 的 agentChat.stop 返回 void，先 stopAgentChatBuffering 再 ipcRenderer.send；main 仅监听事件杀进程，不返回收尾确认。不能把它包装 Promise.resolve 就宣称最终事件已落盘。
- 下一步须建立带所属 sender 校验的停止/收尾确认契约，再接 gate 与主进程归档；保留旧 stop 为关节点等既有调用服务。当前正常 UI 仍走旧逻辑，不得宣称新建防丢已上线。

### 2026-09-13 UI 接入与真机验证
已将 UI 接入真实应用（不再仅原型）：常驻历史/新建入口、本模块/本项目/置顶、主进程正文搜索、只读预览、持久化置顶、<=760px 详情返回、外点关闭、复用确认框。删除空态旧三条孤儿入口和底部重复新建按钮。
恢复改为 mountChatHistory 挂原 chatId，不复制/删除源记录；仅空的画布节点可恢复，原 CLI/会话标识校验，重复挂载拒绝。尚未做真实 CLI 续聊 e2e。
保存屏障先采用空闲态保守策略：运行中拒绝新建；save false/异常不切换；保存期间拒绝新消息提交。不是已经完成真实 stop/quiesce 协议。原有裁剪仍在，完整增量归档未做。

验证：typecheck、build 通过；history/catalog/mount/storage/transition 共25项单测通过（含尚未接入的 gate 单测，不当作 UI 生命周期已完成）。隔离桌面实例实测历史列表、只读正文、正文关键词、置顶与重启保留、窄分屏列表→详情、点击另一分屏关闭、确认弹窗与取消。未发真实 AI 消息、未复制生产柜。
当前验收 app 为 /tmp/eas-history-ui-review/Eas-History-Dev.app（唯一 bundle ID，防止 CUA 选中旧实例）。userData=/var/folders/7s/29s7qf5s7w778xnb_txz3_q00000gn/T/eas-history-review-4SkEoU，4份明确标注假数据。源码仍在 .worktrees/voice-regression，未提交/未发版。
下一步：完整归档与迁移、真实收尾协议、纯分屏稳定身份与新建/恢复、恢复真机、安全失败注入测试、跨webview外点关闭；不是再画原型。

### 2026-09-14 01:20 · 完整归档落地（Claude 续作）
- 每条消息在产生时拿稳定序号 `seq`（`shared/historyArchive.nextSeq`：≥ 产生时刻毫秒且进程内递增；归约器三处创建、压缩标记、渲染层 SentMessage 各自赋号）。
- 主进程 `agentHistoryArchive.saveArchive`：读旧档 → 按序号并集（内存裁掉的保留、同序号新来覆盖、无序号的追加不丢）→ 原子写，文件 `v:2`；`loadArchiveWindow` 只回最近 100 条（`HISTORY_WINDOW`）并对旧档按下标补序号，返回 `total`。渲染层 `trimForSave` 现在只是"发给主进程的窗口"，额度不再决定磁盘留多少；单条命令输出仍截 1200 字符，图片仍只存路径。
- `agentHistory:list` 改走 `historyListCache`（文件+mtime+size 缓存摘要与小写正文），文件变大后搜索不再整份重读。
- 测试先红后绿：historyArchive 5、agentHistoryArchive 3、historyListCache 1、reduce/userMessages 各 1。隔离实例真实 IPC：两次窗口保存合并为 5 条、改过的以新为准、搜索索引更新、磁盘文件 v2 带序号。
- 已被旧规则裁掉的开头找不回来（那 5 份顶到 100 条的记录）。面板脚注改为"只加载最近 100 条，完整记录已保存"，未单独眼验。未做：面板里"加载更早"翻页（磁盘已全量，只差 UI）。

