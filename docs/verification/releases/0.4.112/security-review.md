# 0.4.112 依赖审查记录

2026-09-27 干净锁文件安装后的 npm audit：16 项（critical 1 / high 14 / moderate 1）；npm audit --omit=dev 为 0，**不能据此宣布实际安装包无安全风险**。

- critical `tar` 位于 Electron native rebuild / node-gyp / builder 开发构建链。本轮使用隔离工作树、锁文件 npm ci、官方 Node 22.23.3 SHA256 校验与已校验 OMP 缓存；不使用不受信输入、不执行 audit fix --force。
- Electron 37.10.3 虽列为 devDependency，但会分发到用户机器。audit 包含 context isolation、协议、权限等告警，实际可达性未完成专项审定。本版保留存量版本，不把此前 43.1.1 Widget A/B 性能结论当成安全保证。
- 本次源码比较 v0.4.111..af5f16f6 未改变 package.json/package-lock.json，以上不是新增依赖造成，但仍属于待处理安全债。
- 后续需要独立验证受支持 Electron 候选及构建链升级，含沙箱、preload、外部网页/iframe、协议、PTY、双平台打包与内存行为；不可临发版盲目跨大版本替换。

原始 audit、依赖安装日志保留在同目录 `*.local.*` 本机证据，不打包进入应用。
