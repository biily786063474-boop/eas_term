#!/usr/bin/env python3
"""扫描：所有把 accent 当**背景**用的 CSS 规则，连同同一条规则里的 color 一起列出。
目的是判断「实心底该黑字、淡底该白字」有没有改错或漏改。"""
import re, os, json, sys

ROOT = 'src/renderer/src'
rules = []
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        if not f.endswith('.css'):
            continue
        p = os.path.join(dp, f)
        src = open(p, encoding='utf-8').read()
        # 去注释
        src_nc = re.sub(r'/\*.*?\*/', lambda m: '\n'*m.group(0).count('\n'), src, flags=re.S)
        # 粗暴切规则：selector { decls }  （不处理嵌套，本仓库是原生 CSS）
        line = 1
        pos = 0
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', src_nc):
            sel = m.group(1).strip().split('\n')[-1].strip()
            body = m.group(2)
            ln = src_nc[:m.start(2)].count('\n') + 1
            rules.append(dict(file=p, line=ln, sel=sel, body=body))

ACCENT_BG = re.compile(r'(background(?:-color|-image)?|border-color|box-shadow)\s*:\s*([^;]*)', re.I)

def decls(body):
    out = []
    for d in body.split(';'):
        if ':' in d:
            k, v = d.split(':', 1)
            out.append((k.strip().lower(), v.strip()))
    return out

hits = []
for r in rules:
    ds = decls(r['body'])
    bg = None
    for k, v in ds:
        if k in ('background', 'background-color', 'background-image') and 'accent' in v.lower():
            bg = v
    if not bg:
        continue
    col = None
    for k, v in ds:
        if k == 'color':
            col = v
    hits.append(dict(file=r['file'], line=r['line'], sel=r['sel'], bg=bg, color=col))

# 分类：实心 / 淡底
def classify(bg):
    b = bg.lower()
    # 明确的透明度线索
    ops = [float(x) for x in re.findall(r'rgba\(\s*var\(--accent-rgb\)\s*,\s*([0-9.]+)\s*\)', b)]
    ops += [float(x) for x in re.findall(r'rgba\(\s*162\s*,\s*185\s*,\s*224\s*,\s*([0-9.]+)', b)]
    mix = [float(x) for x in re.findall(r'color-mix\(in srgb,\s*var\(--accent\)\s*([0-9.]+)%', b)]
    if 'accent-soft' in b:
        return 'soft(0.16)'
    if ops:
        m = max(ops)
        return ('solid' if m >= 0.75 else 'soft') + f'({m})'
    if mix:
        m = max(mix)
        return ('solid' if m >= 75 else 'soft') + f'({m}%)'
    if 'linear-gradient' in b or 'radial-gradient' in b:
        return 'gradient'
    if re.search(r'\bvar\(--accent\)', b):
        return 'SOLID'
    return '?'

for h in hits:
    h['kind'] = classify(h['bg'])

hits.sort(key=lambda h: (h['kind'], h['file'], h['line']))
print(f"共 {len(hits)} 条 accent 背景规则\n")
for h in hits:
    flag = ''
    c = (h['color'] or '').lower()
    if h['kind'].startswith(('SOLID', 'solid')):
        if 'on-accent' in c: flag = '  ✅实心-已用on-accent'
        elif c == '': flag = '  ⚠️实心-无color(继承)'
        elif '#fff' in c or 'white' in c or '#ffffff' in c: flag = '  ❌实心-白字'
        else: flag = f'  ?实心-{c}'
    elif h['kind'].startswith(('soft','gradient')):
        if 'on-accent' in c: flag = '  ❌淡底-却用了on-accent'
    print(f"{h['kind']:<14} {h['file']}:{h['line']}  {h['sel'][:60]}\n    bg={h['bg'][:90]}\n    color={h['color']}{flag}")
