#!/usr/bin/env python3
"""
eas.biily.top 数据聚合：解析 nginx 日志 → 生成看板用的 stats.json。
cron 每 10 分钟跑一次，跑完即退，**不常驻任何进程**。

两个数据源，各管各的：
  · 埋点日志 /www/wwwlogs/eas-events.log —— PV/UV、页面、停留、点击、来源
  · 访问日志 /www/wwwlogs/eas.log        —— **真实下载次数**

下载数为什么不用埋点算：点了按钮不等于下完了，中途取消、断流、重复点都会虚高。
访问日志里 /download/vX.Y.Z/xxx 的请求是服务器真的把字节发出去了，这个数才作数。
（206 断点续传会被算成一次下载的多段，所以按 IP+文件+小时去重。）

隐私前提（改这个脚本时别破坏，隐私页里逐条写着）：
  · 埋点里没有任何持久用户标识，UV 靠「当天的 IP+UA 哈希」现算，隔天就对不上
  · 落盘的 stats.json 里**不含任何 IP、UA 原文**，只有聚合后的计数
  · 原始日志由 logrotate 保留 90 天后删除

服务器环境注意：Python 是 3.6.8 —— 没有 datetime.fromisoformat，也别用 f-string 的
`=` 语法和 dict 的 `|` 合并。
"""
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote

# 路径可用环境变量覆盖，好让这个脚本能在本地拿假日志跑一遍再上服务器
# （服务器 Python 3.6、日志格式、时区都容易出意外，在线上试错代价太高）
EVENTS_LOG = os.environ.get("EAS_EVENTS_LOG", "/www/wwwlogs/eas-events.log")
ACCESS_LOG = os.environ.get("EAS_ACCESS_LOG", "/www/wwwlogs/eas.log")
OUT = os.environ.get("EAS_STATS_OUT", "/www/wwwroot/eas-dash/dashboard/stats.json")
TZ = timezone(timedelta(hours=8))
TREND_DAYS = 30

# 明显的扫描器/爬虫，不计入统计。宁可漏掉几个真人，也不要让扫描器把曲线顶起来
BOT = re.compile(
    r"bot|spider|crawl|curl|wget|python-requests|scanner|censys|zgrab|headless|monitor|uptime",
    re.I,
)

# 下载文件名 → 平台。发布脚本产出的命名是固定的，跟着它走
PLATFORM = [
    # 0.3.2 之前 mac 发的是不分架构的 universal 包，历史下载里还有这个命名
    (re.compile(r"universal\.(dmg|zip)$", re.I), "macOS · 通用包（旧）"),
    (re.compile(r"arm64\.dmg$", re.I), "macOS · Apple 芯片"),
    (re.compile(r"x64\.dmg$", re.I), "macOS · Intel"),
    (re.compile(r"arm64\.zip$", re.I), "macOS · Apple 芯片 (zip)"),
    (re.compile(r"x64\.zip$", re.I), "macOS · Intel (zip)"),
    (re.compile(r"setup\.exe$", re.I), "Windows"),
]

PAGE_NAME = {
    "/": "首页",
    "/index.html": "首页",
    "/download.html": "下载页",
    "/privacy.html": "隐私与数据",
}


def parse_iso(s):
    """手工解析 2026-08-03T09:36:33+08:00。服务器 Python 3.6 没有 fromisoformat。"""
    try:
        dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        off = s[19:]
        if off and off[0] in "+-":
            h, m = int(off[1:3]), int(off[4:6])
            delta = timedelta(hours=h, minutes=m)
            tz = timezone(delta if off[0] == "+" else -delta)
        else:
            tz = TZ
        return dt.replace(tzinfo=tz)
    except (ValueError, IndexError):
        return None


def day_key(dt):
    return dt.astimezone(TZ).strftime("%Y-%m-%d")


def visitor_id(day, ip, ua):
    """当天的匿名访客标识：只用于同一天内去重，**跨天必然不同**（day 参与哈希）。
    不落盘、不回传，stats.json 里只有基于它算出来的计数。"""
    return hashlib.sha1((day + "|" + ip + "|" + ua).encode("utf-8", "replace")).hexdigest()[:16]


def read_lines(path):
    if not os.path.exists(path):
        return
    # errors="replace"：日志里可能有乱码/半个多字节字符，不能因为一行坏掉整个统计
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if line:
                yield line


def load_events():
    """埋点日志。格式：$time_iso8601|$remote_addr|$args|$http_user_agent"""
    out = []
    for line in read_lines(EVENTS_LOG):
        parts = line.split("|", 3)
        if len(parts) < 3:
            continue
        ts, ip, args = parts[0], parts[1], parts[2]
        ua = parts[3] if len(parts) > 3 else ""
        if BOT.search(ua):
            continue
        dt = parse_iso(ts)
        if not dt:
            continue
        q = parse_qs(args)

        def one(k, default=""):
            v = q.get(k, [default])
            return v[0] if v else default

        out.append(
            {
                "dt": dt,
                "day": day_key(dt),
                "vid": visitor_id(day_key(dt), ip, ua),
                "t": one("t"),
                "p": unquote(one("p", "/")),
                "k": one("k"),
                "r": one("r"),
                "d": one("d"),
                "s": one("s"),
                "sec": one("sec", "0"),
                # 下面几个只有桌面应用会带（t=app）：事件种类、版本、系统、架构、功能计数
                "e": one("e"),
                "v": one("v"),
                "os": one("os"),
                "arch": one("arch"),
                "f": one("f"),
            }
        )
    return out


ACCESS_RE = re.compile(
    r'^(\S+) - \S+ \[([^\]]+)\] "(\w+) ([^"\s]+)[^"]*" (\d{3}) (\d+) "([^"]*)" "([^"]*)"'
)


def parse_access_time(s):
    """nginx 默认 access 日志的时间：03/Aug/2026:22:30:01 +0800"""
    try:
        dt = datetime.strptime(s[:20], "%d/%b/%Y:%H:%M:%S")
        off = s[21:26]
        if off and off[0] in "+-":
            h, m = int(off[1:3]), int(off[3:5])
            delta = timedelta(hours=h, minutes=m)
            return dt.replace(tzinfo=timezone(delta if off[0] == "+" else -delta))
        return dt.replace(tzinfo=TZ)
    except (ValueError, IndexError):
        return None


def load_downloads():
    """从访问日志里数真实下载。只认 200/206，且按「IP+文件+小时」去重，
    否则一次断点续传会被算成十几次下载。"""
    seen = set()
    rows = []
    for line in read_lines(ACCESS_LOG):
        m = ACCESS_RE.match(line)
        if not m:
            continue
        ip, tstr, _method, path, status, _size, _ref, ua = m.groups()
        if status not in ("200", "206"):
            continue
        if BOT.search(ua):
            continue
        if "/download/" not in path:
            continue
        fname = unquote(path.rsplit("/", 1)[-1])
        if not re.search(r"\.(dmg|zip|exe)$", fname, re.I):
            continue
        dt = parse_access_time(tstr)
        if not dt:
            continue
        key = ip + "|" + fname + "|" + dt.astimezone(TZ).strftime("%Y-%m-%d-%H")
        if key in seen:
            continue
        seen.add(key)
        ver = ""
        vm = re.search(r"/download/v([\d.]+)/", path)
        if vm:
            ver = vm.group(1)
        plat = "其他"
        for rx, name in PLATFORM:
            if rx.search(fname):
                plat = name
                break
        rows.append({"day": day_key(dt), "file": fname, "ver": ver, "plat": plat})
    return rows


def top(counter, n=10, key_name="k"):
    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
    return [{key_name: k, "n": v} for k, v in items]


def main():
    events = load_events()
    downloads = load_downloads()
    now = datetime.now(TZ)
    today = now.strftime("%Y-%m-%d")

    days = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(TREND_DAYS - 1, -1, -1)]
    day_set = set(days)

    pv_by_day = defaultdict(int)
    uv_by_day = defaultdict(set)
    dl_by_day = defaultdict(int)
    pages = defaultdict(int)
    page_uv = defaultdict(set)
    refs = defaultdict(int)
    devices = defaultdict(int)
    clicks = defaultdict(int)
    sessions = set()
    stay_total = 0
    stay_n = 0
    all_vids = set()

    # ── 桌面应用（t=app）──
    # 和网页统计分开算：两者的「访客」不是一回事，混在一起会让两边的数都失真。
    # 同样没有客户端 ID，日活按当日 IP+UA 哈希估，隔天对不上（见 telemetry.ts 的取舍说明）。
    app_active = defaultdict(set)
    app_sec = defaultdict(int)
    app_starts = 0
    app_ver = defaultdict(int)
    app_os = defaultdict(int)
    app_feat = defaultdict(int)

    for e in events:
        d = e["day"]
        if e["t"] == "pv":
            pv_by_day[d] += 1
            uv_by_day[d].add(e["vid"])
            all_vids.add(e["vid"])
            name = PAGE_NAME.get(e["p"], e["p"])
            pages[name] += 1
            page_uv[name].add(e["vid"])
            if e["r"]:
                refs["直接访问" if e["r"] == "direct" else ("站内" if e["r"] == "internal" else e["r"])] += 1
            if e["d"]:
                devices[e["d"]] += 1
            if e["s"]:
                sessions.add(d + "|" + e["s"])
        elif e["t"] == "click" and e["k"]:
            clicks[e["k"]] += 1
        elif e["t"] == "stay":
            try:
                sec = int(e["sec"])
            except ValueError:
                sec = 0
            if 0 < sec < 3600:
                stay_total += sec
                stay_n += 1
        elif e["t"] == "app":
            app_active[d].add(e["vid"])
            if e["e"] == "start":
                app_starts += 1
                if e["v"]:
                    app_ver[e["v"]] += 1
                if e["os"]:
                    app_os[e["os"]] += 1
            try:
                sec = int(e["sec"] or 0)
            except ValueError:
                sec = 0
            # 上限 24 小时：心跳是 5 分钟一次、退出补一次，正常绝不会超。
            # 超了多半是机器改过时间或日志错位，计进去会把「总时长」顶到离谱的数
            if 0 < sec < 86400:
                app_sec[d] += sec
            for part in (e["f"] or "").split(","):
                if ":" in part:
                    fk, fn = part.split(":", 1)
                    if fn.isdigit():
                        app_feat[fk] += int(fn)

    for r in downloads:
        dl_by_day[r["day"]] += 1

    def uv_in(days_back):
        s = set()
        for i in range(days_back):
            k = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            s |= uv_by_day.get(k, set())
        return len(s)

    dl_files = defaultdict(int)
    dl_plat = defaultdict(int)
    dl_ver = defaultdict(int)
    for r in downloads:
        dl_files[r["file"]] += 1
        dl_plat[r["plat"]] += 1
        if r["ver"]:
            dl_ver[r["ver"]] += 1

    # 漏斗：每一层都用**独立可信的口径**，不互相推算
    visit_uv = len(all_vids)
    dlpage_uv = len(page_uv.get("下载页", set()))
    click_n = sum(v for k, v in clicks.items() if k.startswith("dl-"))
    done_n = len(downloads)

    # 功能计数的中文名。看板上直接显示英文 key 没人看得懂
    FEAT_NAME = {
        "term": "新建终端",
        "canvas": "新建画布节点",
        "voice": "语音输入",
        "image": "贴图片",
        "island": "灵动岛跳转",
        "approve": "灵动岛审批",
        "view": "切换视图",
    }

    stats = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        # 桌面应用。**没有任何数据时整段是零**，看板据此显示「还没有数据」
        # 而不是画一堆空图表 —— 埋点刚上线那几天就是这个状态。
        "app": {
            "todayActive": len(app_active.get(today, set())),
            "starts": app_starts,
            "hoursTotal": round(sum(app_sec.values()) / 3600, 1),
            "todayHours": round(app_sec.get(today, 0) / 3600, 1),
            "trend": [
                {
                    "d": d,
                    "active": len(app_active.get(d, set())),
                    "hours": round(app_sec.get(d, 0) / 3600, 2),
                }
                for d in days
            ],
            "versions": top(app_ver, 8, "k"),
            "os": top(app_os, 5, "k"),
            "features": [
                {"k": FEAT_NAME.get(k, k), "n": v}
                for k, v in sorted(app_feat.items(), key=lambda kv: -kv[1])
            ],
        },
        "totals": {
            "pv": sum(pv_by_day.values()),
            "uv": visit_uv,
            "todayPv": pv_by_day.get(today, 0),
            "todayUv": len(uv_by_day.get(today, set())),
            "dau": uv_in(1),
            "wau": uv_in(7),
            "mau": uv_in(30),
            "sessions": len(sessions),
            "avgStaySec": int(stay_total / stay_n) if stay_n else 0,
            "downloads": len(downloads),
            "todayDownloads": dl_by_day.get(today, 0),
        },
        "trend": [
            {
                "d": d,
                "uv": len(uv_by_day.get(d, set())),
                "pv": pv_by_day.get(d, 0),
                "dl": dl_by_day.get(d, 0),
            }
            for d in days
        ],
        "pages": [
            {"k": k, "pv": v, "uv": len(page_uv.get(k, set()))}
            for k, v in sorted(pages.items(), key=lambda kv: -kv[1])[:10]
        ],
        "referrers": top(refs, 8),
        "devices": top(devices, 6),
        "clicks": top(clicks, 10),
        "downloadFiles": top(dl_files, 10),
        "downloadPlatforms": top(dl_plat, 6),
        "downloadVersions": top(dl_ver, 6),
        "funnel": [
            {"k": "访问官网", "n": visit_uv},
            {"k": "到下载页", "n": dlpage_uv},
            {"k": "点下载按钮", "n": click_n},
            {"k": "真实下载", "n": done_n},
        ],
        "eventCount": len(events),
        "sources": {
            "events": os.path.exists(EVENTS_LOG),
            "access": os.path.exists(ACCESS_LOG),
        },
    }
    # 忽略超出 30 天窗口的老数据，避免 trend 之外的日期悄悄进总数
    stats["totals"]["pvInWindow"] = sum(v for k, v in pv_by_day.items() if k in day_set)

    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))
    # 原子替换：看板随时可能在读这个文件，写一半被读到就是坏 JSON
    os.replace(tmp, OUT)
    try:
        os.chmod(OUT, 0o644)
    except OSError:
        pass
    print("[eas-stats] events=%d downloads=%d -> %s" % (len(events), len(downloads), OUT))


if __name__ == "__main__":
    main()
