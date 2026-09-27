# 2026-09-27 Windows 发布验收 profile 清理竞态

父会话派活：真实CI36309927150/36311598447均内置能力6断言通过，finally删除Network/Trust Tokens EBUSY。新专属树 /tmp/eas-term-verification-cleanup-20260927，fix/verification-cleanup-20260927，基线main6b5ccb0a；不改旧修复树，不提交推送。
根因：exit不代表stdio/后代句柄已释出；KILL后没等close；目录删无重试。实际finally回归先RED（exit后close前删除），新验证专用helper立即观察close、有限TERM/KILL等待、仅临时锁重试，失败非零保留残余profile位置和cause。产品与原sandbox策略不变；本地GUI只跑更严格保留Chromium sandbox的临时脚本copy，执行后删除copy。7定向通过，最终验证证据见docs/verification/verification-cleanup-20260927/。
最终定向9/9（包括审查三重失败RED→GREEN）；首次完整check3841pass19skip0fail、build通过，复审后check-final重跑。严格双sandbox GUI失败：sandbox初始化Operation not permitted、GPU/Network崩溃→Runtime.evaluate timeout；原样保留，不绕sandbox。此次真实GUI失败收尾cleaned:true，临时执行copy已删除，无残留进程；Windows最终等待CI，不声称已真机通过。
check-final最终exit0，3841pass/19skip/0fail。独立review最终无阻断；父会话独立8项通过，此后仅追加第9项socket+两份诊断失败仍必须cleanup的测试（通过），无新业务/helper变更。没有提交推送；交父会话合main并升113。
