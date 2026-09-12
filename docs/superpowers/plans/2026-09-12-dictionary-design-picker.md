# 设计选型台词典化 Implementation Plan

单会话执行，复用现有 voice-regression worktree，保留其他未提交改动。不提交发版。

**Goal:** 将已确认 V2 设计稿落入真实辞典，选定本地设计系统后可预览并附加到 AI 对话。
**Architecture:** DictView 第三个同级tab；独立 DesignPicker 组件 + 随包本地JSON；提示词纯函数测试，发送复用既有 composerAddChip，不自行调用模型/PTY执行命令。
**Tech Stack:** React/TypeScript、现有设计变量、原生dialog。
**Spec:** docs/prototypes/dictionary-design-picker-v2.html。

- [x] 解析本地设计库，建立安全、仅所选系统的提示词生成/检索测试。
- [x] 实现选型、hover只预览、参考范围、确认弹窗、实际附加到当前对话；无目标时不假报成功。
- [x] 词典集成第三tab，保持原词条/蓝图交互及共享搜索。
- [x] 类型检查、测试、构建，隔离开发实例实际确认可见/可用。
- [x] 更新架构和进度，说明未验部分，不发布。

验收边界详见 `docs/verification/2026-09-11-acceptance/design-picker-implementation.md`。
