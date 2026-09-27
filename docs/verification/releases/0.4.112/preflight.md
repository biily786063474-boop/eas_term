# 0.4.112 发布前核验

- 基线最新 main：61e59617d69245525cc62a5831d3211b1699e1dd，含独立复审通过的协议终态与资源重新准入修复。
- 发布树全量 check：3860 总测试，3842 通过、18 跳过、0 失败；build 通过。比修复树多通过 1 条 OMP 取消登录测试，原因是本发布树已校验本机 OMP 二进制。
- 隔离 userData 的真实应用已打开，显示 0.4.112，运行与资源页 AI 并发设置可见；截图 gui-runtime.png。实例退出后清理自己的临时数据，没有替换或退出 /Applications/Eas-Term.app。
- macOS arm64，隔离官方 Node 22.23.3，SHA256 23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53。Node26 初次 npm ci 在 yargs ESM 后安装阶段失败；更换构建环境后 npm ci 成功，未改依赖版本。原始失败日志本机保留。
- OMP 18.1.2 双架构缓存经 fetch-omp.mjs 逐一按 manifest 校验。
- Developer ID Application: Zang Yawen (D4FVS6QJXV) 可用；eas-notary 档案不存在，aurora-notary 同 team 回退档案只读 history 成功。
- 安全告警见 security-review.md。此记录尚不代表正式包验收或已发布。

- 首次后台 CDP 截图未呈现设置浮层（文本断言通过但画面旧帧），未用它作为最终视觉证据；显式 Page.bringToFront 后重跑并亲眼核对当前 gui-runtime.png，显示 0.4.112 与并发设置。无产品代码修改。
