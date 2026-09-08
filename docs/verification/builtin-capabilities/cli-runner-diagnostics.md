# 正式包 CLI 验证器诊断（2026-09-08）

## 0.4.85 第一轮诊断

`actual-omp-0.4.85` 报告没有成对执行事件，但隔离 profile 的原生 OMP session JSONL 记录实际 `mcp__eas_term_canvas_open_file` 调用，参数是该轮 PNG，返回 `as=image`、`frameId=target-frame`。不是 `cli` 参数错误：主进程 `agentChat:start` 明确读取 `params.cli`。

OMP 的 ACP `tool_call` title 是模型提供的操作标题，现有 ChatEvent translator 不保留原始工具名。因此仅通过事件字符串中出现 `canvas_open_file` 筛选会误判。验证器现从自己的隔离 OMP session 中读取**精确工具名、PNG 路径和 toolCallId**，再与真实 ChatEvent 的同 ID start/done 成功配对，并验证 renderer 中唯一图片节点属于目标 Frame；不采纳模型文字宣称。

修正后 `actual-omp-0.4.85-rerun/evidence.json` 中新建、恢复、应用重启后恢复三阶段均成功。该轮及 Claude 首轮整体报告仍为 false，原因是运行期间真实 `~/.claude.json` 的散列发生变化，其他所观察文件未变化。旧报告保持原样，不改写成通过。

## 全局文件写保护与并发观察

同一 macOS sandbox 策略下，对真实 `.claude.json` 仅尝试 `open(r+)`，返回 `EPERM`，未写入字节。后续验证器在启动应用前对现存受保护规则文件执行相同探针；任何不能确认写禁止的情况在启动前失败。

后续报告分别保留 `globalWriteProtectionEnforced`、每个文件的前后 hash、`globalRuleFilesUnchanged` 和 `globalConcurrencyDetected`。有 OS 写禁止证据时，散列漂移作为独立观察，不否定已证实的工具/Frame 测试；写入来源仍未知，不声称全局文件未变化，也不将它归责测试包。

## 新工具与复测

验证器默认请求专用 `canvas_open_image`，`--tool canvas_open_file` 只用于原有行为基线。需要包含新工具的正式候选包重新执行三 CLI，旧 open_file 证据不能替代新工具验收。脚本要求显式 `--allow-real-model-calls`，不覆盖 CLI 审批策略、不自动批准任意命令。

`node --test scripts/builtin-cli-evidence.test.mjs` 验证 native 证据匹配精确路径/工具、不导出其它消息或参数，并容忍进行中的末尾 JSONL；脚本本身通过 `node --check`。Windows 正式环境验证不在此 macOS runner 的覆盖内。
