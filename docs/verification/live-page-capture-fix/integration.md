# 主线整合与发布风险复核 · 2026-09-27

## 范围
修复提交36453b3a；本地主线合并fa063424，基线origin/main为2e17c7f7。只整合高清预览代码、脚本及必要证据文档，不夹带主工作区其他agent改动。无版本变更、无正式发布。

## 依赖评估
重新npm audit：16个依赖节点告警，1 critical/14 high/1 moderate。它不是16个已验证可利用的产品漏洞。生产依赖审计为0，但所有告警被锁文件标为dev也不能证明分发产品安全。

- **Electron 37.10.3**：实际随包分发，属于运行时风险。必须优先在独立分支选择受维护且覆盖告警的版本并完成原生模块、webview/权限、截图CDP、打包回归。不自动执行audit fix --force跨大版本升级。
- **tar 6.2.1 / 7.5.16**：位于原生模块重建、node-gyp与app-builder构建链。历史告警涉及解包越界，不能因为只在构建时运行就忽略；可信下载/hash校验只能降低暴露，不是漏洞修复。应更新上层构建链并验证全部平台产物。
- **其余构建依赖**：@electron/node-gyp、@electron/rebuild、xmldom、baseline-browser-mapping、brace-expansion、browserslist、cacache、extract-zip、form-data、js-yaml、make-fetch-happen、nanoid、postcss、undici。锁文件对应节点均dev；优先补丁级更新，再构建验证。尚未逐项证明包内不可达。
- 不在本轮合并中变更package/lock，避免把未经兼容验证的依赖升级混入已验修复。完整节点、版本和公告链接见dependency-assessment.json。

## 已核对的实际保护与缺口
Electron官方GHSA-9f4c-93c8-jc8g说明：无allow-popups的沙箱iframe仍可能触发新窗口；拒绝setWindowOpenHandler可缓解。
本项目livePage.ts和report-preview分支明确deny；普通浏览器webview为支持OAuth允许受控新窗口，因此**不能把预览保护等同于所有浏览器路径无风险**。未制作攻击页验证，不声称可利用性已证实或排除。
https://github.com/electron/electron/security/advisories/GHSA-9f4c-93c8-jc8g
tar官方解包越界公告：
https://github.com/isaacs/node-tar/security/advisories/GHSA-34x7-hfp2-rc4v

## 本机复验记录
主线初次check因未安装工具报tsc: command not found；链接既有依赖后检查通过。首轮3877通过19跳过，OMP未下载导致多跳过一项。随后逐文件复制已验证缓存，再官方fetch校验manifest SHA与可执行位，实际ACP门禁复验；最终统计补记在下方。
本轮补验的是构建产物与隔离应用，不是已签名安装候选包。

## 发布门禁仍开放
- 依赖升级和实际安装包依赖/漏洞可达性评估。
- Mac双架构签名公证安装、同SHA Windows构建与安装；没有以触发release/tag方式代替验收。
- 跨实体显示屏DPI、长时CPU/RSS、三CLI真实在线模型调用。
- Computer Use会话级释放未验；完整闲置重建未实现。
先处理运行时/构建依赖安全，再制作全平台候选，避免签一个已知待升级的包。

## 最终复验
合并结果全量check：3878通过、18跳过、0失败。生产build、renderer双入口、通用computer helper、OMP18.1.2真实ACP握手通过。隔离实际应用50项通过，最大化与降级提示截图已眼验。没有签名安装包验收，不冒充跨平台候选通过。
