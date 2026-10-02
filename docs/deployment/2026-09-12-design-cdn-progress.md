# 设计选型台 CDN 迁移进度 · 2026-09-12

## 最新进度：Let’s Encrypt 已签发
- 2026-09-12 21:40：用户明确限定“取消我自己选型台里的付费标签／筛选，然后用本地资源上传到 CDN”。已完成本地整理与上传，不补抓需登录资源。
- 上传目录 /Users/biily/Biily/cowork/设计规范/design-cdn-upload，307 套、1453 文件、433393092 字节；仅 cdn-mirror 和 design-library，不含原始 projects 元数据及备份报告。脚本 docs/deployment/prepare-design-cdn.py 可重建。
- 已移除上传版 design-library/index.html 价格标签及 JSON pricingType/buyoutPrice；现有应用 DesignPicker.tsx 和当前 skill lib/index.html 搜索未发现付费 UI，无须虚构修改。原始备份保留不覆盖。
- OSS 控制台验证全部 1454、成功 1454、上传中 0、失败 0（含此前 1 个 smoke 文件）。
- https://design.biily.top/design-library/index.html HTTP 200，Safari 已亲眼验证 307 卡片正常显示且无价格标签；点击 ChatGPT 看预览打开 design.biily.top/cdn-mirror/template-kits/chatgpt-1784283254957/home_72812794.html，画面正常。
- 尚未逐页验证 307 套外部依赖；尚未把 Eas-Term 内置 design-previews.json 的旧 CDN 链接替换并构建发版；自动续期仍未配置。不要宣称这些后续事项完成。
- 2026-09-12 连通性验收通过：通过 OSS 控制台上传 cdn-check-20260912.txt（44 字节），CDN HTTPS GET 返回 200 且正文完全一致；匿名直接访问 OSS 同一对象返回 403。私有 Bucket + CDN STS GetObject 路径已实际验证。
- 批量上传前发现备份报告标注 287 套 paid、部分 hasAccess:false、31 项需登录。未批量上传第三方模板，需明确用户对这些模板的公开托管/再分发权限；不要把可下载等同于有再分发授权。
- 2026-09-12 后续：用户明确授权私钥上传阿里云，已通过原生文件选择器上传 fullchain.pem 与专用 .key 文件，阿里云提示上传证书创建成功。证书名 design.biily.top-LE-20261212，certificateId 27219207。
- CDN HTTPS 已提交且控制台确认“已开启”，匹配 design.biily.top、品牌 Let’s Encrypt。下面记录的“尚未上传/启用”是前序状态，已被本条取代。自动续期与网站资源迁移仍未完成。
- 用户明确同意 LE-SA-v1.8-July-06-2026 协议；本机隔离 certbot 已签发 design.biily.top 证书，到期 2026-12-12。
- 新增 _acme-challenge.design TXT，公共 DNS 验证成功。
- fullchain.pem 和 privkey.pem 位于 ~/keys-vault/design-cdn/config/live/design.biily.top/，不输出私钥。
- 手动 DNS 申请，自动续期尚未配置。
- 阿里云上传证书表单已打开，尚未上传；等待用户授权将此证书私钥提交阿里云供 CDN TLS 部署。HTTPS 仍未启用。

## 已配置（控制台确认）
- 专用 OSS：biily-design-previews，北京，Standard/LRS，Private，阻止公共访问开启；尚未上传对象。
- CDN：design.biily.top，中国内地，状态正常运行；源站 biily-design-previews.oss-cn-beijing.aliyuncs.com:80。
- DNS design CNAME → design.biily.top.w.kunlunaq.com，TTL 10 分钟；新增 ownership verification TXT 已验证，既有记录未改。
- 角色 AliyunCDNAccessingPrivateOSSRole，信任 CDN；仅绑定自定义 BiilyDesignPreviewsCDNReadOnly：oss:GetObject，资源 acs:oss:*:*:biily-design-previews/*。没有授予全账号 OSS 读取权限。
- CDN 同账号私有 OSS 回源 STS 开关已开启；尚未进行对象访问端到端验证。

## HTTPS 当前
- 用户已确认 HTTPS 请求按量计费；控制台计费提醒已勾选确认。
- 尚无可选证书，HTTPS 最终配置未提交、未开启。
- 已打开数字证书管理服务购买页检查免费选项，未下单、未勾协议。
- 免费证书 UI 明示：90 天有效，不支持商业用途，仅个人开发测试；不能直接用于产品正式预览服务。
- 当前表单选择免费档，仅草稿；勿提交。下一步选择允许正式用途的证书路径（可研究 Let's Encrypt），或经用户明确报价同意付费证书。

## 后续
1. 配置合规 HTTPS 证书并验证；HTTPS 回源、缓存规则、用量限制待配置。
2. 本地备份 /Users/biily/Biily/cowork/设计规范/vechooool-backup；约 426 MB，307 套，部分依赖缺失需清点。
3. 准备仅公开预览资源的上传树，不上传元数据/私密资料，不绕过登录限制；重写旧 CDN 引用。
4. 上传测试对象验证私有回源，再批量迁移，更新应用索引并构建验收。

未修改应用代码，未操作 ECS 或其他 Bucket；CDN 已建不代表网站迁移完成。

## 续作：应用预览链接切换与验收
- voice-regression 工作树 design-previews.json 的 307 个预览地址改为 https://design.biily.top/cdn-mirror/，保留路径、查询参数与本地封面。
- designCdn.test.mjs + designSystems.test.ts：6 项通过；npm 构建成功（/tmp/eas-cdn-build.log）。
- 307 个预览 HEAD 检查全部 HTTP 200，报告 design-cdn-url-check.json。此项不是全部页面视觉/依赖验收。
- CUA 最初选到旧开发进程 33621 的未刷新窗口，仍是旧 CDN；刷新后重新从辞典 → 设计选型台 → 预览效果进入，地址栏确认 design.biily.top，亲眼看到 ChatGPT 示例完整渲染，弹窗与背景弱化保留。
- 另启动隔离实例 58632 / eas-verify-BQTMve，未复制生产密钥。没有提交、发版。
- HTTPS 自动续期尚未配置，不应当作已完成；现证书 2026-12-12 UTC 到期。
