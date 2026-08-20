#!/usr/bin/env python3
"""找「同一 (上下文, 选择器) 出现多次且属性有重叠」的重复定义。
重点看这一轮改动碰过的文件 / 选择器。"""
import json
from collections import defaultdict
E = json.load(open('.plans/ui-reviewer/entries.json'))
g = defaultdict(list)
for e in E:
    g[(e['ctx'], e['sel'])].append(e)

dups = []
for k, v in g.items():
    if len(v) < 2: continue
    # 属性有交集才算真重复（否则是补充声明）
    for i in range(len(v)):
        for j in range(i+1, len(v)):
            ov = set(v[i]['props']) & set(v[j]['props'])
            if ov:
                dups.append((k, v[i], v[j], sorted(ov)))
print(f"重叠属性的重复定义共 {len(dups)} 对\n")
FOCUS = ('fp-', 'on-accent')
for k, a, b, ov in sorted(dups, key=lambda d: (d[1]['file'], d[1]['line'])):
    tag = '  <<< 本轮范围' if any(f in k[1] for f in FOCUS) else ''
    print(f"[{k[0] or 'top'}] {k[1]}{tag}")
    print(f"    {a['file']}:{a['line']}  ↔  {b['file']}:{b['line']}   重叠属性: {ov}")
