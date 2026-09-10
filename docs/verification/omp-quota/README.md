# OMP 额度验证 2026-09-09

- 定向单测：37 项通过；Gemini 无 duration 模型桶、模型更新、provider 更新、多账号歧义、账号 scope 哈希、无数据占位。
- 类型检查通过；Electron 构建通过。
- 隔离 Electron：`scripts/verify-omp-quota.mjs`，models / unavailable 均通过，截图已人工查看。测试实例关闭且对应临时目录删除，正式实例不受影响。
- 首次 UI 脚本误选 Codex 的首个百分比，断言失败；改为 `.qb-models .qb-pct` 后通过。不是产品数据错误。
- 图内 Gemini 数字为测试快照，不是真实账户额度；真实受管 OMP 18.1.2 查询返回空 reports。
- 查询继续使用受管 `usage --json`，异步、超时、独立限频；不调用模型。
- 全量回归：2830 项，2817 通过，13 跳过，0 失败（Node 现有 MODULE_TYPELESS_PACKAGE_JSON 警告保留，未修改模块制式）。
- 独立代码评审无 critical/important 阻断；按建议补 unavailable 落盘及 ready/unavailable/provider 切换测试，定向测试最终 38 项通过。
- 实际内置 OMP 取消再发送回归单独通过（1 项，非 mock 进程）；CI 增加额度定向回归，并显式检查前一组 PowerShell 测试退出码。
- 分屏模式与大量长模型名的专项交互本轮未验证；真实账户额度仍未返回。
