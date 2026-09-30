# -*- coding: utf-8 -*-
"""把每个演示装进真实的应用窗口外壳里。

外壳（顶栏 / 点阵画布 / 侧边标签 / 底部工具条 / 版本号）照
promo 分支 film9/Onboard.tsx 第 114 行起那段「应用外壳」重画。
"""

def win(proj, inner, mode='画布'):
    return f'''<div class="win">
  <div class="win-bar"><span class="dots"><i></i><i></i><i></i></span><span class="proj">{proj}</span><span class="mode">{mode} ▾</span></div>
  <span class="win-tab l">文件信息</span><span class="win-tab r">更多</span>
{inner}
  <span class="win-ico">◳</span>
  <div class="win-dock a"><i>➤</i><span>终端</span><span>画布</span></div>
  <div class="win-dock b"><span>100%</span><span>适应</span></div>
  <div class="win-ver">v0.4.119</div>
</div>'''

def frame(x, y, w, h, title, body, rt='', cls=''):
    return f'''  <div class="frame {cls}" style="left:{x}%;top:{y}%;width:{w}%;height:{h}%">
    <div class="frame-bar"><span class="pt"></span>{title}<span class="rt">{rt}</span></div>
    {body}
  </div>'''

def node(x, y, w, h, head, body, cls='', style=''):
    return f'''    <div class="node {cls}" style="left:{x}px;top:{y}px;width:{w};height:{h};{style}">
      <div class="node-h">{head}</div>
      <div class="node-b">{body}</div>
    </div>'''
