# 更多 · 用量仪表盘验收记录（2026-09-10）

## 交付与范围

- 分支 `feature/usage-drawer`，工作区 `.worktrees/voice-regression`；版本号不变，未合并、未发版。
- 规格与计划：`docs/superpowers/{specs,plans}/2026-09-10-usage-drawer.md`。
- 右侧入口改更多，三页：用量仪表盘 / 技能库 / 知识库；复用原组件。
- 真实请求时间分桶、项目缩略趋势、项目筛选、会话全期总量与每轮明细（100 条/页）、阶段手动标记、CSV。
- 不扫描聊天日志；没有额外模型请求、没有新网络服务、没有新增依赖。独立账本固定 `userData/usage-ledger.json`；90 天/50,000 轮，异常文件大于 40MB 拒读/拒写，保留原文件并提示。

## 数据准确性

- Codex 输入含缓存，不能再加一次。Claude 输入加缓存读/写。OMP 核对本机安装的 18.0.11 源码 `src/modes/acp/acp-agent.ts:2187–2211`：本轮 usage 是 session statistics 差值，优先 totalTokens-outputTokens 算总输入。
- meter 仅由真实上报生成，旧 UI 合成零不进入计量。费用只认 Claude 同进程连续累计样本差；首次/跨进程/缺报区间未知，其他 CLI 的费用暂未知，不做估价。
- FIFO 按实际投递轮次而非会话去重；停止、窗口销毁和退出清理；ACP 活跃轮取消与握手队列取消分开。
- 未采集/超出保留边界时间段断线，空态/全部未知的峰值显示「—」，不显示绘图防除零用的 1。

## 验证

- TypeScript 检查通过；构建通过；hooks / accent contrast / CSS balance / animation 检查通过。
- 全量测试使用 `--test-concurrency=4`：2850 项，2837 通过，13 跳过，0 失败（最终日志见 suite.log）。
- 两轮独立代码审查：排队漏账、模型归属、未知区间零线、停止 FIFO 残留、损坏 stage 字段均修正并复核。
- `node scripts/verify-usage-service.mjs` 通过真实 Electron IPC：队列/模型/取消/汇总/阶段保存/落盘/导出/guardPath 拒绝范围外写入；制造 EISDIR 保存失败，确认对话采集不抛、查询提示故障，恢复后成功保存。
- **此服务测试只有保存对话框是测试桩**，其余 IPC 与文件守卫真实。未逐步点击原生保存对话框。
- 真应用 UI 证据：`ui-results.json`，235 轮模拟记录；三个 tab 切换正常、两项目折线、7 天中 4 个未覆盖点、30 天中 19 个未覆盖点、键盘聚焦与 blur 提示收起、分页、阶段表单保存、今日/30 天筛选、无横向溢出、无面板错误。
- 最新空实例：`empty-final.json`；峰值「—」，24 个未覆盖点，不伪造零。
- 截图已亲眼检查：`dashboard-final.png`、`projects-final.png`。截图数据全部是隔离模拟数据，不是真实账单。

## 失败记录（不隐藏）

1. 初次回归：计量 metadata 有意新增，原事件快照失败；审核差异后仅更新 meter/interrupted，渲染层快照未改。
2. 主进程 VM 测试新增旁路依赖缺测试桩出现 `ReferenceError: interruptUsage is not defined`；补齐测试注入；曾重复注入导致 TS2300，随后修正并通过。
3. 默认并发某次 npm run check 的 3 个时序测试失败：
   - `real POSIX terminal Ctrl-C reaches native CLI once and leaves it interactive`
   - `owned IPC cancel during exec waits for the actual child to exit`
   - `owned IPC disconnect during exec waits for the actual child to exit`
   后两项均在 5 秒等待断言处失败。相关测试单独复跑通过；限制并发 4 的完整套件通过。疑似并发时序抖动，**未修改生产 launcher，也未放宽超时断言**。
4. 真机空态检查发现峰值把防除零值 1 展示出来；已修正为未知「—」，同位置重新验证通过。

## 未验证 / 非本轮范围

- 未发起真实付费 CLI 请求、未与供应商账单对账；使用真录 CLI fixture + Electron 服务测试。
- 未实测 Windows 安装包；未重新遍历知识库真实笔记的编辑/拖拽，避免修改用户资产。
- 不包含主工作区其他尚未提交修改；不做历史账单回填、自动任务语义分类、预算拦截。

## 复现

```sh
npm run typecheck
node --test --test-concurrency=4 'src/**/*.test.ts' 'src/**/*.test.mjs' 'hooks/*.test.mjs' 'resources/plugins/*/lib/*.test.ts'
npm run build
node scripts/verify-usage-service.mjs
node scripts/verify-usage-drawer.mjs
```

开发 UI 验收脚本只创建临时 userData，不复制凭证或聊天历史。关闭后仅删除该测试目录，原正式应用不受影响。

补充：临时 HTML 截图脚本曾错误按包路径 require Electron，出现 `TypeError: Cannot read properties of undefined (reading 'setPath')`。已修正为内置 `require('electron')`，只结束该临时截图进程；重新渲染报告通过（两张内嵌图均解码成功，无横向溢出、无外部资源）。产品构建未受此脚本错误影响。
