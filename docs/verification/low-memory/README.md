# 低内存适配验收（2026-09-26；含续批1/2/5）

源码分支：`fix/low-memory-adaptive-20260926`；基线 `f34bd0b8`。没有合并/发版/安装到用户正式应用。

## 已验证
- 8/16/32GB 模拟 normal/warning/critical 准入矩阵；warning 不再变成 critical，后台预算不变。
- typed RESOURCE_WAIT_TIMEOUT；deadline 先过期后放行；spawn/network timeout 不冒充资源排队。
- 未投递的取消仅一次恢复事件；进入 dispatch 后不再提供“确认未发送”的承诺。
- 恢复按钮只回填，保留既有草稿；真实鼠标点击、暗/亮 UI 截图、真实 history IPC、Frame 卸载重挂验证通过。
- 首问先保存再进入 start IPC，真实 handleSend 在没有任何 assistant 输出时已存下原文；保存失败不会 dispatch。
- 审查两个 Important（新对话残留草稿、排队关闭丢首问）已增加 RED→GREEN 回归并修正。
- 按需聚合 IPC 限频、只输出数字，常规监控不调用新采集器。

## 测量边界
`idle-1790457003921.json` 是本机 **48 GiB**、隔离全新 userData、3 分钟/37 样本。仅 Electron 自有主/渲染/GPU/utility 进程；采样峰值 540.9 MiB，开始 529.0 MiB、结束 525.6 MiB。不是发布前后降幅，也不含外部 CLI/插件。不要把各进程历史峰值和当作同时峰值。

`recovery-result.json` 是事件回放，不是真实 Claude API 会话；测试调用 start 由脚本临时替换，不花模型额度，脚本已还原源码并重建。无生产凭证复制，无全局杀进程。

## 未完成 / 不可声称
- 实体 16GB 同场景基线（当前仅48GB）、真实首次 Claude 发送时延及并行LLM负载；本机多Frame/图片/3D与子进程统计已在下方续批补测。
- Task 5 热点优化与20%目标：必须取得前述基线再选，尚未修改。
- Windows CI、正式打包新用户验收、合并主线及发版未执行。
- 前批遗留的 synthetic turn.done 误报已在本次续批修复并验收，见下方；中断尝试仍保留为尝试记录，不冒充成功或真实零用量。
- 全量测试带已有 MODULE_TYPELESS_PACKAGE_JSON 警告与19项条件跳过；不把跳过算通过。

复验：`npm run check`；`node scripts/verify-agent-chat-ui.mjs --low-memory`。
测量：先起 `node scripts/verify-app.mjs --port 9446`，再 `node scripts/verify-low-memory.mjs --port 9446 --phase idle --seconds 180`。产物为脱敏聚合 JSON，可直接删除。

前批验证：`npm run check` exit 0，3802项中3783通过、19跳过、0失败；隔离 UI 专项 exit 0；脚本还原后 `npm run build` exit 0。先前一次全量仅因既有首发seq源码格式断言失败，已保持seq语义并修正格式后重跑全量通过。


## 续批 1 / 2 / 5 · 当前结果

### 1：子进程统计已实现并验证
`processTree` 返回主进程+活跃后代的数量与RSS，包含从本应用启动的CLI/插件后代，不输出PID/名字/命令。5秒缓存、单在途、固定命令无shell、2秒与4MiB上限；默认监控不触发。Electron子集另列，不重复相加。真实64MiB触页子进程测试数量1→2→1，证据 `process-tree-real.json`。这不是CLI实际推理内存证明。

边界：重挂父进程/应用外原有服务不计；共享物理页可能重计。PID血缘仅作诊断，不作关闭/授权依据。Windows代码按 [Win32_Process数字属性](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)读取并按字节计；Windows/Linux现场未验收。没有声称私有内存或绝对全软件占用。

### 2：真实本机渲染基线已采集，Claude首发仍待登录
48GiB开发机，隔离新userData，无用户历史/凭证复制。每5秒按需采样，属于开发机正常后台负载，不是受控压测，也没有旧/新版降幅意义。

| 场景 | 样本数 | 采样峰值RSS MiB | 最后RSS MiB |
|---|---:|---:|---:|
| 应用就绪首样（非完整启动峰值） | 1 | 538.8 | 538.8 |
| 空闲约3分钟 | 37 | 539.3 | 527.3 |
| 3个空闲AI面板，30秒 | 7 | 584.3 | 584.1 |
| 真实图片+2万三角面GLB，30秒 | 7 | 763.5 | 757.1 |
| 关闭媒体后约3分钟 | 37 | 757.1 | 621.6 |

关闭后进程数5→4；初始样本可能复用关闭前5秒缓存，所有聚合带独立sampledAt。末值仍高于空闲，**不能据此单次样本断言泄漏/已优化**。3D已通过独立webview的model-viewer.loaded和截图验证，图片已验证naturalWidth。CLI仅打开空态，没有启动三个推理任务。脚本 `verify-low-memory-workloads.mjs` 留下可复验流程和数值证据，截图 `three-frames.png`、`media.png`、`media-closed.png`。

`first-message-readiness.json`：Claude installed=true、loggedIn=false。因此成功首发/首token时延未测，不拿Codex登录态或事件回放代替；后续需在隔离实例完成Claude正常登录。实体16GB仍未获取。

### 5：失败补偿不再误报成功
启动失败、取消、崩溃/停止的合成回执用 interrupted=true / usageKnown=false 清理busy；island不发成功结果，usage保留中断尝试而非成功完成/真实零tokens。真实正常完成仍通知。死ACP的旧UI repair先跳过账本保留队列，再标记输出为中断，避免账本B被提前消费。

最终独立审查发现上述ACP联动1项Important，已用真实函数AST/VM回归RED→GREEN修复：B保留running，renderer收到中断，后续真实B用量归B而不是C；无未处理Minor。定向与全量检查已重跑。

验证记录：最终 `npm run check` exit0，3809项，3790通过、19条件跳过、0失败；第一次全量因新增诊断execFile未登记launchCoverage失败，补齐bounded-probe与17号图纸后通过，未绕过闸门。最终隔离UI/还原构建结果见下方追加。

未授权合并/发版；继续留在独立分支。真实16GB、Claude首发、并行模型负载、热点优化20%对照、WindowsCI和打包验收仍未完成。

最终隔离 `node scripts/verify-agent-chat-ui.mjs --low-memory` exit0，9项专项断言通过；源码已原样还原，随后 `npm run build` exit0（10.2秒）。截图已亲眼检查。真实基线实例通过自己启动器精确PID 68916关闭，UI实例由脚本清理自己进程；未杀正式应用或其他CLI。生成的临时媒体夹具已清理。
