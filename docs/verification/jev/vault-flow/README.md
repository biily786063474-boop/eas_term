# Jev / 密钥柜流程验收 · 2026-09-24

隔离 worktree `fix/jev-vault-onboarding-20260924`；临时 HOME/userData、OS 沙箱、**假 API Key 与离线服务夹具**，未接触用户真实密钥。

## 已通过

- `npm run check`：3665 通过、19 跳过、0 失败；`npm run build` 通过。
- `EAS_VERIFY_OUTPUT="$PWD/docs/verification/jev/vault-flow" node scripts/verify-jev-plugin.mjs`：实际 Electron 应用 42 项检查通过。锁定状态下保存 Key 原地弹解锁；返回设置时草稿不丢；确认后 Key 在插件专属凭证库加密落盘、不回显，重新打开仅返回已配置状态。
- Jev 点击验证时锁定状态会弹宿主解锁；解锁后需再次点击验证并保留原生付费请求确认。等待验证有可见状态及禁用按钮；截图 `verify-waiting.png`。
- 深色/亮色解锁界面实际查看，亮色无横向溢出；截图 `vault-unlock.png`、`vault-unlock-light.png`。
- `node scripts/verify-vault-trust-restart.mjs`：临时密钥加密、重启后信任设备免输码、手动锁定撤销信任、再次重启仍需六位码，以及手动解锁后重新选择信任，均通过。

## 未验证 / 边界

- 未调用真实 TypeSafe 账号或可能收费的线上验证；服务夹具通过不代表线上 API Key 有效。
- Windows 未实机验收。Linux `basic_text` 已在代码中禁止信任设备，但未实机验收。
- 插件密钥存于受密钥柜租约保护的**插件专属加密凭证库**，不在通用密钥分组中；没有把密钥明文复制到第二处。用户可在插件设置中查看“已保存”状态、断开清除。
- 当前为开发分支，未合并、推送、发布或替换安装版。
