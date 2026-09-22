# 插件接入方法论基准

2026-09-21 用户硬性要求：每个插件必须基于已经跑通的方法论，不得重复试错。
本文件是工程执行协议，不是“32 项已完成”声明。优先复用机制与验收流程，
不能把样板插件的业务缺口、受控供应商结果或未关闭的安全风险当成熟能力复制。

## 开工前：先查先复用

每个插件开工记录四项：原 Demo 功能清单、采用哪个已验证样板、仅有的差异、
对应验收证据。先查本文件、项目 memory 与该类 verifier/结果/历史 failure。
同类问题必须引用已有结论；禁止不查记录就重新换库、换授权方案或重复下载。
只有已有方案确实不覆盖且有代码/文档/失败证据时，才开新验证分支；记录原因，
验证成功后把结论补回本基准。方法复用不等于省略必要回归或套用别的插件账号结论。

## 样板路由（只复用标明已验的层）

| 类型/机制 | 现有基准 | 复用内容与边界 |
|---|---|---|
| 通用市场包 | scripts/pack-plugin.mjs、scripts/build-plugin-registry.mjs | 清单、固定版本、哈希、包大小、许可、安装确认；不用临时脚本另造安装器 |
| 本地目录权限 | scripts/verify-local-files-plugin.mjs、src/main/pluginConfiguration.ts | 原生选目录/二次确认、密文保存、锁定/撤销、路径安全；不得硬编码开发者目录 |
| 本地办公文档 | scripts/verify-excel-plugin.mjs、scripts/verify-powerpoint-plugin.mjs、scripts/verify-word-plugin.mjs | 真实临时文件、SHA 冲突保护、实际宿主及三 shim；不继承“功能已完整”结论 |
| 无账号联网 | scripts/verify-web-fetch-plugin.mjs | 公开 DNS/IP 校验、重定向边界、超时/体积限制、隐私披露；真实公网能力单独验 |
| API Key 联网 | scripts/verify-weather-plugin.mjs、scripts/verify-amap-plugin.mjs | 统一密文配置、固定服务端点、脱敏错误/输出、受控端到端；真实 Key/供应商结果未自动继承 |
| 远程授权 | scripts/verify-bearer-plugin.mjs、scripts/verify-dynamic-oauth-plugin.mjs | 统一宿主/授权状态/撤销测试；各平台客户端注册、审核、回调差异必须查官方文档 |
| 独立热更新 | scripts/verify-plugin-hot-update.mjs、scripts/verify-excel-plugin.mjs --update | 同进程目录刷新/更新确认、配置保留、运行中拒绝、损坏包保旧；不能冒充生产 CDN 验收 |
| 更新失败恢复 | src/main/pluginReplace.ts、scripts/verify-excel-update-rollback.mjs | 完整树替换失败恢复；不宣称断电/进程崩溃恢复 |
| 原生离线引擎 | scripts/excel-engine/package.mjs、worker.mjs | 固定平台路径、校验后执行权限、清理环境、超时/输出限额、依赖许可；原生候选仍有审计/实机待验 |

## 所有插件共用的执行顺序

1. 原定功能逐项对照，明确支持/不支持/待账号验；不能用卡片数充完成数。
2. 复用统一宿主、配置和授权 UI、三 CLI shim；连接器只实现业务差异。
3. 接入前固定依赖并审计，审计告警查源码与实际可达性，保留原始结果；不屏蔽、删守卫或只追求绿灯。
4. 自包含候选包：用户侧不装编译器/开发依赖；许可、完整性、平台差异都有记录。
5. 单测 → 真实包 stdio → 构建打开隔离应用 → 真实市场安装/配置/调用/撤销 → 更新与失败路径。
6. 专项复用必要用例：未授权拒绝、锁定/清除使旧连接失效、异步旧确认失效、路径越界、旧 SHA 拒绝、业务文件保留。
7. CLI shim 通过不等于模型 CLI 推理通过；原生跨编译不等于目标 OS 执行；格式结构通过不等于 Office 视觉通过。
8. 成功后沉淀可复用用例和坑位，标出具体证据文件与当前代码版本；新增事实覆盖旧结论时保留历史并注明更正。
9. 更新架构/进度再提交候选；不动正在使用的正式应用，不擅自 push、发布或部署。

## 已跑通、不得再踩的坑

- staging 目录必须保留 `<随机>/<插件名>/`，否则清单名与目录名校验失败。
- 已归档包内容变化必须升版本；不删旧包或跳过同版本完整性检查来“修”构建。
- 宿主解压故意忽略 ZIP 执行位。原生 worker 仅在固定路径/文件身份/哈希校验后补 owner execute，不能全局放开 ZIP 权限。
- 隔离启动适配不得把 import 插在 shebang 前。测试须用隔离 HOME/profile，保护真实凭证。
- 刷新目录后等按钮可用再点；配置面板可能保留打开态，不能盲目 toggle。失败时先查状态，不改产品安全逻辑迁就测试。
- 下载被打断先核实原 PID/句柄；存活就继续观察，终态后才断点续传；验字节数和签名，不重复下整包。
- govulncheck 对去符号二进制可能降级到模块级精度；查 extract/源码/有符号诊断对照，不凭告警标题判可达，也不凭一条绿测判整个库安全。
- Excel 直接 GetCellValue 与批量 GetRows 对非法索引行为不同；边界在共同预检钉住，不只测单接口。
- 需要真实账号/平台审核时只标该项外部阻塞，继续其他可自主工作；不得冒用别的客户端身份。

## 进度与交付

长任务复用 scripts/plugin-progress.py 和当前 Frame 已有 progress.html 节点。
该脚本共用一个日志/输出，同一时刻仅一个 wrapper，避免互相覆盖。观察超时
不代表进程结束，轮询原句柄到终态。最后明确：代码/隔离验收/真实服务/发布分别到哪。
每个插件的新增差异与验收存 docs/verification/plugin-marketplace/<plugin>/；
通用失败修复沉淀回本文件，而不是下个插件再走一次相同弯路。

- Excel 临时 SST 分支适用性用“生产参数无临时文件 + 同文件低阈值确实产生临时文件”正反对照证明；参数共用 `workbookReadOptions()`，XML/总解压阈值保持相等。结论仅针对当前参数，不继承为上游库零漏洞。

- Desktop roundtrip must start from a file saved by the target editor, not only a freshly generated package. WPS adds formula caches; editing source cells without invalidating dependent caches can produce correct engine calculation but wrong GUI values. Reuse the WPS regression fixture, invalidate caches without inventing results, and verify the exact reopened filename before counting a pass.

- WPS Office 往返：无修改时 Cmd+S 可能完全不写文件，必须检查 SHA256/包内 WPS 元数据；对纯验收样本做一次可逆文字编辑再保存，才可声称 WPS 序列化后的兼容。先关闭精确文件标签，再调用插件，再按精确路径重开核验。三件套可复用 `scripts/verify-wps-office.mjs` 与 `wps-office/` 证据，禁止重复下载安装。
- Excel 原生透视值列必须显式填 `PivotTableField.Name`，例如 `Sum of Amount`；WPS 能算正确总计并不意味着列标题存在，标题与数值分开验证。
