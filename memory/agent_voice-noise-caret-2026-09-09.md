# 语音降噪与光标输入：执行中，不能发版
用户批准 docs/superpowers/plans/2026-09-09-voice-noise-caret.md。
已改：共享选区插入接入4处；按钮不夺焦点、IME候选暂缓、跨框先安全停；独立WASM VAD Worker、前后音频gate、有界队列、模型下载SHA校验；stt所有权/epoch/stop pending final处理和error事件。无业务提交。
关键：本机 sherpa WASM createVad 同步调用会unreachable；await factory才能建成功。模型官方629KB在resources/models/sherpa-onnx-silero-vad/（忽略目录）；来源/hash见架构01。
UI脚本 scripts/verify-agent-chat-ui.mjs --voice 用假ASR事件及静音MediaStream，临时preload补丁自动还原，不是实麦验收；三CLI对话态截图已出。首次UI等待caret失败，复跑通过，需稳定性复核。
真实VAD数学信号测试 scripts/verify-voice-vad.mjs：静音0/50，白噪声5/50（强4/50）被判断人声，不能宣称降噪效果验证通过。
未完：跨框持续路由、强档配置/基础模式、实际噪声及人声回归、其余输入区域眼验、Windows；代码review所有权边界/异步stop/生命周期尤其重要。
最新完整检查运行 /tmp/voice-check-final.log（exec session54422），之后build /tmp/voice-build-final.log。上一轮2803passed12skipped；之后又改过代码，不冒充最终结果。
其他用户已有dirty改动和上一轮token-dashboard改动都保留，禁止全量commit。UI临时补丁现在已经还原。正式Eas-Term和旧浏览器验收实例未关闭。
异步问用户噪声主要是键盘风扇还是电视旁人，尚未回复。
最终本轮check：2803通过、12跳过、0失败；build通过（/tmp/voice-build-final.log）。不等于规划全部验收完成，缺项仍按上面执行。

## 2026-09-09 后续完整执行更新（以上早期缺项已被本节替代）
- 已完成跨框连续录音路由、目标revision冲突候选、segment去重、IME/撤销、标准/强/基础模式。startup/terminal/Todo与三CLI真实Electron编辑器回归通过，共17组；设备轨道五轮启停释放。模拟final与静音MediaStream，不是用户麦克风现场。
- 真实WASM VAD+SenseVoice两档各12样本通过，噪声6种空结果，3clean文本一致，3混噪语句保留。minSpeechDuration=.25解决静音转噪声误出I；不等于所有环境零误识别或本人声纹。
- reviewer多轮发现的初始化取消、stopper抢占、main stop epoch、batch覆盖、native撤销串草稿全部闭环；最终复审无具体阻断。
- 默认满并发全check出现无关CLI探针超时；未改其业务或断言。限定test-concurrency=4全套2820项：2808pass/12skip/0fail；typecheck和全部静态检查通过。构建完成 /tmp/voice-build-final3.log。
- 独立验证分支verify/voice-20260909已推远端，仅Windows测试不发版。20e852b运行34384810042全部成功；最终代码5583faf运行34385068457仍在跟踪，最终以README补录为准。
- 真IPC开发实例已开，信息docs/verification/voice/acceptance/instance.json；用户正式应用和旧浏览器实例未关闭。验收窗不用假ASR，也不发送模型对话。
- 工程细节/已知实麦范围见docs/verification/voice/README.md。未发版，不许把尚未做的现场麦克风、CER、电视旁人、硬件资源曲线说成已通过。

最终Windows运行34385658937（c100172）全部通过；下载artifact10117785405并查看Codex/Todo截图，蒙层已消失。之前5583faf虽CI绿但首启蒙层遮挡，不能作为视觉完成证据；已修验证器并重新跑完全程。最终证据见docs/verification/voice/windows/。
