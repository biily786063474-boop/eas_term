# Word 文档（开发候选，未上架）

原创 stdio MCP 连接器，不是微软官方 MCP。按用户授权目录创建 `.docx`、读取正文顶层段落与顶层表格文本、对简单段落写入带作者和时间的跟踪修订。生成支持标题、1–6 级标题、粗体、斜体，以及追加到段落后的矩形文本表格。

**未完成的范围**：完整 Word 排版、表格编辑/样式/合并单元格、图片/页眉页脚、复杂段落编辑、修订接受/拒绝、真实 Word 渲染、三模型 CLI、Windows 验收。不能以这三个工具代表 Demo Word 全部能力完成，因此尚不加入默认市场。

修订现存文档必须提供当前 SHA256。已有修订、超链接、域、书签和图片等结构拒绝改写，不通过丢弃复杂内容强行成功。读取保留顶层段落索引，表格另列；不还原合并单元格布局，不含嵌套表格文本，复杂表格标记 complex。最多50张表、每表200行/50列、总计5000单元格。处理不加载外部链接、不执行宏；输入8MB、展开总量32MB、最多2000 ZIP 条目。不是操作系统沙箱，不保证抵御同用户恶意并发替换目录。

## 构建与许可

运行时不联网、不安装依赖、不需要 Word 或 Python。`lib/document.cjs` 为构建产物，不手改；源在 `scripts/word-connector/document.mjs`。

```
npm ci --prefix scripts/word-connector --ignore-scripts
node scripts/build-word-plugin.mjs
node --test src/main/wordPlugin.test.mjs
```

固定直接依赖：docx 9.7.1（MIT）、jszip 3.10.1（采用MIT选项）、xml-js 1.6.11（MIT），传递版本和完整性在专属 package-lock.json；许可证随 THIRD-PARTY-NOTICES.txt 分发。初次该依赖树 npm audit 为0已知漏洞，不代表不存在风险。

官方来源核验于2026-09-18：
- https://docx.js.org/api/modules.html （创建/格式化文档）
- https://docx.js.org/api/functions/patchDocument.html （该库模板替换不是通用修订；本连接器跟踪修订自行处理OOXML，不冒充库原生支持）
- https://www.npmjs.com/package/docx （版本、依赖和许可；核验版本9.7.1）

目录边界由本地文件插件同源实现改为二进制IO；后续安全规则更新须同步两个副本并重跑路径/硬链/覆盖测试。

表格 API 来源（2026-09-18核验）：https://docx.js.org/api/classes/Table.html 、https://docx.js.org/api/classes/TableCell.html 。
