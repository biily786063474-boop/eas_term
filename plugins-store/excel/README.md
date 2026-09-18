# Excel 表格（基础接入）

安装后在设置中选择允许访问的表格目录，无需微软账号。
三个 CLI 经同一宿主获得 excel_read / excel_create / excel_update。
运行包含离线依赖，不下载 npm 包。

支持真实 XLSX 多工作表、普通单元格读写和显式本表数值公式。
字符串不会自动转公式。公式不在插件中计算，仅写入并要求 Excel 打开重算；
read 返回的是公式与文件已有缓存，缓存不能视为本次计算结果。
覆盖或更新须当前 SHA256，禁止越界路径、符号链接和硬链接。
限制：8MB 文件、32MB 展开体积、20 工作表、50000 个单元格、
10000 行/1000 列、一次1000个修改。
拒绝 XML 实体、宏、外部关系/数据；带图表、透视等复杂部件拒绝改写。
不支持完整公式引擎、透视表创建、图表创建或复杂格式无损往返。

维护：npm ci --prefix scripts/excel-connector --ignore-scripts
然后 node scripts/build-excel-plugin.mjs，禁止手改生成 bundle。
ExcelJS 4.4.0 使用 uuid 11.1.1 override 修复 GHSA-w5hq-g745-h8pq，
直接打包文档 Workbook（不含旧 streaming reader），31 份实际打包依赖许可附包。
来源：https://github.com/exceljs/exceljs/tree/v4.4.0
https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq
saxes npm 未附许可证，按固定 v5.0.1 上游 LICENSE 收录：
https://raw.githubusercontent.com/lddubeau/saxes/v5.0.1/LICENSE
