# 用量热力图 / Eas-Term行为统计
用户明确选择Token/软件活跃可切换，默认Token。基线origin/main92570390；独立工作树/private/tmp/eas-usage-activity-20260928，分支feat/usage-activity-20260928。原根工作树脏改动未碰。
已实现本地90天日计数、热力图/行为统计/常用功能及插件打开+AI工具调用；图纸03/10同步。禁止旧聊天扫描、假历史、外发个人行为。
首轮全量3失败来自插件AST测试新依赖缺失，补真实ActivityBook依赖与计数断言后全量3931pass19skip0fail。独立审查后台刷新误计/损坏账本未知覆盖问题已补红绿测试并修正，最终UI与全量仍复验中。未提交/合并/发版，未替换正式应用。

## 最终验证
最终check3932pass19skip0fail、build通过；实际Electron seeded/empty/corrupt/restored四场景成功，原项目展开回归通过，截图已亲眼检查。独立审查无剩余阻断。证据docs/verification/usage-activity/README.md和verification.json。未提交合并发版；源码在独立工作树，根只放两张预览截图，当前Frame打开usage-heatmap-fixture.png。

## 用户授权安全整合（2026-09-28）
功能提交fce042be已推送feat/usage-activity-20260928；整合最新origin/main61592e32，图纸两处追加冲突保留双方。合并树check3943通过/19跳过/0失败、构建通过、实际Electron四场景重新通过并亲眼检查截图。原有用量明细回归复验通过；main最终推送以会话回执为准。未发版或替换正式app，根工作树及其他未提交内容未碰。
