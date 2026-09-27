# 内存驻留与 Chromium 日志追查 · 2026-09-27

用户原问：上轮内存测试后「继续追查」。固定源码 `53f2334ad478b09c9ee4bd687c1e2c97ded9d995`，工作树 `/private/tmp/eas-first-claude-audit`。Electron 37.10.3 / Chromium 138.0.7204.251 / macOS arm64 / 48GiB。**只增加诊断脚本与证据，不改生产回收策略，不提交/合并/发版。**

## 结论

1. 上轮空画板→末段空Frame不是完全相同布局，不能把 +95.4MiB直接当泄漏量。本轮改为同一空Frame前后对照，每组独立冷启动。空对照本身 +7.3MiB。
2. 混合10轮自然回收后的RSS比同布局基线高 **88.5MiB**。主界面渲染约+37.5、GPU约+27.7、主进程约+22.3、utility约+1.0MiB。角色快照与监控聚合有少量采样时点差，不能精确加总；RSS包含共享页重复，不是PSS。
3. 所有9组结束自然空闲均回到 **4进程、1调试目标**；guest进程没有一直活着。重复混合10轮的诊断GC后DOM为1document/691nodes/271listeners，与空对照一致；主渲染JS堆7.6MiB，低于冷基线9.8MiB。诊断GC后总RSS仍643.0MiB，比基线高82.6MiB，**不能仅归因于未GC的JS对象，也不能证明都是正常缓存或零泄漏**。GC不是生产优化措施。
4. 插件关闭后的第5个进程约50MiB，来源是插件宿主的30秒宽限期：`src/main/pluginHost.ts:98-110` 的 `GRACE_MS=30_000` 与 `registry.onIdle`。本轮确实有“没人用了，回收进程”日志，末段进程退出。这是可解释的短时驻留，未强杀。
5. `Message 2 rejected by interface blink.mojom.Widget` 在混合场景、只有网页+3D场景均复现，默认没有guest CDP连接。纯Electron最小样例**不加载任何Eas-Term业务代码**，40轮本地HTML/WebGL双webview开关，于第8/27轮打开时也复现2次。证明当前引擎/平台路径能独立触发同一错误，**不是必须有插件或Eas-Term业务代码才发生**。尚未定位Chromium内部具体拒绝条件，不据此认定无害。
6. 旧日志的 `WidgetHost Message 7` 本轮未独立复现，不能用Message2的证据代替其根因。最小样例另有82条macOS task_policy_set ERROR（两类各41），无render-process-gone崩溃，40轮加载/卸载完成；**功能通过≠日志无错**。

## 已运行

| 场景 | 轮次 | 同布局基线MiB | 自然回收MiB | 差值MiB | 自然之后诊断GC MiB |
|---|---:|---:|---:|---:|---:|
| 空对照 | 3 | 554.1 | 561.4 | 7.3 | 559.0 |
| 图片 | 3 | 554.6 | 583.4 | 28.8 | 580.9 |
| 网页 | 3 | 553.7 | 585.9 | 32.2 | 581.4 |
| 3D | 3 | 562.4 | 613.2 | 50.8 | 604.8 |
| 插件 | 3 | 562.9 | 584.7 | 21.8 | 581.9 |
| 三个空闲AI面板 | 3 | 558.5 | 608.7 | 50.1 | 600.5 |
| 图片/3D/网页/插件混合 | 3 | 561.5 | 634.4 | 73.0 | 625.4 |
| 仅网页+3D | 10 | 563.1 | 621.3 | 58.1 | 610.0 |
| 混合复测 | 10 | 560.4 | 648.9 | 88.5 | 643.0 |

9组/41次循环用时约20分24秒；纯引擎40轮约25秒。独立冷启动测得的数值不能相加成实际整机开销，也不能把本轮88.5与上轮95.4的差值称为性能优化收益（没有改产品代码）。

混合复测每轮关闭12秒后的RSS：683.8 / 687.3 / 679.3 / 685.1 / 696.2 / 686.5 / 698.4 / 699.7 / 686.8 / 699.6MiB；此时插件宽限期未到，仍为5进程。之后自然空闲到30秒回到4进程/648.9MiB。首末关闭值仍有+15.8MiB差异，样本有限，不能宣布完全不增长。

## 方法与边界

- `verify-memory-components.mjs` 复用隔离verify-app，真实构建产物、实际组件/IPC；通过EAS_VERIFY状态布置场景，并用实际removeNode关闭，不声称每步都是鼠标菜单。
- 图片解码、模型loaded、离线网页正文、插件iframe、AI DOM断言；首轮截图已亲眼查看网页/模型/AI与混合场景。
- 每6秒采样；空画板12秒、同一空Frame基线12秒，每轮打开6秒/关闭12秒，末段自然18秒。之后**额外**一次主渲染诊断GC及6秒采样。
- 无LLM请求、无物理内存填充；CLI安装/登录状态检测仍是应用原生行为，不拷贝任何密钥。没有16GB/真实Claude/并行推理/过夜/Windows/发布包验收结论。
- 3轮plugin组post-GC listeners比空对照多131，且同组基线已多122；重复混合10轮回到271。不能仅凭跨独立实例计数差宣布事件监听泄漏；保留原始样本供后续分析。AI组post-GC仍有2documents/696nodes，未做更长单独AI循环，不能声称所有组DOM逐项完全一致。
- 9个隔离启动器、已记录后代以及最小样例全部退出；`remainingOwnedCount=0`。测试夹具删除。原始日志带本机路径，`*.local*`不纳入公开证据；归档JSON不包含PID/命令行或消息原文。

## 后续入口（未完成，不伪装修复）

1. 将最小样例作为Electron候选版本A/B回归，不先全局升级；确认Widget错误消失且安全/性能/插件/3D行为无回退才考虑升级。
2. 对主界面/GPU/主进程做原生分配跟踪，区分图像与渲染缓存、分配器保留、实际native泄漏；本轮仅定位进程归属，未取得native allocation stack。
3. 单独复现WidgetHost Message7，补渲染生命周期trace。不要隐藏错误、强制GC、关闭GPU或缩短插件宽限期来冒充修复。
4. 有条件再做实体16GB、真实Claude首发与Windows安装包验收。

## 复现命令与文件

```sh
# 使用固定提交已经构建的out/；不要对正式实例运行
node scripts/verify-memory-components.mjs
node scripts/verify-memory-components.mjs --kinds webpair,combined --cycles 10 --tag repeat
node scripts/verify-widget-lifecycle.mjs
node scripts/report-memory-attribution.mjs --once
```

默认输出本目录；不要覆写本轮证据，后续使用新tag/归档目录。组件脚本支持`--guest-cdp`用于诊断工具影响对照，本轮不需要它就已复现。`passed`字段只表达脚本加载/关闭断言通过；必须结合`errors`阅读。

- `assessment.json`：派生汇总；`initial-*.json`/`repeat-*.json`：完整分阶段样本。
- `minimal-widget.json`：纯引擎40轮事件与错误。
- `progress.html`：自包含本地报告，已放所属Frame；样式复用现有项目诊断报告。
- Chromium同版本源码中，此日志在dispatcher拒绝消息时输出：<https://github.com/chromium/chromium/blob/138.0.7204.251/mojo/public/cpp/bindings/lib/interface_endpoint_client.cc>；Widget接口是渲染/浏览器间窗口几何与显示通信：<https://github.com/chromium/chromium/blob/138.0.7204.251/third_party/blink/public/mojom/widget/platform_widget.mojom>。源码只说明日志层级，不提供本次拒绝的具体根因。未采用论坛相似报错作为诊断依据。
