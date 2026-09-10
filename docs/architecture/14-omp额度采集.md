# OMP 额度采集补充（2026-09-09）

- 入口：`src/main/agentChat/omp/launch.ts` 的 `readOmpUsage`；受管 OMP 18.1.2 `usage --json`，8 秒超时，不走推理请求。
- 调度：`src/main/quotaStore.ts` 独立 in-flight/限频；查询结束校验 provider 未切换；失败只更新额度状态，不参与 session 握手或对话生命周期。
- 映射：`src/shared/ompQuota.ts`。传统账号周期仍使用 primary/secondary，排除 Anthropic 模型 tier 子额度。Gemini 独立使用 models，保留 modelId，不伪造窗口时长；百分比统一是已用。
- 多账号：同 provider 返回多份 report 且无法确定活动账号，返回无数据，不取第一份；账户元数据和 scope 身份只保存短哈希。
- UI：`features/quota/segments.ts`、`QuotaBar.tsx`。模型额度独立标注，hover 显示剩余和重置时间；模型较多时限宽横滚。仅 OMP 新增明确无数据状态，不伪造 0%。Claude/Codex 取数路径保持不变。
- 快照：`CliQuota.models`、`QuotaSnapshot.ompStatus`；模型/标签变化参与广播比较。查不到时内存保留旧数字但不展示为当前额度。

## 核查来源（钉死版本，不依赖最新版）

- https://github.com/can1357/oh-my-pi/blob/v18.1.2/packages/ai/src/usage.ts
- https://github.com/can1357/oh-my-pi/blob/v18.1.2/packages/ai/src/usage/gemini.ts
- https://github.com/can1357/oh-my-pi/blob/v18.1.2/packages/coding-agent/src/cli/usage-cli.ts

Gemini 上游查询 loadCodeAssist/retrieveUserQuota，返回按 modelId 的 remainingFraction/resetTime；window 没有 durationMs。沿用上游 CLI 出站，不新增应用直连端点。不是 OMP 统一钱包余额，也不是会话费用。

## 验证入口

`node --test src/shared/ompQuota.test.ts src/renderer/src/features/quota/segments.test.ts`

`npm run build && node scripts/verify-omp-quota.mjs`

当前受管环境真实调用返回 reports/accountsWithoutUsage 均为空，不能声称真实账号额度数值已验证。UI 模型数字使用合成快照，无付费推理。多账号自动选当前账号暂不支持，明确降级为暂无额度。
