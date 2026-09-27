# 发版前审查 2026-09-27
用户只要求审查，未发版未修生产代码。审查树/private/tmp/eas-prerelease-audit-20260927，分支audit/prerelease-20260927，HEAD及origin/main2e17c7f7，上版v0.4.113真实构建9cb85bb3。
结论：先修高清捕帧P2，不建议直接发布。精确截取livePage.ts现行编码段在Electron NativeImage确定性高熵fixture中执行：逻辑3000x2000 DPR2实际编码6000x4000，19.78MB JPEG>8MB；4096sq13.82MB也超限。现行代码不更新不提示，保留旧帧。生产同步PNG/JPEG阻塞风险；probe encodeMs含额外尺寸解码，不全算生产耗时。不是普通网页性能基准/不是完整页面冻结端到端。证据docs/verification/prerelease-20260927/frame-budget.json及probe-frame-budget.mjs，独立premerge_chat_review已确认P2。
全量check3867通过19跳过0失败；build、renderer入口、helper通过；47项真实live-page UI通过并眼验。OMP初始缺二进制门禁失败，fetch走Clash代理缓慢，停止自己的node PID67483（exit143）；复用0.4.113本机缓存逐文件SHA匹配当前manifest，再官方fetch缓存命中+实际ACP门禁通过。未改代理、未动生产。
依赖全量npm audit16（1critical/14high/1moderate）与上版计数一致；prod-only0不能排除实际分发的devDependency Electron风险。未升级依赖。
仍未验：在线三CLI、Windows同SHA候选包、跨屏DPI、高清长稳；完整闲置重建未实现（仅GC）；Computer Use指针仍开放。
报告独立HTML已发布到当前Frame：主工作区docs/verification/prerelease-20260927/report.html；越界工具拒绝审查树路径后仅新增该报告/两个证据副本到主工作区，未动其余修改。完整原始日志留审查树。没有commit/push/version bump/package/deploy。
下一步：用户授权后修真实像素预算、有界编码降级/超限反馈、主线程长同步编码；新回归+独立审查后合main再正式发版。

## 用户授权修复后
2026-09-27：当前分支fix/live-preview-frame-budget-20260927，仍基线2e17c7f7。实现Chromium异步有界截图、真实4096/9MP/8MB预算、三档降级及可见反馈、4秒超时、自有调试器清理和失效帧丢弃。独立复审通过。全量3878pass18skip0fail、build通过；DPR2真实高熵及滚动取景/恢复通过，50项实际UI通过。详情docs/verification/live-page-capture-fix/README.md。尚未commit/merge/push/release，用户本轮只授权修复。后续若要求提交合并需重新fetch核对最新main并只整合本次改动；不要夹带主工作区其他agent文件。

## 安全整合更新
用户授权按建议推进。修复36453b3a已推独立分支；合并fa063424，合并后全量3878pass18skip0fail、build、50项UI、OMP真实ACP及helper/renderer资源检查通过。首轮main缺node_modules报tsc不存在，链接既有依赖后正常；OMP缓存逐文件复制再官方manifest hash校验，非跳过。依赖审计仍16项，Electron37.10.3实际分发，普通webview允许受控OAuth弹窗，不能用livePage的deny保护排除全局风险。评估见integration.md/dependency-assessment.json。未发版；后续优先独立依赖升级回归，再全平台签名候选，不能称候选包已验。
