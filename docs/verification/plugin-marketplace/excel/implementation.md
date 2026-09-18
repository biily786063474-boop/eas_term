# Excel 基础接入验收 · 2026-09-18
用户优先级：先补剩余插件，账号由安装者授权，不等待开发者个人账号。

真实 XLSX 三工具已实现：read/create/update；默认本地 v2 构建包含基础 Excel。
真实隔离应用已构建打开：市场确认下载/hash/解包、原生目录选择适配、
safeStorage 加密配置、共享宿主、Claude/Codex/OMP 三 shim 子进程、
真实临时 XLSX 创建读取、清配置/重连/锁定，共26项通过，见 result.json。
configured.png 已亲眼检查，连接测试仅列工具与业务写入分开。
专项6项通过：真实文件、公式边界、解压/XML/外部关系/宏限制、
复杂编辑拒绝、实际离线安装包、目录/哈希约束。
非真实模型 CLI、非 Excel GUI 排版/计算验收；没有修改正式应用或发布。
缺：图表、透视创建、复杂排版无损往返、公式计算引擎，不能标记完整 Demo Excel 完成。

依赖首次 audit：exceljs4.4.0 间接 uuid 导致2 moderate。
添加 uuid11.1.1 override 后 audit0；未使用 npm 建议的 exceljs3.4.0降级。
打包改用直接文档 Workbook，避免无用 stream reader，按 metafile 收录31份实际依赖许可。
saxes npm未附LICENSE；两次猜测URL404，查询上游v5.0.1目录后取正确LICENSE，非忽略许可失败。
来源及重建命令在包 README；完整专属 lockfile 受版本控制。
绝对引用专项首次失败“公式只允许本表单元格引用”，修复词法扫描支持$后通过。

最终全量 npm run check：3431 项 / 3413通过 / 18跳过 / 0失败。
默认本地目录构建成功：v1=2、v2=5；未上传生产。
