# 聊天图片引用与调整方向 · 2026-09-28

状态：代码已实现，**真实UI最终验收未完成，不宣称全部修复**。未提交/合并/发布，正式实例未替换。

## 代码与根因
- 主线基线 b1bdfa71，独立分支 fix/chat-media-steer-20260928。
- 原调整方向在请求杀进程后先发 turn.done，前端抢发时 dispatchKey 尚占用而收到「当前消息正在等待或执行」，队列暂停。现等 owned close 后、租约先释放再通知。停止失败/10秒未确认保留消息和租约，只提供显式重试。
- 原图 SHA256 落盘，三CLI统一在事件进入preload缓冲前替为本地引用。单图2MiB/单事件4图安全限制保留；历史8MiB兜底不再裁剪引用。
- 旧历史离线迁移；失败旧inline在下一次引用回存时仍保护，不覆盖唯一原图。权限/空间失败说明原因。
- 可见缩略图、离屏清除像素、固定布局、两路解码、main只验证格式尺寸不解码；仅展开预览时读取原图。文件恢复只接受同一原哈希的本地文件，不触发模型。

## 已验证
- 迁移去重/失败回存、路径与symlink、SHA恢复校验、像素预算、离屏迟到请求、Codex/Claude慢退出/连续调整/停止失败/超时测试通过。
- 独立只读审查发现并修复两项阻断：迁移失败覆盖唯一原图、main先解码后限像素。复审无Critical/Important。
- 最终全量数量见 checks.json；构建及类型检查日志在本次工作机 /tmp/eas-media-{check,build}-complete.log。

## UI失败原样保留
1. 旧验证脚本外层 sandbox-exec 与 Chromium sandbox 嵌套失败：`sandbox initialization failed: Operation not permitted`，未进页面。
2. 临时HOME缺钥匙串：macOS「找不到用于储存 Eas-Term Key 的钥匙串」，阻塞 Runtime.evaluate。未点击还原为默认、未更改安全设置。只关闭属于测试的实例。
3. 曾进入真实图片页，预览显示「图片无法解码」；发现 fetch(dataURL)受现有CSP约束，改为atob→Blob→createImageBitmap，不放宽CSP。**改后最终页面仍待复验**。
4. 最近图片脚本 `CDP timeout Runtime.evaluate`，表达式 `!!document.querySelector('.onb-ghost')`；调整方向脚本同类启动阻塞。

## 下次先做
1. 重开隔离实例，请用户取消（不要重置）系统钥匙串提示，完成脚本并亲眼看截图。
2. 图片脚本需复核最大化路径（store字段实际参数）、重载后pane定位与图片计数；这些断言目前尚未执行成功。
3. 调整方向脚本假CLI须确认确实执行、停止800ms及真实点击时序后完成验收；当前仅静态脚本，不能算已通过。
4. 原生文件选择框恢复动作未实测；16GB设备长时与真实三CLI在线模型未测。不得用单测代替。

## 用户授权整合（2026-09-28）
用户在已知最终UI待验收的说明后明确要求「提交并安全合并」。本轮按此授权提交、推送并整合最新origin/main；不发版，不将UI验收标记通过。合并结果另见integration.json。
