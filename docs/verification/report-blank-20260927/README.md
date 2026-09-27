# 汇报预览白区修复

- 复现：原样构建下，宿主 clientHeight=98，guest innerHeight=150。新增真实 Electron 尺寸断言先失败（before.log）。
- 原因：`.live-page-report-guest{display:block}` 覆盖 webview 的 flex 布局，内部 iframe 保持默认150px高度。宿主更高时出现白区，更矮时内容被截断。
- 修改：恢复 display:flex，不注入页面 CSS，不改变报告授权/导航隔离。
- 验证：生产构建；真实隔离 Electron 画板内预览、软件内最大化、分屏抽屉分别校验 guest 与宿主尺寸；原有授权撤销、跨会话及页面操作测试继续执行。截图和完整结果在本目录。
- 调试页是固定1080×780捕帧、object-fit:contain，在不同宽高比容器有留边，与报告150px问题不同；本次不裁切页面来掩盖留边。
- 未验证：用户原报告HTML（未取得）、Windows。未提交、未合并、未替换正式版。没有进行本分支全量测试复跑，此次为预览专项验收。
