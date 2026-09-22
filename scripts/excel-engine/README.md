# Excel 原定能力引擎资格验证（不是已接入插件）

目标是补齐同一个 Excel 插件的公式计算、原生可编辑图表、真正数据透视表；不另起一个缩水插件凑数。
当前锁定 Excelize v2.11.0，BSD-3-Clause，完整依赖版本/校验在 go.mod/go.sum。

## 重跑

安装开发用 Go 1.26+ 后，在本目录执行：

```sh
GOTOOLCHAIN=local go mod download
GOTOOLCHAIN=local go test -count=1 -v ./...
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go test -c -o /tmp/eas-excel-qualification-darwin-amd64
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c -o /tmp/eas-excel-qualification-windows-amd64.exe
```

测试使用真实库创建XLSX、跨表计算、写入OOXML图表/透视部件、重新打开并改源数据、重新计算且检查部件仍在。没有网络/模型/账号fixture冒充供应商。
交叉编译不代表对应OS运行通过。测试没有覆盖所有公式，也没有证明透视表刷新后的视觉结果。

## 必须接着做，不能把本测试当成功交付

1. 安全的离线独立进程协议：内存中的工作簿输入输出、无任意文件路径/网络参数、时间/输出/内存上限。
2. 将create/read/update/calculate/chart/pivot统一到引擎；保留现有文件授权、SHA256覆盖、XML/压缩包/外部关系守卫。
3. 上层schema与工具名称、描述、错误/计算结果同步；旧包不可同版本覆盖。
4. 多平台离线打包、二进制哈希与全部依赖许可/安全审查，不要求用户装Go。
5. 隔离应用市场安装→配置→三shim业务调用→撤权；实际Excel打开图表/透视刷新并截图。
6. 原Demo功能逐项标验证证据；未满足的仍开发中，不按工具数量报完成。

## 统一处理层增量

`engine.go` 已实现内存工作簿的 calculate/update/chart/pivot；`protocol.go` 的单请求JSON协议拒绝未知字段与多请求；`cmd/excel-engine` 是15秒硬退出的独立进程入口，128MB为Go软GC预算，**不是OS硬内存隔离**。
ZIP预检：8MB输入/32MB展开/2000项/100层XML/50000单元格/10000行/1000列；拒绝宏、外部数据、实体指令、外部关系、活动嵌入、越界单元格和高风险公式。OOXML包内绝对部件引用仅在目标确实存在于ZIP时接受，不是文件系统路径授权。
图表当前实现column/bar/line/pie/scatter单系列；透视行列及Sum/Count/Average/Min/Max，返回需要Excel刷新的明确提示。还没有完成完整多系列图表操作、透视刷新显示、create/read迁移及插件接线，不把当前处理层标成完整Excel功能。

编译入口：`go build -trimpath -o /tmp/eas-excel-engine ./cmd/excel-engine`。
仓库根运行真实进程验证：`node scripts/verify-excel-engine.mjs /tmp/eas-excel-engine`。
测试生成native-analytics.xlsx用于后续实际Excel验收，当前未做视觉验证。

## 父进程适配（仍未接入插件包）

`worker.mjs` 的 `runEngine(packageRoot, request, options)` 只接受连接器代码提供的可信包根目录，不能把它暴露到MCP参数或用户配置。固定 `bin/excel-engine-<Node platform>-<Node arch>[.exe]` 与 `bin/integrity.json`；manifest按平台键提供size/sha256，不接受文件名。拒绝链接目录/链接或硬链接可执行文件，执行前校验长度和SHA256。哈希用于包损坏检测，不防能同时改manifest与binary的本地恶意写入者，不替代安装包来源验证。

单次请求12MB、响应12MB、stderr64KB、默认16秒；支持AbortSignal，失败只杀本次所属进程，不全局清理；等close再完成。子进程env空、无shell、stderr不回显。合法响应字段/规范base64/8MB XLSX头检查，完整OOXML守卫仍在Go层。不是OS文件/网络沙箱。平台候选darwin-arm64/darwin-x64/win32-x64，后两者本轮未实际运行。

`node --test scripts/excel-engine/worker.test.mjs` 用真实短命测试进程覆盖父进程生命周期；`node scripts/verify-excel-worker.mjs /absolute/development/binary` 临时复制真实Go引擎跑6项业务检查，结束删除临时目录。尚未自动构建bin/integrity.json或集成market包；先补create/read、多系列与透视防覆盖，再统一迁移，不能直接移除旧ExcelJS复杂工作簿拒绝规则。

## 创建/读取统一迁移（2026-09-21）
`io.go` 添加create/read，统一使用Excelize；创建支持多工作表、字符串/数字/布尔/null/显式公式，大小/重复工作表/危险公式检查，生成后仍完整ZIP预检。读取保留类型、公式与旧缓存，`calculated:false`；日期数值保留原始Excel序列值（不是原ExcelJS的ISO日期转换），ISO date单元格返回date字段，说明中明确该差异。读取只输出数据，不重新编码原文件，不声称还原图表/透视排版。
父进程校验read响应结构、4MB/50000cells范围；`verify-excel-worker.mjs`现在用真实引擎create/read，不再借ExcelJS创建fixture，共8项实际业务检查。当前仍未替换插件入口/打包；下一步补齐多系列图表与透视防覆盖、update合并单元格/公式清除兼容性，再接MCP。

## 第1项功能/保护增量（2026-09-21）
新增最多20组图表series（pie限1组），保留旧单组参数但拒绝两套参数混用；类别/值必须为等长行或列向量。update拒绝合并区域内所有单元格，并在写普通值/null前显式清除旧公式。pivot拒绝与源区域、目的地现有值/公式、合并区域、既有透视区域和表格区域重叠。

测试检查两组原生series、长度不匹配拒绝、公式清除、合并单元格拒绝、源/已有公式防覆盖及未刷新透视表重复落点。**防覆盖目前针对声明区域，不保证Excel后续刷新增长超出该区域时安全**，实际刷新验收仍不可省。另实查上游drawChartSeries把Name写为strRef/f；目前历史调用传纯文字名称，须在接插件前处理名称引用/字面量兼容并做Excel视觉验收，不能仅凭series数量视为图表完整交付。

## 图表名称收尾（2026-09-21）
`chart_names.go`修正本API的Name字面量语义：只对本次新增chart部件的series/tx写入OOXML文本v（正确XML转义），不把用户文字当成strRef公式；既有chart部件不改。完整生成文件再次过原ZIP/XML安全预检。测试覆盖中文/特殊字符、二次单元格编辑保留、再加多系列图不改旧图。
本机/Applications与~/Applications未发现Microsoft Excel，也无可用Excel MCP；实际Excel图例与透视刷新验收仍未完成，不能拿Numbers或XML测试替代。第1项不标全量验收完成；透视刷新超出声明区域的风险仍需要实际Excel验证与策略收尾。

### Offline staging build
`node scripts/excel-engine/package.mjs /absolute/go1.26.8/bin/go /absolute/new-staging-dir`
builds darwin-arm64, darwin-x64 and win32-x64 with CGO disabled, readonly
modules, trimpath and no network/toolchain downloads. Populate the qualified
module cache first. Existing output directories are refused. Includes the
parent worker, fixed-name SHA-256/size manifest, linked-module license notices
and Go runtime license. This is a staging payload, not yet the market plugin;
platform signatures, dependency vulnerability audit, archive size and installed
plugin end-to-end acceptance remain gates. Cross-compilation is not a Windows
or Intel runtime test.

Staging also now includes an Excel 1.1.0 candidate manifest, six-tool MCP server,
connector and the unchanged directory/SHA/inode file guard. Verify with
`node scripts/verify-excel-native-plugin.mjs /absolute/staging-dir`.
This packs/extracts the complete candidate and calls create/read/update/calculate/
chart/pivot through a real stdio process, including stale SHA, traversal, symlink,
unsafe formula and read-only write refusal. It does not verify the app host or
actual models. Do not publish/promote before those acceptance gates and pivot
refresh expansion protection are resolved.

Pivot refresh reservation: creation now requires a conservative empty rectangle
based on the fixed source record count, row/column hierarchy counts and value
field count (not merely current distinct values). Existing data, merges, tables
and pivots inside the entire reservation remain rejected. Ordinary updates to
the currently recorded pivot output range are refused; update source cells instead.
This does not promise protection after a user changes source ranges/layout or
writes into reserved cells using Excel itself. External refresh can rewrite the
recorded range. Excel GUI verification remains necessary; no cached pivot totals
are produced by this engine.

Security gate (2026-09-21): x/text is pinned to 0.39.0 after audit; shared-string
negative indices are rejected in preflight. govulncheck still reports Excelize
GO-2026-6452 (no upstream fixed version), and stripped-binary scans report extra
x/crypto findings requiring reachability review. Do not publish or call audit
clean. Evidence: docs/verification/plugin-marketplace/excel-audit/README.md.
Actual old→candidate update acceptance: `node --experimental-strip-types
scripts/verify-excel-plugin.mjs /absolute/candidate --update`; filesystem rollback:
`node --experimental-strip-types scripts/verify-excel-update-rollback.mjs /absolute/candidate`.
