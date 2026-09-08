# 真实付费断线测试 · 2026-09-08

用户在已报价 Z-Image Turbo 1K 单图 4 墨水后回复“好测试一下”，本轮只提交一次。结果：**请求认领/不重复提交通过，生成失败并退款；成功产图验收未通过。**

## 实际链路

笔纵正式包 1.21.31（严格 codesign 通过）在隔离 profile 中运行；从同机已有账号复制加密登录文件，仅用于本次已授权请求。其正式 MCP 经实际 localhost HTTP 代理连接正式 API/ActionBus/生成服务。代理只在 generate_now 的上游返回 HTTP 200 后断开客户端响应，不伪造服务端响应。

Eas-Term 使用源码 9510ff2 的生产 `createBizoneGenerationGuard`、`createBizoneConnector` 和 `McpClient`，校验三个源码文件与冻结提交一致。**该付费测试是 Node 宿主测试程序，不是 Eas-Term GUI 正式进程的付费端到端验收**；已有正式 Eas 三端落图/重启证据属于独立矩阵。

- 报价 requestId：`eas-quote-3db3ddb0-6959-4d06-a8e1-c5119722277b`，4 墨水。
- 执行 requestId：`e1c99cc6-0bcf-4f65-a758-662dbc3debe9`。
- 响应连接断开后，宿主更换 MCP 客户端并按同一 ID 查询，取得 `acknowledged`。
- 关闭并重新构造防重 guard，从磁盘读回 intent，再次请求同一逻辑操作时只查询认领。这里是 guard 实例重建，**不是 OS 进程或应用重启**。
- 代理记录实际 `/api/generate_now` 只有一次；后续为请求身份查询。
- 节点最终 `error`、没有媒体，错误为“生成服务返回异常，本次墨水已退回”。未自动换 ID、模型或节点重试。

## 计费证据

通过与产品账单相同的认证只读 `credit_transactions` 接口查询本轮时间范围，密钥留在应用进程内，未输出或落入报告。两条交易：

| ID | 变化 | 来源 | 幂等标识 |
|---|---|---|---|
|1466|-4|consume_image|gforn_z-image-turbo_1788878131792_n30x4e|
|1467|+4|refund_generate_image_failed|gforn_z-image-turbo_1788878131792_n30x4e_refund|

余额 399412 → 399408 → 399412，净扣费 0。此证据证明本次失败路径只有一笔消费及其对应退款；不扩大为所有生成类型/网络故障下的计费保证。

[实际证据](evidence.json)保留 passed=false，reconciliationPassed=true、singleChargeAndMatchingRefundVerified=true、providerGenerationPassed=false。[截图](startup-overlay.png)仅为首次启动引导遮罩，不作为错误节点或生成成功的可视证据。

测试后精确核对 PID、可执行文件与隔离 profile，仅终止所属测试应用，确认退出后删除复制的加密登录文件。用户原笔纵 1.21.29 实例/项目未替换，未全局杀服务。MCP schema 缺少 requestId/query 因而未使用当前会话的旧 MCP 执行付费，而直接启动正式包自带 MCP。未修改产品源码。

首次脚本启动因 playwright-core 解析失败，尚未创建 profile 或发送请求；修正模块位置后执行本次唯一付费测试。执行后参数化路径，加入冻结源码/版本/签名校验，并补充 error 终态的留证、等待退出和加密副本清理逻辑，未再次运行付费测试。本轮账本读取、签名/源码哈希、退出确认及加密副本删除由后补只读核验/所属进程清理完成，不是首轮脚本自动完成；当前脚本仍不自动读取账本。脚本的 .one-shot 标记禁止直接重跑；原始日志和私有 profile 不提交。

正常生成成功路径、Eas GUI 付费链路和 Windows 已登录三端条件仍未完成。Eas-Term 0.4.85 未上线，不以本轮失败退款代替全部发布验收。
