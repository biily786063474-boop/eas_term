# 语音输入验证记录 · 2026-09-09

## 实现范围
- 本地 Silero VAD，标准 / 强过滤 / 基础设备降噪；保留 Zipformer 预览及 SenseVoice 定稿，无云端识别、无默认录音落盘。
- 三 CLI 对话、启动输入、终端输入、待办详情：光标插入/选区替换；跨框持续录音按目标分段，不串框；文档冲突保留候选。
- IME 暂缓、片段去重、一次定稿撤销；普通 native 编辑及每次发送使旧语音撤销历史失效。
- 初始化/停止期间发送取消、全局录音所有权、sender/epoch 检查；有界音频和 worker 队列，停止关闭设备轨道。

## 本地证据
- 全量检查：typecheck、hooks、对比度、CSS、动画检查通过。全量测试以 `--test-concurrency=4` 跑完：2820 项，2808 通过 / 12 跳过 / 0 失败，日志 `/tmp/voice-test-bounded.log`。
- 曾有默认并发全套测试超时（CLI package verifyBinary ETIMEDOUT，Codex model probe/cache/launcher 超时）。未改相关业务代码或放宽断言；单独 package 重跑通过，限制测试并发后完整通过。之前默认并发一次也有 2807 通过 / 12 跳过 / 0 失败（当时少一项新增语音测试）。
- `scripts/verify-agent-chat-ui.mjs --voice`：实际 Electron 编辑器，17 个检查组通过。涵盖三 CLI、启动页、终端、Todo、跨框、重复/迟到结果、手动修改冲突、发送取消、五次启停轨道释放、IME、native 撤销、设置位置及持久化。详见 `ui-result.json` 与截图。ASR final 模拟、音频源为静音 MediaStream，不冒充实麦识别。
- `scripts/verify-voice-audio.mjs` 及 `--strong`：各 12 个样本，真实本地 VAD + SenseVoice。6 个非语音样本均为空；3 段真实中文 wav 的定稿与未过滤 SenseVoice 一致；3 段叠加固定噪声样本保留语句。详见 `audio-result.json` / `audio-strong-result.json`。样本来源为现有官方模型配套 test_wavs；不是用户录音。
- 测试中发现静音转噪声会误出 “I.”，将 Silero 最短人声从 0.15s 校准到 0.25s 后，该样本低于主链路 400ms 有效语音门槛，不再定稿。保留此失败背景；样本通过不等于所有噪声零误检。
- 原 sherpa 包同步初始化会 `RuntimeError: unreachable`，现在所有 worker 显式等待官方 WASM factory，未修改 node_modules。

## Windows
测试专用分支 `verify/voice-20260909`，工作流 `.github/workflows/voice-regression.yml`，无发布权限/无安装包分发。
早期运行失败为临时源码补丁 CRLF 锚点、首启引导按钮在小桌面不可点。已修验证器，保留原字节恢复；语音专项仅关闭引导，不安装 CLI。
早期绿色运行 34385068457 的截图仍有首启蒙层：验证器旧文案匹配失效导致 click 空操作，虽 DOM 断言通过，视觉证据不合格。已改为精确 skip selector 并断言蒙层真正消失；最终运行 34385658937（c100172）全部成功：Windows 2022 / Node 22，11项语音contract、17组真实Electron编辑器、标准和强档各12音频样本通过。Artifact 10117785405 已下载至 `windows/`，亲眼检查 Codex 与 Todo 截图，无首启蒙层遮挡。

## 明确边界
- VAD 判断人声，不做本人声纹注册；电视、旁人讲话不能保证排除。
- 没有采集用户现场麦克风；物理 Windows/macOS 麦克风、多人环境、轻声/极短词、真实音乐/电视、用户硬件 CPU/内存曲线及 ground-truth CER 尚未测。不得据此宣传识别率百分比。
- 非16k实际 AudioContext 会明确报错并释放设备，不伪标采样率。终端历史区、网页任意编辑器、系统其他软件不在此轮支持范围。
- 未发版，Computer Use 生命周期问题不属于此次修复。

## 开发验收
`node scripts/open-voice-acceptance.mjs` 使用隔离 profile、真实生产 IPC，无假 ASR。已打开实例信息在 `acceptance/instance.json`，不覆盖正式应用设置、不关闭其他实例。模型来自项目已有本地 resources，必要的首次模型下载由按钮明确触发。
