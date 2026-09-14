# 运行中心「最近结束」与「按项目筛选」 · 隔离验收（2026-09-14 00:30 PDT）

| 步骤 | 观察 |
|---|---|
| 节能下对项目 p-verify 发起符号索引并取消 | `runtime:monitor.recent`：`symbols:1`「符号索引」outcome cancelled、projectId p-verify、durationMs 1931 |
| 运行中心 | 「最近结束」行"符号索引 · 已取消 · 20 秒前 · 用时 1 秒"；筛选下拉选项：全部 / voice-regression（p-verify）/ 未关联项目 |
| 选「未关联项目」 | 记录区显示"该筛选下没有记录"，那条 p-verify 的记录隐藏 |
| 选 p-verify | 记录重新出现；无错误边界 |
| 下拉样式 | 第一版是系统白底（`before-select-style.png`）；改用 `.cset-row select` 同一组令牌后与暗色面板一致（计算样式 bg rgba(255,255,255,.07)、fg rgb(226,228,234)），见 `runtime-center-recent-filter.png` |

未验：服务退出落入「最近结束」只有单测（ownedSessions completed → exited）；插件工具调用（toolActivity）的结束未接入该记录。
