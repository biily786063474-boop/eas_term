# 0.4.106 发布候选
基于63d74605，整合已批准的蓝图SVG定位/配色与辞典提示渐进披露。
全量check 3594通过19跳过；typecheck/build通过。独立审查82项测试通过，无P0/P1。
辞典实机首次定位selected SVG出现null，未修改产品代码完整复跑24项通过，保留原失败日志。不将单次通过描述为无偶发问题。
已知边界：Jev单进程累计100次（跨日需重启插件），外部Computer Use指针残留未解决；时间线阶段性记录、离屏优化和边缘拖拽实验不包含。
当前尚未发布，正式状态以最终发布证据为准。

核查纠正：词条对齐已在21b3650a的DictView/useLayoutEffect + rowLetterSpacing实现，非CSS justify-content。正式候选包实测完整行对齐、末行自然宽度；此前仅查CSS的判断有误。

## 安装包门禁
- Windows35844922452全流程success，产品b9a606d8。
- Mac ARM/Intel签名、公证、staple、Gatekeeper通过；ZIP/DMG内app.asar与验收应用一致。
- ARM正式包24项UI及6项看板检查通过，Intel Rosetta正式包24项UI通过（含真实PTY创建，不是实体Intel）。截图已亲眼查看。
- Intel首次15秒调试端口超时；第二次启动成功但键盘聚焦断言被保留鼠标位置与滚动产生的hover干扰。验收脚本在键盘专项前将指针移出滚动区域，最终完整通过；产品代码不改，原始失败记录保留。
- 首轮软链node_modules打包漏传递依赖，整包废弃。使用实体依赖副本重打包，正式候选含SDK所需zod，生产依赖audit为0。
