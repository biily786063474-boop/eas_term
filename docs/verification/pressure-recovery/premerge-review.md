# 合并前审查 · 2026-09-27
生产修复仅CanvasImageViewer两行 + 两项结构回归；真实GUI原6轮和安全加固后1轮通过。图片自身双击/平移/滚轮未改。runtime/ipc.ts与HEAD字节一致，最终out/main/index.js无verifyQueued/verifyTick/verify-queue-标记。
独立审查4项阻断全部处理并复审无新阻断：CDP归属；报告隐式跨树写；引擎A/B中断；清理失败判据。安全测试5通过含真实Electron中断，图片结构2通过。全量check3812通过19跳过0失败，build通过。加固后媒体1轮通过；队列首次设置面板消失导致按钮定位失败，失败证据保留，随后鼠标驱动验证位置稳定与真实命中才点击，重跑超过70秒、取消B、A/C按序一次成功，原文恢复重建且所属残留0。
新增scripts仅手动运行，不在产品导入图/常规test入口；打包白名单out/**/*无配置变更。仅提交明确清单；scratchpad、out、node_modules、.local trace/log/备份/运行锁不入库。历史诊断及截图保留可追溯，失败采样不删除。
审查不等于16GB实机、OS压力、Claude调用或Windows验收；无内存策略调整、无引擎升级、无发版。
