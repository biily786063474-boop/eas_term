# 语音降噪与光标输入方案（待批准，未改业务代码）

## 目标与范围
本轮改善非人声噪声误识别，并在 Eas-Term 支持的编辑区域按实际插入点输入。光标指文本插入点，不是鼠标悬停位置。三 CLI 共用前端语音层，不分别实现。
默认离线，不新增云识别或 LLM 文本润色，不保存原始音频。跨其他桌面软件、嵌入第三方网站输入、只接受本人声纹不纳入首期；这些需要单独的权限与适配设计，不暗中申请辅助功能权限。

## 已核实现状
- voiceCapture.ts 已请求 echoCancellation/noiseSuppression；不能把“开启降噪”当新修复。需要读取实际 track settings，确认设备支持及生效情况。
- stt.ts 使用自适应 RMS 底噪阈值，loud 当作语音证据；所有音频仍进入流式识别器。声音响不等于有人说话，存在噪声进入识别的路径；尚未用用户现场录音复现误识别。
- 当前 Zipformer 流式预览、SenseVoice worker 定稿，保留此组合和离线特性。
- TerminalInput.tsx 已有 selectionStart/End 插入，但失焦退回末尾；麦克风按钮可能夺走焦点。AgentChatView.tsx 启动页明确直接追加到末尾。ChatToolbar、TodoBoard 等独立回调需要统一审计，不能只改一个框。

## 方案评审与选择
A 仅提高音量阈值：便宜但容易漏轻声，不采用为主方案。
B 现有设备降噪 + 本地语音活动检测 VAD + 安全光标路由：推荐。VAD 判断有人声，不判断是谁。
C 目标说话人识别/分离：需本人声音注册、阈值校准、隐私删除能力；多人同时讲话仍有误判，另立二期，不能承诺“只听本人”。

## P1 输入位置正确性（先做独立测试）
新增 voiceTarget.ts 与纯函数测试，支持受控 textarea/input 适配器，不通过直接改 DOM 绕过 React 状态。记录 focus/select/selectionchange 的 targetId、选区、文档版本。点麦克风前保存目标与选区，不让按钮失焦导致末尾追加。
- 每个语音片段起始绑定目标；目标内移动光标，定稿按最新有效选区插入；插入后光标移至新文字末尾。
- 选中文字时替换选区，保持前后文字；尊重中文标点，不无条件左右加空格；一次定稿可一次撤销。
- 录音中切换输入框：结束/隔离旧片段，新片段绑定新目标；旧异步结果绝不写到新框。目标卸载/只读/密码框：不注入，提示重新选择；没有目标不默认写 PTY。
- 输入法 composition 期间暂缓提交；用户同时编辑造成版本冲突，保留候选让用户确认，不能覆盖新编辑。
- partial 仅预览，final 唯一插入；sessionId/segmentId/generation 去重，停止、发送、切框后迟到结果可丢弃。发送不自动执行终端命令，不加回车。
修改 VoiceButton.tsx、voiceControl.ts、TerminalInput.tsx、ChatToolbar.tsx、AgentChatView.tsx、CanvasTodoBoard.tsx，按实际编辑器API适配其他自有富文本区域。终端PTY不是普通文本框，单独保留显式终端输入入口，不承诺任意历史位置编辑。

## P2 声音过滤
先验证本项目 sherpa-onnx 安装版本 Node 绑定是否提供 Silero VAD；官方支持不等于当前绑定可直接调用。新增 voiceGate 纯状态机与 stt worker VAD 适配，模型按现有下载/校验/进度链路接入，不静默新增出站源。
链路：麦克风实际降噪设置 → VAD → 有效语音片段 → 原有流式/定稿识别。
- RMS 保留作辅助，不再单独等同语音。预留约 200–300ms 前置缓存、尾部缓冲/迟滞，避免首字被吞，具体参数录音基准校准。
- 无有效人声的片段不定稿；流式只接收经分段管理的有效音频及必要尾静音，避免门控后原 endpoint 永远不触发。
- 限制单段缓存与时长，长句分段；实际采样率检查并正确重采样，不能把非16k音频标为16k。
- 可选标准/强过滤档，不默认堆叠多套神经降噪。VAD 未就绪明确显示基础降噪模式，不假装增强已启用。
- 全局录音所有权，主进程校验 sender/session；终止/异常/切页清理流、AudioContext、worker 状态，不全局误停其他会话。

## P3 回归与验收
先红后绿：光标首中尾、选区替换、点击麦克风失焦、多句顺序、跨框、停止迟到结果、IME、撤销、重复final、卸载、安全字段；VAD噪声/短句/长句/缓冲边界/失败回退测试。
固定本地授权样本：静音、风扇、键盘、音乐、电视人声、近讲中文短句、轻声、中英术语；分别记录旧版/新版每分钟误落字、漏字率、中文CER、首字完整率、定稿延迟、CPU/内存。非人声组以误落字明显下降且干净语音不退化为放行依据，实测前不承诺百分比；电视人声单列，VAD不能保证排除。
构建并打开隔离开发实例，逐个自有输入区域亲眼验证；Mac 与 Windows 实测分别记录，不以Mac代替Windows。停止后确认麦克风指示关闭且音频缓存释放。用户现场噪声需经同意本地采样，不上传、不默认落盘。
更新架构03/10相应条目与验证记录。仅方案，不发版；任何未测平台/区域标为未验证。

## 参考（2026-09-09 查阅）
- https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/noiseSuppression
- https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings
- https://k2-fsa.github.io/sherpa/onnx/vad/silero-vad.html

## 执行记录（2026-09-09）
P1/P2代码及自动化回归已落地。P3已覆盖实际Electron支持输入区、真实本地wav/数学噪声两档及Windows CI；完整证据、失败历史和平台最终状态见 `docs/verification/voice/README.md`。
实麦现场/目标说话人/ground-truth CER与硬件资源测量无现场样本，不伪造结果；属于明确未验证边界，不将其宣传为本轮达成。非16k设备选择失败关闭而非冒险伪标或未验证重采样。此次不发版。
