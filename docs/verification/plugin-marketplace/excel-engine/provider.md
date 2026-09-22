# Excel 原定功能补齐：引擎验证

2026-09-21。现有 ExcelJS 4.4.0 路线只做单元格读写且主动拒绝改写图表/透视工作簿，不能继续以其基础包代表原Demo全部能力。
候选 Excelize v2.11.0：原生可编辑图表、真实 OOXML 数据透视表以及 CalcCellValue 公式计算；不是图片图表或手算汇总表替代。

官方来源（本轮核对）：
- https://xuri.me/excelize/en/pivot.html ：AddPivotTable / GetPivotTables，行列筛选与聚合字段。
- https://xuri.me/excelize/en/chart.html ：AddChart 原生图表。
- https://xuri.me/excelize/en/cell.html ：CalcCellValue 等单元格方法。
- https://pkg.go.dev/github.com/xuri/excelize/v2 ：版本/接口。

采用前必须证明：公式依赖与错误可见、真实pivot/chart部件存在、二次编辑保留这些部件、离线运行与三平台构建、逐依赖许可证/漏洞审查。仍须整合目录授权/哈希覆盖/解压与XML守卫/超时内存边界，不放松现有安全拒绝。
Go仅作为开发构建工具，本机此前未发现Go。临时路径/tmp/eas-excel-go-1.26.8，官方go.dev下载清单给出darwin-arm64 archive SHA256 a012b25b571bd0138a03dcd25375ceba866fe5ca822f426d2c66a4de56fd3f4b，下载后校验再解包，不安装到系统，不要求最终用户装Go。
此目录是依赖资格验证，不是已交付插件、不增加默认市场包数量。既有ExcelJS插件尚未替换。

## 实际发现（不能省略）
- 已读取固定版本 LICENSE：BSD-3-Clause，并非此前仅凭印象猜的MIT；实际二进制分发需携带所有依赖许可。
- 已读取pivotTable.go:addPivotCache，新增透视表缓存设置SaveData=false/RefreshOnLoad=true。因此“写入真实透视表定义”不等于“软件内已经计算并展示透视汇总”；需要Excel实际刷新验收，并在工具结果里明确，不能用XML测试代替视觉验收。
- 新引擎只是补齐候选：现有ExcelJS更新路径会拒绝含图表/透视内容；接入时必须统一新引擎处理这些文件，不能生成后再走旧路径丢内容，也不能简单删除旧安全拒绝。
