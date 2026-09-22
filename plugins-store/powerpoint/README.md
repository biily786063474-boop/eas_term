# PowerPoint 演示 · 基础接入

安装后选择允许访问的演示文稿目录，无需微软账号。
三 CLI 共用宿主提供：
- powerpoint_create：创建 16:9 标题/正文文本幻灯片。
- powerpoint_read：按 presentation.xml 关系顺序读取文字及 0 基索引。
- powerpoint_edit：按幻灯片/文本 run 索引替换文字。复制其余 ZIP 部件，
  保留模板/布局等原有内容；不重新生成整个文件。

覆盖须当前 SHA256。禁止目录越界、符号链接、多硬链接；
8MB 压缩文件、32MB 实际展开总量、2000 ZIP 条目、100 张幻灯片。
拒绝 XML 实体、外部关系、宏、ActiveX、嵌入对象与签名包。
不执行脚本、不请求网络、不自动获取外链图片或用户其他文件。

局限：create 仅文本布局，不提供图片/图表/动画生成或编辑。
read 不渲染视觉；edit 不重排版，长文本可能溢出；复杂视觉保真仍需人工检查。
自闭合空文本不支持编辑；支持普通 DrawingML 文本 run。
未验真实模型 CLI、Windows 或 PowerPoint/Keynote 视觉效果。

维护：npm ci --prefix scripts/powerpoint-connector --ignore-scripts
然后 node scripts/build-powerpoint-plugin.mjs。生成 bundle 禁止手改；
实际打包依赖许可随 THIRD-PARTY-NOTICES 与 LEGAL 文件附带。
PptxGenJS 4.0.1 / JSZip 3.10.1 / Saxes 5.0.1；
image-size override 2.0.3，专属依赖树 npm audit 当前0告警。
不得以此推定整个仓库无漏洞。此插件当前不调用 image-size API，
未来添加图片功能必须重新审查上游 API 与安全边界。

官方 API 来源：
https://gitbrent.github.io/PptxGenJS/docs/quick-start/
https://gitbrent.github.io/PptxGenJS/docs/api-text/
https://gitbrent.github.io/PptxGenJS/docs/usage-saving/
依赖告警（首次audit高危2项，含上游聚合）：
https://github.com/advisories/GHSA-w3rx-r6r6-pgpr
https://github.com/advisories/GHSA-5p2g-fcmc-qvqq
注意网页仍写 patched none，不以网页声称2.0.3已验证修复所有解析器；
本次以锁文件、实际audit和当前不暴露图片输入的范围为证据。
