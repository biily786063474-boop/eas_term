# 更新包下载接窗口归属任务准入 · 隔离验收（2026-09-13 23:45 PDT）

假更新源：本机 `http://127.0.0.1:9471/latest.json` 报 99.0.0，安装包端点约 4MB/s 慢吐 120MB（`/tmp/eas-update-server.mjs`）。
隔离实例以 `EAS_UPDATE_URL` 指向它（这个变量就是为真机验证留的，正式包不设）。

| 步骤 | 观察 |
|---|---|
| 实例 1，节能 50%：`update.check()` → `update.download()` | check 得 99.0.0 与 arm64 链接；tasks：`update-download:1`「更新包下载」queued、memory-threshold，窗口归属 |
| `runtimeCancelTask` | ok；调用方 `{ok:false,error:'更新包下载已取消'}`；`~/Downloads` 无任何 Eas-Term-99* 文件 |
| 实例 2，普通 80%：下载进行 4 秒 | 任务 running/ready；`update:progress` 收到 225 次，最后 15MB；`~/Downloads/Eas-Term-99.0.0-arm64.dmg.part` 15,990,784 字节 |
| 运行中心取消（下载中） | ok；调用方"更新包下载已取消"；`.part` 被删，Downloads 无残留；任务清空 |

未验：完整下完后的 `shell.openPath` 路径（会真的挂载/打开一个假 dmg，本轮刻意不跑完）；Windows 未实测。
