#!/usr/bin/env python3
"""扫描 CSS，提取 (上下文, 选择器) -> [出现位置 + 声明的属性]"""
import re, sys, os, json
from collections import defaultdict

def strip_comments(text):
    # 保留换行以维持行号
    out = []
    i = 0
    n = len(text)
    while i < n:
        if text[i:i+2] == '/*':
            j = text.find('*/', i+2)
            if j == -1:
                j = n
            else:
                j += 2
            out.append(''.join(c if c == '\n' else ' ' for c in text[i:j]))
            i = j
        else:
            out.append(text[i])
            i += 1
    return ''.join(out)

def parse(path):
    raw = open(path, encoding='utf-8').read()
    text = strip_comments(raw)
    rules = []          # (context_stack, selector_text, line, props)
    stack = []          # at-rule 上下文
    buf = []
    line = 1
    buf_start_line = 1
    i = 0
    n = len(text)
    in_str = None
    while i < n:
        c = text[i]
        if in_str:
            if c == '\\':
                if c == '\n': line += 1
                i += 2
                continue
            if c == in_str:
                in_str = None
            if c == '\n': line += 1
            buf.append(c); i += 1; continue
        if c in '"\'':
            in_str = c
            buf.append(c); i += 1; continue
        if c == '\n':
            line += 1
            buf.append(c); i += 1
            if not ''.join(buf).strip():
                buf = []
                buf_start_line = line
            continue
        if c == '{':
            prelude = ''.join(buf).strip()
            buf = []
            # 计算 prelude 的起始行
            pl_start = buf_start_line
            if prelude.startswith('@'):
                stack.append((prelude, pl_start))
                i += 1
                buf_start_line = line
                continue
            # 普通规则：读取到匹配的 }
            depth = 1
            j = i + 1
            body_start = j
            bl = line
            s2 = None
            while j < n and depth > 0:
                ch = text[j]
                if s2:
                    if ch == '\\': j += 2; continue
                    if ch == s2: s2 = None
                elif ch in '"\'':
                    s2 = ch
                elif ch == '{': depth += 1
                elif ch == '}': depth -= 1
                if ch == '\n': bl += 1
                j += 1
            body = text[body_start:j-1]
            ctx = [s[0] for s in stack]
            rules.append({
                'file': path, 'line': pl_start, 'ctx': ctx,
                'selector': re.sub(r'\s+', ' ', prelude),
                'body': body,
            })
            i = j
            line = bl
            buf_start_line = line
            continue
        if c == '}':
            if stack: stack.pop()
            buf = []
            i += 1
            buf_start_line = line
            continue
        if c == ';' and not ''.join(buf).strip().startswith('@'):
            buf = []
            i += 1
            buf_start_line = line
            continue
        if c == ';':
            buf = []
            i += 1
            buf_start_line = line
            continue
        if not ''.join(buf).strip() and c.strip() == '':
            buf = []
            buf_start_line = line
            i += 1
            continue
        buf.append(c); i += 1
    return rules

PROP_RE = re.compile(r'(^|[;{}])\s*(--?[\w-]+|[\w-]+)\s*:', re.M)

def props_of(body):
    # 只取顶层声明（去掉嵌套块）
    top = []
    depth = 0
    cur = []
    s = None
    k = 0
    while k < len(body):
        ch = body[k]
        if s:
            if ch == '\\': cur.append(body[k:k+2]); k += 2; continue
            if ch == s: s = None
            cur.append(ch); k += 1; continue
        if ch in '"\'':
            s = ch; cur.append(ch); k += 1; continue
        if ch == '{':
            depth += 1
            if depth == 1:
                cur = []   # 丢掉嵌套块的 prelude
                k += 1; continue
        elif ch == '}':
            depth -= 1
            k += 1
            cur = []
            continue
        if depth == 0:
            cur.append(ch)
        k += 1
    decl_text = ''.join(cur)
    props = []
    for part in decl_text.split(';'):
        if ':' in part:
            p = part.split(':', 1)[0].strip()
            if p and not p.startswith('@') and re.match(r'^-?-?[a-zA-Z][\w-]*$', p):
                props.append(p.lower())
    return props

def norm_sel(s):
    s = re.sub(r'\s*([>+~,])\s*', r'\1', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

files = sys.argv[1:]
entries = []
for f in files:
    for r in parse(f):
        ctx = ' | '.join(r['ctx'])
        for sel in r['selector'].split(','):
            sel = norm_sel(sel)
            if not sel: continue
            entries.append({
                'file': r['file'], 'line': r['line'], 'ctx': ctx,
                'sel': sel, 'props': props_of(r['body']),
            })
json.dump(entries, open('.plans/ui-reviewer/entries.json','w'), ensure_ascii=False)
print(f"共解析 {len(entries)} 条选择器记录，来自 {len(files)} 个文件")
