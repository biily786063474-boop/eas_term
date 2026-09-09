# Agent 协作活动日志

## 2026-09-07：AI 对话模块源码调查与计划

- 基线：main / 62f993f；原有 AGENTS.md 修改与未跟踪 .agents/、.codex/ 未触碰。
- 任务：Codex 多轮续聊、动态模型、回复样式、链接与插件读取展示、公共协议。
- 确认：本机 codex-cli 0.147.0 不接受当前 adapter 拼出的 exec resume … --sandbox 参数，帮助模式复现 exit 2；未调用真实模型、未完成应用端复现。
- 模型下拉、动态探测、缓存以及 Markdown/链接/插件面板已有实现；计划以修正现有链路为主。
- 验证：模型、状态机、adapter、工具栏相关 180 项测试全过；未执行全量检查或应用眼验。
- 交付：docs/superpowers/plans/2026-09-07-agent-chat-codex.md。
- 状态：仅新增计划和本日志，业务代码未改，未提交、未发版。实现按计划 P0 开始；留意 roles-workflow-p3 独立工作树的并行改动。

## 2026-09-07：Codex 对话实现与兼容验证

- 独立工作树 `/private/tmp/eas-agent-chat-codex`，分支 `codex/agent-chat-codex`。修正 resume 沙箱参数位置；强化动态模型握手/分页/超时/缓存与刷新；按模型显示推理档位；公共工具资源和插件状态、阅读排版。
- 新字段都走公共能力/事件；Codex、Claude、omp 前端事件回放通过。HTTP 链接回同 Frame，ui 资源仅映射当前插件声明面板。
- 全量测试 2452 通过、1 跳过；类型和构建通过。真实 CLI + 假服务三轮上下文验证通过；真实 model/list 读取成功。
- npm run check 仍受原有 canvas.css cframe-sweep 动画规则阻止。真实外部插件、Claude/omp 后端对话及完整停止/切模型时序未验证；详见 docs/verification/agent-chat/README.md。
- 没有发版、安装、合并或推送，保留独立分支供审查。

## 2026-09-07：模型选择前移至首条消息之前

按用户反馈，选择 CLI 即读取目录，启动页显示模型、强度及首条消息使用模型；首轮和 resume 失效重试均传递用户选择。复用公共探测，不创建对话，不按 CLI 名称分支。真实目录 + 假 start 的隔离 UI 验证通过；全量 2454 通过/1 跳过。开发窗口已更新，留给用户查看。

## 2026-09-09：浏览器收藏整轮开发验收
在`.worktrees/browser-favorites`/`feat/browser-favorites`完成正式收藏数据与受限IPC、本地授权缩略图、五默认目录和自定义贴纸、横排大卡+边缘提示、HTML表单/内部路由与browser_routes MCP。保留persist:browser，隔离profile跨进程Cookie/收藏回归通过。四最大化宿主保留隐藏几何，共享收回期间恒定内容布局；20轮模块身份回归与trace证据在docs/verification/browser-wave。蓝图hover同位置复验。无OGL、无外部截图服务、无真实账号导入、未发版；两条未确认网址仍pending，Windows仍待后续实机门槛。

## 2026-09-09 Eas-Term 0.4.88 发布
浏览器收藏、本地授权预览、横排大卡、Agent HTML路由及词典hover/缩回优化正式发布。Mac两架构签名公证及打包UI通过，Windows CI34325720098含新增35+19项通过；五包逐个SHA256校验后切换官网/latest，八站状态一致，无重启，0.4.87回退保留。原始Windows闪退与外部Computer Use指针不冒充已修复。详见docs/verification/releases/0.4.88.md。

### 2026-09-09 语音输入完整实现与回归
本地VAD、四类编辑入口按光标插入、跨框片段路由、IME/撤销与发送取消；多轮只读review闭环。17组Electron UI与两档各12真实ASR样本通过，全套2820测试2808pass12skip；Windows专用CI及开发验收实例见docs/verification/voice/README.md。未发版，实麦现场边界保留。
