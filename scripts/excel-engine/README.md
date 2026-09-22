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
