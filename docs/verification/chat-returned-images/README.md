# AI 返回图片验收 · 2026-09-17

已实现：Claude/Codex/OMP 工具结果中的内联栅格图片共用校验与渲染；Claude/OMP 回答图片块；缩略图、原图 dialog、Esc 关闭；历史 JSON 持久化和恢复重验。不会为图片块读取模型传入路径或请求远端 URL。

边界：单图 2 MiB、单组 4 张，活动视图/单份历史各 8 MiB 图片字符串预算；不支持 SVG。CLI 没传像素无法恢复，仅收到缺失/无效 image 块时明确提示。未做在线模型端到端验证。

证据：
- returnedImages.test.mjs：三 adapter → reducer → 历史集成测试及无效/超限用例。
- verify-chat-returned-images.mjs：真实隔离 Electron 读取由三家合成协议事件产生的历史，三家均能解码截图、实际点击放大、Esc 关闭不退出节点最大化，重载后仍可见。7 项通过，见 result.json。
- 图片与预览 PNG 是真实应用截图，不是生成图。

过程问题（保留，不隐藏）：
- 首轮 typecheck 发现主进程 TS 测试跨引 renderer 违反 tsconfig include，集成测试改为本仓库已有的 .test.mjs 模式；新增事件要求补齐隔离基线覆盖，新增专用 synth-returned-images 用例。
- 预览 Esc 首轮失败：画布 window 捕获阶段先处理 Escape。接入既有 fullscreenOverlay 所有权机制后修复；预览自己处理 Esc，卸载仅归还自身持有的覆盖层标记。
- 第二 CLI 截图可见但点击测试超时：多节点 DOM 同时存在且图片部分滚出视口，测试改为按所属 leaf 精确选图、滚入视口后再用 CDP 实际点击。
- 全量 check 曾 2843 通过/13 跳过；复跑时出现 3 个 CLI launcher 时序测试失败（native CLI not ready、exec cancel/disconnect 等待启动 5 秒超时），没有修改这些测试或放宽时限。codexCapabilityLauncher 单独重跑 6 项通过。最终复跑状态另见最终汇报。

未发版、未替换安装版；旧历史里已经丢掉的图片像素无法由本次代码补回。

最终复跑：`npm run check` 退出 0，2856 项中 2843 通过、13 跳过、0 失败；`npm run build` 退出 0；最后一轮 UI 脚本 7 项通过。之前的 launcher 超时未复现，不能据此声称已修复其时序问题。
