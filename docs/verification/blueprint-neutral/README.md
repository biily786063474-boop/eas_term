# 蓝图中性底图验收
2026-09-23，基于0.4.106主线b7d526ad，独立工作树fix/blueprint-neutral-20260923，未合并/未发布。

- SVG及预设缩略图默认中性色，交互区域保留slot高亮色；缩略图整卡hover只增强中性轮廓。
- 新增样式回归先失败2项，最小CSS修改后通过。build/typecheck通过。
- 真实Electron隔离用户配置验收28项通过：深浅主题、SVG跳转/重复点击/键盘、列表联动、减少动态。已查看blueprints/desktop/blueprint-light截图。
- 验收初次断言把缩略图hover合法的t-2与默认t-3混为一谈导致失败；确认实际stroke为中性rgb后，测试按hover状态区分token，未叠加产品补丁。
- 未替换正式应用，也未更新已发布0.4.106安装包。仅测试实例验证。
- 后续同分支追加按区域语义绘制的线框图，参见 ../blueprint-wireframe/README.md；原中性色结论保留。
