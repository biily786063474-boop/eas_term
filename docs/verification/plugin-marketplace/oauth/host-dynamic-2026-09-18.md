# 动态 OAuth 宿主接线验收

范围：显式 dynamic manifest → 主进程工厂 → discovery 全地址核对 → DCR → 原有 OAuth 回调与 PKCE → 动态凭证 runtime → 共享插件宿主。不改变生产 app、不发版、不广告新兼容能力。

- 红测：清单动态描述被拒；工厂未选择动态 runtime、未阻止发现端点变化。保存日志 `/tmp/eas-dcr-red.log`（临时日志，不作为持久产物）。
- 新增 4 项单测覆盖清单能力/混用/秘密/来源拒绝、工厂选择/复用/退出、发现任意地址改变拒绝（包括同来源换路径）、固定客户端旧流程保持。
- 全量 `npm run check`：3418 项，3400 通过、18 跳过、0 失败；`npm run build` 成功。
- 首次真实应用脚本的连接测试等待失败：误用 Bearer 配置控件的“连接测试通过”文案，实际账号控件成功文案为“已连通 · 1 个工具”。该次失败已在本文记录，不修改生产 UI 迎合错误测试。断言更正并等待按钮解除 busy 后重跑，71042 退出0，动态12项及固定账号兼容11项通过。随后眼验发现真实状态文案矛盾（“已连通”和“尚未测试”同时显示），20719 新UI红测准确失败并保存 dynamic-oauth/failure.json；只在当前检测成功时隐藏“尚未测试”，其他刷新/重登录的未测提示保持。

脚本 `scripts/verify-dynamic-oauth-plugin.mjs` 使用独立 userData/假 home/临时 builtin 插件、真实 Electron safeStorage、原有 IPC、共享宿主及三个真实 shim 子进程；自有 HTTP 服务器验证 DCR 同一 callback、clientId、resource、S256 code verifier。仅 DNS、HTTPS 拨号、PAC、native 确认、浏览器打开为测试适配。不会读取真实供应商凭证，非真实 TLS/供应商账号/实际模型 CLI/Windows 证明。尚需独立上游账号验收；不能由本脚本增加可用供应商数量。

最终复验 76151 退出0：全量3418项/3400通过/18跳过/0失败；构建成功；动态OAuth实际应用13项、固定OAuth/配置兼容11项全部通过。最终截图已眼验，已连通时不再出现“尚未测试”。图片中的探测说明只描述握手检测，不宣称业务范围全部可用。
