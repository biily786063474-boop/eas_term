# 看板右键归区
用户说拖动仍不行，改要右键快速移动至状态看板区；已确认是按项目状态划分的列。
工作区 /private/tmp/eas-board-quick-move-20260923；分支 feat/board-quick-move-20260923；基线 c32300fc；未提交/合并/发布。
实现 BoardStage右键+board/moveMenu纯构造函数；canvas/stageMenu复用，当前分区禁用防误点清空。
通过原setProjectStatus持久化与看板自然排布，不动文件/会话/画布位置；没有继续修改失败的边缘自动平移。
证据 docs/verification/board-quick-move。独立测试脚本 verify-board-quick-move.mjs。
其他待提交工作区：/tmp/eas-timeline-stages-20260923；/tmp/eas-frame-edge-pan-20260923（用户表示体验仍不行，不可当已验收）。
