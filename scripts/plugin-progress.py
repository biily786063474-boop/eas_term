# -*- coding: utf-8 -*-
import sys, subprocess, time, html, pathlib, datetime, os
ROOT=pathlib.Path(__file__).resolve().parent.parent
OUT=ROOT/'docs/verification/plugin-marketplace/progress.html'
def render(title,state,elapsed,tail=''):
 stamp=datetime.datetime.now().astimezone().isoformat(timespec='seconds')
 refresh='<meta http-equiv="refresh" content="5">' if state=='运行中' else ''
 text='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'''+refresh+'''<title>插件接入 · 实时进度</title><style>*{box-sizing:border-box}body{margin:0;background:#0a0a0a;color:#f5f5f5;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1080px;padding:28px;margin:auto}h1{font-size:29px;letter-spacing:-.02em;margin:8px 0}h2{font-size:12px;color:#a3a3a3;letter-spacing:.15em}section{background:rgba(23,23,23,.5);border:1px solid #262626;border-radius:14px;padding:20px;margin:18px 0}.muted{color:#a3a3a3}.warn{border-left:2px solid #fbbf24}.good{color:#6ee7b7}table{width:100%;border-collapse:collapse;font-size:13.5px}td{padding:9px;border-bottom:1px solid #262626}pre{background:#111;white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border-radius:12px;font-size:12px}.tw{overflow-x:auto}</style></head><body><main><h2>LIVE TASK STATUS / 本地轮询节点</h2><h1>插件市场统一接入</h1><p class="muted">按原 Demo 32 项接入 · 未上线 · 不修改正式应用</p><section class="warn"><b>'''+html.escape(state)+' · '+html.escape(title)+'''</b><p>本次任务耗时 '''+str(round(elapsed))+''' 秒</p><p class="muted">最后采样：'''+stamp+'''</p><p id="stale"></p></section><section><h2>DELIVERY / 交付阶段</h2><div class="tw"><table><tr><td>清单与设计</td><td class="good">已确认 · 32 项</td></tr><tr><td>兼容性门禁</td><td>代码已接线 · 不兼容拒绝已隔离 UI 验证</td></tr><tr><td>打包与安装边界</td><td>打包保护与 3 项 IPC 边界测试通过</td></tr><tr><td>远程 MCP / 统一授权</td><td>协议基础已通过本地 HTTP 测试；生产接线与授权未完成</td></tr><tr><td>32 项插件接入</td><td>未完成；不以目录卡片计完成数</td></tr><tr><td>市场独立更新验收</td><td>未完成</td></tr></table></div></section><section><h2>PROCESS / 真实任务输出</h2><pre>'''+html.escape(tail or '暂无后台命令；当前在编辑与核查。')+'''</pre></section><p class="muted">运行时每 5 秒采样并刷新；结束后显示真实退出结果。页面轮询不会启动任务，也不会让 AI 在会话结束后自行继续开发。</p><p>反馈指令：<code>汇报当前阻碍</code></p></main><script>const age=(Date.now()-Date.parse('''+repr(stamp)+'''))/1000;if(age>30&&'''+('true' if state=='运行中' else 'false')+''')document.getElementById('stale').textContent='采样已超过 30 秒未更新，任务状态待核实，不能据此认定仍在运行。';</script></body></html>'''
 tmp=OUT.with_suffix('.tmp');tmp.write_text(text);tmp.replace(OUT)
if len(sys.argv)>2:
 title=sys.argv[1]; log=pathlib.Path('/tmp/eas-plugin-visible-task.log');start=time.monotonic()
 with log.open('w') as f:
  p=subprocess.Popen(sys.argv[2:],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT)
  try:
   while True:
    rc=p.poll(); tail='\n'.join(log.read_text(errors='replace').splitlines()[-16:])
    render(title,'运行中' if rc is None else ('通过' if rc==0 else '失败，退出码 '+str(rc)),time.monotonic()-start,tail)
    if rc is not None: sys.exit(rc)
    time.sleep(5)
  except BaseException:
   if p.poll() is None:
    render(title,'监控已停止，子任务状态待核实',time.monotonic()-start)
   raise
else:render('正在编辑：打包器兼容要求与安装边界测试','本轮处理中',0)
