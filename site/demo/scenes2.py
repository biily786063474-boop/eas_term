# -*- coding: utf-8 -*-
"""15 个演示 —— 全部装在真实应用窗口里，按滚动步号分步。
结构与数值照 promo 分支 film9/*.tsx（用户拍板过的产品 UI 重画版）。"""
from shell import win, frame

def S(steps, body): return {'steps': steps, 'body': body}
SC = {}

# ── 工作区：空画布 → 菜单 → Frame 落下 → 三颗底座 → 对话模块（照 Onboard.tsx 的流程）
SC['工作区'] = S(4, win('eas-demo', '''
  <div class="o-empty"><span data-dango="idle" data-size="48"></span>双击创建你第一个造梦空间</div>
  <div class="menu o-menu">
    <div class="o-mrow"><span class="inp" style="flex:1">搜项目…</span><span class="o-sq">▦</span><span class="o-sq">◷</span></div>
    <div class="o-msep"></div><div class="o-madd">添加项目文件夹…</div>
  </div>
  <div class="frame o-frame" style="left:11%;top:16%;width:78%;height:68%">
    <div class="frame-bar"><span class="pt"></span>eas-demo<span class="rt">1 / 5</span></div>
    <div class="o-card">
      <div class="dim" style="font-size:10.5px;margin-bottom:9px;text-align:center">选一个 AI 开始</div>
      <div class="o-bases"><span class="o-base b1">Claude Code</span><span class="o-base b2">Codex</span><span class="o-base b3">原生 Harness</span></div>
      <div class="o-hintline">›_ 先开个终端</div>
    </div>
    <div class="node o-chat" style="left:6%;top:38px;width:88%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b><span class="rt">Codex · medium</span></div>
      <div class="node-b"><div class="dim" style="text-align:center;padding:10px 0 12px"><span data-dango="idle" data-size="24" style="margin:0 auto 6px"></span>伟大的产品始于一句「你好」</div>
        <div class="inp">说点什么…</div></div>
    </div>
  </div>'''))

# ── 无限画布：对话 + 终端 + 网页三个模块同框（A1 的网页版）
SC['无限画布'] = S(4, win('Aurora 官网', frame(8, 14, 84, 74, 'Aurora 官网', '''
    <div class="node c-n1" style="left:3%;top:38px;width:30%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="bub c-ask">把首页标语换一句</div>
        <div class="tool c-t1" style="margin-top:7px"><em>Edit</em> site/index.html</div></div>
    </div>
    <div class="node c-n2" style="left:35.5%;top:38px;width:28%;height:calc(100% - 50px)">
      <div class="node-h"><b>终端</b><span class="rt">zsh</span></div>
      <div class="node-b mono" style="font-size:9.5px;line-height:1.9;color:var(--t3)">
        <div>› ./scripts/publish-site.sh</div>
        <div class="c-t2" style="color:var(--ok)">✓ 已发布 · eas.biily.top</div></div>
    </div>
    <div class="node c-n3" style="left:66%;top:38px;width:31%;height:calc(100% - 50px)">
      <div class="node-h"><b>网页预览</b><span class="rt">eas.biily.top</span></div>
      <div class="node-b" style="text-align:center;padding-top:16px">
        <div class="c-old dim" style="font-size:10px">左边是终端，右边是一块无限画布</div>
        <div class="c-new" style="font-size:12px;font-weight:600;margin-top:4px">一句话，交给 AI。</div></div>
    </div>''', '3 / 5')))

# ── 多媒体预览：四种文件节点同框，Frame 标题栏显示 n/5（照 MediaDraw）
SC['多媒体预览'] = S(4, win('素材', frame(8, 14, 84, 74, '素材', '''
    <div class="node m m1" style="left:3%;top:38px;width:21.5%;height:calc(100% - 50px)">
      <div class="node-h"><b>团子.png</b></div><div class="m-face" style="background:linear-gradient(140deg,#2a2f3d,#59617a)"><span data-dango="idle" data-size="48"></span></div></div>
    <div class="node m m2" style="left:26.5%;top:38px;width:21.5%;height:calc(100% - 50px)">
      <div class="node-h"><b>片头.mp4</b></div><div class="m-face m-video">▶<i class="m-prog"></i></div></div>
    <div class="node m m3" style="left:50%;top:38px;width:21.5%;height:calc(100% - 50px)">
      <div class="node-h"><b>配音.wav</b></div><div class="m-face m-audio"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
    <div class="node m m4" style="left:73.5%;top:38px;width:21.5%;height:calc(100% - 50px)">
      <div class="node-h"><b>heroine.glb</b></div><div class="m-face m-3d">◈</div></div>''', '<span class="m-count">1 / 5</span>')))

# ── @ 引用：候选面板从输入框上方弹出、筛选、变标签（照 AtDraw）
SC['@ 引用上下文'] = S(4, win('eas-demo', frame(16, 12, 68, 78, 'eas-demo', '''
    <div class="node" style="left:5%;top:38px;width:90%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b><span class="rt">Codex · medium</span></div>
      <div class="node-b" style="position:relative;height:calc(100% - 28px)">
        <div class="pop at-pop">
          <div class="at-tabs"><span class="on">文件</span><span>文件夹</span><span>技能</span><span>插件</span><span>标签页</span></div>
          <div class="at-row a1"><span class="mono" style="color:var(--path)">src/</span> main.ts</div>
          <div class="at-row a2"><span class="mono" style="color:var(--path)">docs/</span> plan.md</div>
          <div class="at-row a3 hit"><span class="mono" style="color:var(--path)">out/</span> report.html</div>
        </div>
        <div class="inp at-inp"><span class="at-at">@</span><span class="at-typed"></span><span class="at-chip">report.html</span><span class="at-tail">，照它回答</span><i class="at-car"></i></div>
      </div>
    </div>''')))

# ── 创作参考：右侧抽屉里的词条墙 → 注入输入框 → 效果跑出来（照 DictDraw）
SC['创作参考'] = S(5, win('Aurora 官网', frame(8, 12, 84, 78, 'Aurora 官网', '''
    <div class="node" style="left:3%;top:38px;width:52%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="inp d-inp"><span class="d-chip">代码雨 · 本次引用</span><span class="d-txt"></span></div>
        <div class="d-rain"><canvas data-rain></canvas></div></div>
    </div>
    <div class="node d-drawer" style="left:57%;top:38px;width:40%;height:calc(100% - 50px)">
      <div class="node-h"><b>创作参考</b><span class="rt">前端 · 视觉</span></div>
      <div class="node-b"><div class="inp d-search mono" style="font-size:10px">搜索 <span class="d-typed"></span></div>
        <div class="d-card w1">噪点纹理<span class="mono">fx-Noise</span></div>
        <div class="d-card w2 hit">代码雨<span class="mono">fx-LetterGlitch</span></div>
        <div class="d-card w3">扫描线<span class="mono">fx-Scanline</span></div></div>
    </div>''')))

# ── 执行清单：PlanCard 停靠在对话模块右侧（右 10、离顶 54、宽 260）照 ExecDraw
SC['执行清单'] = S(5, win('eas-demo', frame(6, 12, 62, 78, 'eas-demo', '''
    <div class="node" style="left:5%;top:38px;width:90%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b><span class="rt">Codex · medium</span></div>
      <div class="node-b"><div class="bub e-ask">把这周的构建情况整理成一份汇报页</div>
        <div class="e-busy dim"><span data-dango="run" data-size="24"></span>正在处理…</div>
        <div class="tool e-t1"><em>mcp__execution-plan__plan_create</em></div>
        <div class="tool e-t2"><em>mcp__eas-term__canvas_publish_report</em></div>
        <div class="e-reply">汇报页已经放到画布上。</div></div>
    </div>''') + '''
  <div class="dock e-dock">
    <div class="dock-h"><b>整理本周构建汇报</b><span class="n e-n"><span>0/3</span><span>1/3</span><span>2/3</span><span>3/3</span></span><span class="c">‹</span></div>
    <div class="dock-b">
      <div class="dock-s s1"><span class="bx">·</span><span class="lb">读取本周构建记录</span><span class="st">进行中</span></div>
      <div class="dock-s s2"><span class="bx">·</span><span class="lb">汇总通过率与耗时</span><span class="st">待办</span></div>
      <div class="dock-s s3"><span class="bx">·</span><span class="lb">生成汇报页并放到画布</span><span class="st">待办</span></div>
      <div class="dock-f e-f1"><span>查看详情</span><span style="color:#b4b4b4">终止本次任务</span></div>
      <div class="dock-f e-f2"><span>已全部完成 · 等待当前轮结束</span></div>
    </div>
  </div>'''))

# ── 插件：右侧抽屉「插件」→ 授权 → 工具行 → 结果窗口（照 PluginDraw）
SC['插件'] = S(5, win('季度报表', frame(8, 12, 84, 78, '季度报表', '''
    <div class="node" style="left:3%;top:38px;width:52%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="bub p-ask">把 Q1–Q3 汇总成一张带公式的表</div>
        <div class="tool p-t1"><em>excel_read</em> 2026-Q.xlsx</div>
        <div class="tool p-t2"><em>excel_calculate</em> → <em>excel_chart</em></div>
        <div class="p-open dim">结果已生成 · 用默认应用打开</div></div>
    </div>
    <div class="node p-drawer" style="left:57%;top:38px;width:40%;height:calc(100% - 50px)">
      <div class="node-h"><b>插件</b><span class="rt">右侧抽屉</span></div>
      <div class="node-b">
        <div class="p-row p1"><b>Excel 表格</b><span class="p-st">安装中…</span></div>
        <div class="p-row p2"><b>授权目录</b><span class="mono" style="color:var(--path);font-size:9px">~/Documents/reports</span></div>
        <div class="p-ok p3">✓ 连接测试通过 · 6 个工具</div>
        <div class="p-sheet p4"><div class="r h"><span></span><span>Q1</span><span>Q2</span><span>Q3</span></div>
          <div class="r"><span class="h">营收</span><span>182</span><span>214</span><span>266</span></div>
          <div class="r"><span class="h">毛利</span><span>47%</span><span>52%</span><span class="fm">=1-D3/D2</span></div></div>
      </div>
    </div>''')))

# ── 多会话并行：三个 Frame 各跑一个项目（照 C1）
SC['多会话并行'] = S(4, win('三个项目', '''
  <div class="frame n-f1" style="left:4%;top:16%;width:29%;height:66%">
    <div class="frame-bar"><span class="pt"></span>Aurora 官网<span class="rt">Claude Code</span></div>
    <div class="node" style="left:8%;top:36px;width:84%;height:calc(100% - 48px)"><div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="n-run"><span data-dango="run" data-size="24"></span>正在处理…</div></div></div>
  </div>
  <div class="frame n-f2" style="left:35.5%;top:16%;width:29%;height:66%">
    <div class="frame-bar"><span class="pt"></span>Eas-Term<span class="rt">Codex</span></div>
    <div class="node" style="left:8%;top:36px;width:84%;height:calc(100% - 48px)"><div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="n-run"><span data-dango="run" data-size="24"></span>正在处理…</div></div></div>
  </div>
  <div class="frame n-f3" style="left:67%;top:16%;width:29%;height:66%">
    <div class="frame-bar"><span class="pt"></span>笔纵画板<span class="rt">原生 Harness</span></div>
    <div class="node" style="left:8%;top:36px;width:84%;height:calc(100% - 48px)"><div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="n-run"><span data-dango="run" data-size="24"></span>正在处理…</div></div></div>
  </div>'''))

# ── 团队面板：确认弹窗 → 团队面板节点（照 TeamDraw）
SC['团队面板'] = S(5, win('官网改版', frame(10, 12, 80, 78, '官网改版', '''
    <div class="node" style="left:4%;top:38px;width:50%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="bub t-ask">拉三个人：出封面、写文案、最后收口</div>
        <div class="tool t-t1"><em>mcp__eas-term__team_spawn</em></div>
        <div class="t-sum">三份交付都汇总回来了。</div></div>
    </div>
    <div class="node t-panel" style="left:56%;top:38px;width:40%;height:calc(100% - 50px)">
      <div class="node-h"><b>团队</b><span class="rt">3 人</span></div>
      <div class="node-b">
        <div class="t-row t1"><u>D</u>designer<em><span data-dango="run" data-size="24"></span>在跑</em></div>
        <div class="t-row t2"><u>W</u>writer<em><span data-dango="run" data-size="24"></span>在跑</em></div>
        <div class="t-row t3"><u>R</u>reviewer<em class="fin"><span data-dango="done" data-size="24"></span>这轮完了</em></div>
      </div>
    </div>''') + '''
  <div class="pop t-confirm">
    <div style="font-size:11px;font-weight:600;margin-bottom:6px">要开 3 个 agent</div>
    <div class="dim" style="font-size:10px;margin-bottom:9px">designer · writer · reviewer<br>预估用量 ~18k tokens</div>
    <span class="btn-a">开工</span> <span class="btn-g">再想想</span>
  </div>'''))

# ── 密钥柜：请求弹窗（照 SecretDraw 的文案）
SC['密钥柜'] = S(5, win('Aurora 官网', frame(12, 12, 76, 78, 'Aurora 官网', '''
    <div class="node" style="left:4%;top:38px;width:92%;height:calc(100% - 50px)">
      <div class="node-h"><span class="spark">✦</span><b>AI 对话</b></div>
      <div class="node-b"><div class="bub k-ask">把本周构建汇报发到团队邮箱</div>
        <div class="tool k-t1"><em>mcp__eas-term__request_secret</em></div>
        <div class="k-ret">已保存 · <span class="mono">saved: true · RESEND_API_KEY</span></div></div>
    </div>''') + '''
  <div class="pop k-pop">
    <div class="k-ph">需要一个密钥才能继续</div>
    <div class="k-kv k1"><b>请求来自</b>Aurora · 本地 agent</div>
    <div class="k-kv k2"><b>服务</b>Resend</div>
    <div class="k-kv k3"><b>用途</b>把本周构建汇报发到团队邮箱</div>
    <div class="k-kv k4"><b>变量</b><span class="mono">RESEND_API_KEY</span></div>
    <div class="inp k-in mono">re_••••••••••••••••</div>
    <div class="k-act"><span class="btn-a">保存并授权当前会话</span><span class="btn-g">拒绝</span></div>
  </div>
  <div class="k-map">
    <span class="k-n">你</span><i>→</i><span class="k-n v">密钥柜<em>本机加密</em></span><i>→</i><span class="k-n">程序</span>
    <b>值到不了 AI</b>
  </div>'''))

# ── 看板：模式切换 → 看板四列（照 S16Board 的真实列与卡片）
SC['看板'] = S(4, win('全部项目', '''
  <div class="bd">
    <div class="b-col"><h6><i style="background:var(--warn)"></i>待执行<span class="b-n">2</span></h6>
      <div class="b-card"><b>Tidal 接口文档</b></div>
      <div class="b-card"><b>Lumen 设计稿</b><span class="b-sub">AI 对话 1</span></div></div>
    <div class="b-col"><h6><i style="background:var(--blue)"></i>进行中<span class="b-n tick"><span>3</span><span>2</span></span></h6>
      <div class="b-card b-move"><b>Aurora 官网</b><span class="b-sub">整理本周构建汇报</span><em class="b-pill">在跑</em></div>
      <div class="b-card"><b>Nebula 小程序</b><span class="b-sub">修登录页的跳转</span><em class="b-pill need">等处理</em></div></div>
    <div class="b-col b-drop"><h6><i style="background:var(--danger)"></i>已完结<span class="b-n tick"><span>1</span><span>2</span></span></h6>
      <div class="b-card"><b>Pixel 周报工具</b><span class="b-sub">npm test</span></div></div>
  </div>''', '看板'))

# ── 甘特图（照 S17Gantt：时间条 + 阶段 + git 菱形，只留 7 天）
SC['甘特图'] = S(4, win('全部项目', '''
  <div class="gt">
    <div class="g-head mono"><span>09-23</span><span>09-25</span><span>09-27</span><span>09-29</span></div>
    <div class="g-row"><span class="g-lb">Aurora 官网</span><i class="g-bar gb1" style="--x:4%;--w:62%;--c:var(--blue)"></i></div>
    <div class="g-row"><span class="g-lb">Eas-Term</span><i class="g-bar gb2" style="--x:18%;--w:54%;--c:#7dc5b7"></i></div>
    <div class="g-row"><span class="g-lb">笔纵画板</span><i class="g-bar gb3" style="--x:36%;--w:40%;--c:#b9a4e3"></i></div>
    <div class="g-row g-mile"><span class="g-lb dim">里程碑</span>
      <i class="g-dia m1" style="--x:26%"></i><i class="g-dia m2" style="--x:52%"></i><i class="g-dia m3 big" style="--x:71%"></i>
      <span class="g-tip mono">v0.4.119</span></div>
    <div class="g-foot dim">只保留 7 天</div>
  </div>''', '甘特图'))

# ── 用量（照 S18Usage + UsageDashboard 的真实标题）
SC['用量与花费'] = S(4, win('用量', '''
  <div class="node u-quota" style="right:14px;top:42px;width:200px;height:auto;border-radius:12px">
    <div class="node-b" style="padding:8px 10px">
      <div class="u-qh"><span>Codex</span><em class="u-pct">88%</em></div>
      <div class="u-bar"><i></i></div>
      <div class="dim mono" style="font-size:9px;margin-top:4px">5 小时后重置</div>
    </div>
  </div>
  <div class="node u-dash" style="left:5%;top:42px;width:62%;height:calc(100% - 78px)">
    <div class="node-h"><b>用量仪表盘</b><span class="rt">USAGE OVERVIEW</span></div>
    <div class="node-b">
      <div class="u-tabs"><span class="on">今天</span><span>近 7 天</span><span>近 30 天</span></div>
      <div class="dim" style="font-size:10px;margin:8px 0 4px">整体用量趋势</div>
      <div class="u-spark"><i style="--h:30%"></i><i style="--h:56%"></i><i style="--h:42%"></i><i style="--h:78%"></i><i style="--h:64%"></i><i style="--h:92%"></i><i style="--h:70%"></i></div>
      <div class="dim" style="font-size:10px;margin:9px 0 4px">消耗分布</div>
      <div class="u-li"><span>Eas-Term</span><b class="mono">41%</b></div>
      <div class="u-li"><span>Aurora</span><b class="mono">27%</b></div>
    </div>
  </div>''', '画布'))

# ── 周报小票（纸色墨色照 receiptReport.ts）
SC['周报'] = S(4, win('用量 · 周报', '''
  <div class="rc">
    <div class="rc-printer"></div>
    <div class="rc-paper">
      <div class="rc-brand">E A S &ndash; T E R M</div>
      <div class="rc-sub">OUTCOME RECEIPT</div>
      <div class="rc-hr"></div>
      <div class="rc-t">本周用量小票</div>
      <div class="rc-l"><span>活跃天数</span><span>6 天</span></div>
      <div class="rc-l"><span>会话数</span><span>41</span></div>
      <div class="rc-l"><span>输入</span><span>1,284,902</span></div>
      <div class="rc-l"><span>输出</span><span>186,430</span></div>
      <div class="rc-l rc-dim"><span>缓存读取</span><span>已含在输入</span></div>
      <div class="rc-hr"></div>
      <div class="rc-t">用量前三</div>
      <div class="rc-l"><span>Eas-Term</span><span>41%</span></div>
      <div class="rc-l"><span>Aurora</span><span>27%</span></div>
      <div class="rc-l"><span>笔纵画板</span><span>19%</span></div>
      <div class="rc-hr"></div>
      <div class="rc-foot">HIGHLIGHTS / 成果精选</div>
    </div>
  </div>''', '画布'))

# ── 知识库（照 WikiDraw：收件箱 → 归档计划 → 图谱）
SC['知识库'] = S(5, win('知识库', frame(8, 12, 84, 78, 'eas-wiki', '''
    <div class="node w-inbox" style="left:3%;top:38px;width:36%;height:calc(100% - 50px)">
      <div class="node-h"><b>收件箱</b><span class="rt">3</span></div>
      <div class="node-b"><div class="w-f f1">访谈-0927.m4a</div><div class="w-f f2">会议纪要.md</div><div class="w-f f3">参考链接.txt</div></div>
    </div>
    <div class="node w-graph" style="left:42%;top:38px;width:55%;height:calc(100% - 50px)">
      <div class="node-h"><b>知识图谱</b><span class="rt w-stat">18 篇 · 46 双链</span></div>
      <div class="node-b" style="height:calc(100% - 28px);position:relative">
        <svg class="w-svg" viewBox="0 0 260 110" preserveAspectRatio="xMidYMid meet">
          <line class="gl gl1" x1="44" y1="66" x2="130" y2="40"/><line class="gl gl2" x1="130" y1="40" x2="214" y2="72"/>
          <line class="gl gl3" x1="130" y1="40" x2="102" y2="94"/>
          <circle class="gn" cx="44" cy="66" r="5"/><circle class="gn big" cx="130" cy="40" r="9"/>
          <circle class="gn" cx="214" cy="72" r="5"/><circle class="gn" cx="102" cy="94" r="4"/>
        </svg>
      </div>
    </div>''') + '''
  <div class="pop w-plan">
    <div class="w-ph">归档计划 · 你来勾选</div>
    <div class="w-p"><i>✓</i>移到 sources/2026-09/</div>
    <div class="w-p"><i>✓</i>关联一篇人物笔记</div>
    <div class="w-p"><i>✓</i>建立双链</div>
    <span class="btn-a" style="margin-top:8px">确认这 3 条</span>
  </div>'''))
