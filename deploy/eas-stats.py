#!/usr/bin/env python3
"""
eas.biily.top 数据聚合：解析 nginx 日志 → 生成看板用的 stats.json。
cron 每 10 分钟跑一次，跑完即退，**不常驻任何进程**。

两个数据源，各管各的：
  · 埋点日志 /www/wwwlogs/eas-events.log —— PV/UV、页面、停留、点击、来源
  · 访问日志 /www/wwwlogs/eas.log        —— **真实下载次数**

下载数为什么不用埋点算：点了按钮不等于下完了，中途取消、断流、重复点都会虚高。
访问日志里 /download/vX.Y.Z/xxx 的请求是服务器真的把字节发出去了，这个数才作数。
（206 断点续传会被算成一次下载的多段，所以先按 IP+文件+小时去掉分段；
  对外的下载数再按 IP 去重 —— 报的是**下载人数**，同一个人下几次都算一个。）

隐私前提（改这个脚本时别破坏，隐私页里逐条写着）：
  · 埋点里没有任何持久用户标识，UV 靠「当天的 IP+UA 哈希」现算，隔天就对不上
  · 落盘的 stats.json 里**不含任何 IP、UA 原文**，只有聚合后的计数
  · 原始日志由 logrotate 保留 90 天后删除

服务器环境注意：Python 是 3.6.8 —— 没有 datetime.fromisoformat，也别用 f-string 的
`=` 语法和 dict 的 `|` 合并。
"""
import glob
import gzip
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
# ── 「我自己」的识别 ──────────────────────────────────────────────
# 两条取并集：
#   ① 访问过 /dashboard/ 且拿到 200 的 IP —— 只有我有那个 Basic Auth 口令
#   ② 家宽网段前缀 —— 实测我的 IP 在 116.148.76.x / 116.148.77.x 之间漂移，
#      而只有其中一个进过后台，光靠 ① 会漏掉大半
# ⚠️ 这是**识别自己**，不是识别爬虫池。用网段去判爬虫池是错的
#    （spb-stats.py 的文件头记着那次教训），但用来圈自己家的出口 IP 正合适。
# ⚠️ 只做**单列**不做剔除：完全剔掉就看不出「数据里有多少是自己」了。
#   ③ **行为**：同一个 IP 一天里启动过 ≥3 个不同版本 —— 只有开发者会这么干。
#      2026-09-15 复盘发现：8 月 13–23 日我家宽还是 124.90.240.x，那台机器
#      24 小时挂着、一天跑 7 个版本、2380 条事件，占了「外部」桌面端事件的一半，
#      而 ①② 都抓不到它（访问日志只留 1 份归档、前缀又变了）。
#      按 IP 全天候剔，所以命中一次，这个 IP 在整个窗口内的事件全部归本人。
#      阈值 `EAS_OWNER_VER_CHURN`，反证：设成 999 后 8 月中旬那段 24h/天的曲线要回来。
OWNER_PREFIXES = [x.strip() for x in os.environ.get("EAS_OWNER_IPS", "116.148.").split(",") if x.strip()]
OWNER_VER_CHURN = int(os.environ.get("EAS_OWNER_VER_CHURN", "3"))
_owner_ips = set()


def is_owner(ip):
    return ip in _owner_ips or any(ip.startswith(p) for p in OWNER_PREFIXES)


def scan_owner_ips():
    """先扫一遍访问日志，把进过 /dashboard/ 的 IP 收进来。
    放在所有统计之前跑，这样后面判 mine 时名单已经齐了。"""
    for line in read_lines(ACCESS_LOG):
        m = ACCESS_RE.match(line)
        if not m:
            continue
        ip, _t, _me, path, status, _s, _r, _ua = m.groups()
        if status == "200" and path.startswith("/dashboard/"):
            _owner_ips.add(ip)
    # ③ 版本翻腾：一天启动 ≥ OWNER_VER_CHURN 个不同版本的 IP
    churn = defaultdict(set)
    for line in read_lines(EVENTS_LOG):
        parts = line.split("|", 3)
        if len(parts) < 3 or "t=app" not in parts[2] or "e=start" not in parts[2]:
            continue
        q = parse_qs(parts[2])
        ver = (q.get("v") or [""])[0]
        if ver:
            churn[(parts[0][:10], parts[1])].add(ver)
    for (_day, ip), vers in churn.items():
        if len(vers) >= OWNER_VER_CHURN:
            _owner_ips.add(ip)


# ── 地域（2026-09-13 起）─────────────────────────────────────────
# 用宝塔自带的 GeoLite2（/www/server/panel/config/，2023-09 版，它改造过：字段全塞在
# country 下、中文直出、国内带省市）。**IP 查完即弃，落盘的只有国家 / 省**。
# 粒度定为「中国到省、海外到国家」，不到城市：日活个位数时，
# 「某天某市 1 人 + 版本 + 系统」这一行就是那个人。用户量过百再议。
# 本地没装 maxminddb 或没这个库文件时返回空串，统计照跑、地域那块显示为空。
def _geo_reader():
    try:
        import maxminddb
        return maxminddb.open_database("/www/server/panel/config/GeoLite2-City.mmdb")
    except Exception:
        return None


_GEO = _geo_reader()


def geo_of(ip):
    """IP → (国家, 省份)。海外省份为空串。"""
    if not _GEO:
        return ("", "")
    try:
        d = (_GEO.get(ip) or {}).get("country", {})
        return (d.get("country") or "", d.get("province") or "")
    except Exception:
        return ("", "")


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
    """当前日志 + logrotate 切出来的历史归档，按时间顺序吐行。

    ⚠️ **只读当前那一份是不够的**：logrotate 每天凌晨把日志切成
    `<name>.log-YYYYMMDD.gz` 然后清空当前文件。只读当前文件的话，
    30 天的 trend 里除了今天以外**全是 0** —— 「桌面端使用曲线只剩当天」
    就是这么来的（2026-09-06 修，当时 eas 已经积了 31 个 .gz 归档）。
    归档按文件名排序即时间序（日期戳是定长的），当前文件放最后。
    归档与当前文件的内容不重叠（切完就清空），所以不会重复计数。
    """
    for arc in sorted(glob.glob(path + "-*.gz")):
        try:
            with gzip.open(arc, "rt", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.rstrip("\n")
                    if line:
                        yield line
        except (IOError, OSError, EOFError):
            # 某个归档损坏（切割中断之类）不该让整份统计挂掉，跳过它继续
            continue

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
                "mine": is_owner(ip),
                "geo": geo_of(ip),                       # (国家, 省)，IP 本身不进这个 dict
                "hour": dt.astimezone(TZ).hour,
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
                # 使用龄桶（d1 / d2_3 / d4_7 / d8_30 / d30p）。
                # 客户端本地算好只报桶，服务端拿不到天数、更拿不到 ID
                "age": one("age"),
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
        # 应用内更新走的是**和官网下载完全相同的路径**（latest.json 里就指向 /download/vX/…），
        # 唯一能分开的是 UA：更新请求带 `Eas-Term/x.y.z Electron/…`，官网下载是浏览器 UA
        via = "update" if "Eas-Term/" in ua else "web"
        rows.append({"day": day_key(dt), "file": fname, "ver": ver, "plat": plat, "via": via,
                     "mine": is_owner(ip),
                     "who": hashlib.sha1(ip.encode("utf-8", "replace")).hexdigest()[:16]})
    return rows


def top(counter, n=10, key_name="k"):
    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
    return [{key_name: k, "n": v} for k, v in items]


def main():
    scan_owner_ips()          # 必须最先跑：下面判 mine 要用这份名单
    events = load_events()
    downloads = load_downloads()
    # 一个 IP 无论下几次、下几个文件，都只算一个人
    # ── 下载的三个口径（2026-09-10 拆开）─────────────────────────────
    # 应用内更新和官网下载走的是**同一个 URL**（latest.json 指向 /download/vX/…），
    # 唯一能分开的是 UA：带 Eas-Term/x.y.z Electron/ 的是更新。之前混在一个数里去重，
    # 「下载 26 人」到底几个是新用户、几个是老用户在升级，看不出来。现在三个数各自独立：
    #   web_dl   官网下载 —— 报**去重 IP 数**（同一 IP 下几次、下几个文件都算一人）
    #   upd_dl   应用内更新 —— 报**次数**（每次升级算一次）和**去重 IP 数**（多少人在持续升级）
    # 去重规则：who = sha1(ip)，按 IP。局限：一个人换网络会被算成两人、
    # 一个 IP 后面的多台机器会被算成一人 —— 这是没有客户端 ID 的代价（隐私红线）。
    # 自己的下载都不计入（本人的量单列在 stats["mine"]）。
    web_dl = [r for r in downloads if r.get("via") == "web" and not r.get("mine")]
    upd_dl = [r for r in downloads if r.get("via") == "update" and not r.get("mine")]
    dl_people = {r["who"] for r in web_dl}
    upd_people = {r["who"] for r in upd_dl}
    now = datetime.now(TZ)
    today = now.strftime("%Y-%m-%d")

    days = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(TREND_DAYS - 1, -1, -1)]
    day_set = set(days)

    pv_by_day = defaultdict(int)
    uv_by_day = defaultdict(set)
    dl_by_day = defaultdict(set)
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
        # ⚠️ **网站侧的日活剔除我自己**（2026-09-07 起）：官网的 uv/pv/dau 是拿来看
        #    「有多少真实用户」的，自家浏览混进去会把它抬高一大截。
        #    桌面端那侧（t=app）**不剔**，那边要看的是真实使用总量，
        #    自用部分单列在 stats["mine"] 里。
        if e["t"] == "pv" and e.get("mine"):
            continue
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
            # ⚠️ **桌面端也剔除我自己**（2026-09-13 起，用户拍板）。
            #    之前只剔网站侧、桌面端保留全量 —— 结果那条曲线 30 天里 493 小时是本人，
            #    「活跃 1 人 10.7 小时」就是我自己挂着没关的那台。
            #    按 IP 剔，所以这个 IP 下**所有实例**（正式版、开发版、多台机器）一并不算。
            #    本人的量仍单列在 stats["mine"]。
            if e.get("mine"):
                continue
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

    for r in web_dl:          # 趋势只看官网下载，更新走 downloadSplit
        dl_by_day[r["day"]].add(r["who"])

    def uv_in(days_back):
        s = set()
        for i in range(days_back):
            k = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            s |= uv_by_day.get(k, set())
        return len(s)

    dl_files = defaultdict(set)
    dl_plat = defaultdict(set)
    dl_ver = defaultdict(set)
    for r in web_dl:          # 文件/平台/版本分布只看官网下载 —— 更新永远是最新版，混进去没意义
        dl_files[r["file"]].add(r["who"])
        dl_plat[r["plat"]].add(r["who"])
        if r["ver"]:
            dl_ver[r["ver"]].add(r["who"])
    # top() 收的是 {key: 计数}，这里把人集合换算成人数
    dl_files = {k: len(v) for k, v in dl_files.items()}
    dl_plat = {k: len(v) for k, v in dl_plat.items()}
    dl_ver = {k: len(v) for k, v in dl_ver.items()}

    # 漏斗：每一层都用**独立可信的口径**，不互相推算
    visit_uv = len(all_vids)
    dlpage_uv = len(page_uv.get("下载页", set()))
    click_n = sum(v for k, v in clicks.items() if k.startswith("dl-"))
    done_n = len(dl_people)

    # ── 使用龄分布（客户端本地算、只报桶，见 telemetry.ts 文件头）────────
    # 这是在**不引入任何跨天标识符**的前提下能拿到的留存信息：
    # 看得见「今天活跃的人里有几个是老用户」，但认不出具体是谁、也对不上昨天的谁。
    AGE_LABEL = [
        ("d1", "首日"), ("d2_3", "2–3 天"), ("d4_7", "4–7 天"),
        ("d8_30", "8–30 天"), ("d30p", "30 天以上"),
    ]
    age_today, age_window = defaultdict(set), defaultdict(set)
    for e in events:
        if e["t"] != "app" or not e.get("age") or e.get("mine"):
            continue
        age_window[e["age"]].add(e["vid"])
        if e["day"] == today:
            age_today[e["age"]].add(e["vid"])

    def age_rows(src):
        return [{"k": k, "label": lab, "n": len(src.get(k, ()))} for k, lab in AGE_LABEL]

    has_age = bool(age_window)

    # ── 地域 / 时段 / 会话深度（2026-09-13 新增，全部只算外部用户）──────────
    # 地域：网站访客与桌面端用户分开数 —— 一个人可能只逛官网没装，或只用软件没再来官网
    geo_site, geo_app = defaultdict(set), defaultdict(set)
    # 时段：7×24 热力，值是「人-时」（同一人同一小时算一次）。国内用户看 +08:00
    heat_site, heat_app = defaultdict(set), defaultdict(set)
    # 会话深度：网站侧，一个访客当天看了几页
    pages_per_visitor = defaultdict(int)
    for e in events:
        if e.get("mine"):
            continue
        country, prov = e.get("geo") or ("", "")
        # 中国到省、海外到国家；查不到的归「未知」而不是丢掉，否则总数对不上
        region = (country + " · " + prov) if (country == "中国" and prov) else (country or "未知")
        wd = e["dt"].astimezone(TZ).weekday()   # 0=周一
        cell = "%d-%02d" % (wd, e["hour"])
        if e["t"] == "pv":
            geo_site[region].add(e["vid"])
            heat_site[cell].add(e["vid"])
            pages_per_visitor[e["vid"]] += 1
        elif e["t"] == "app":
            geo_app[region].add(e["vid"])
            heat_app[cell].add(e["vid"])

    def geo_rows(src, n=12):
        rows = sorted(((k, len(v)) for k, v in src.items()), key=lambda kv: (-kv[1], kv[0]))
        return [{"k": k, "n": v} for k, v in rows[:n]]

    def heat_rows(src):
        # 168 格全给，前端按 7×24 铺；没数据的格子也要有，否则热力图缺角
        return [{"d": d, "h": h, "n": len(src.get("%d-%02d" % (d, h), ()))}
                for d in range(7) for h in range(24)]

    # 会话深度分桶：看 1 页就走 / 2–3 页 / 4 页以上
    depth = {"1": 0, "2_3": 0, "4p": 0}
    for n in pages_per_visitor.values():
        depth["1" if n <= 1 else "2_3" if n <= 3 else "4p"] += 1

    # ── 其中我自己 ──────────────────────────────────────────────
    # 单列不剔除：主口径保持原样，另给一行「其中我自己」，
    # 这样既看得见真实总量，也一眼知道里面有多少是自家产生的。
    mine_events = [e for e in events if e.get("mine")]
    # ⚠️ 日期字段是 "day"；"d" 是查询参数里的另一个东西（app 事件根本不带），
    #    一开始写成 e["d"]，结果 appDays 恒等于 1
    mine_app_days = {e["day"] for e in mine_events if e["t"] == "app"}
    mine_sec = 0
    for e in mine_events:
        if e["t"] == "app":
            try:
                v = int(e.get("sec") or 0)
            except ValueError:
                v = 0
            if 0 < v <= 3600:
                mine_sec += v
    mine_dl = {r["who"] for r in downloads if r.get("mine")}

    # 下载来源：应用内更新和官网下载路径相同，只能靠 UA 分


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
        # 客户端发版前这里全是 0：老版本不带 age 参数。has=False 时前端提示等发版
        "geo": {
            "site": geo_rows(geo_site),
            "app": geo_rows(geo_app),
            "granularity": "中国到省 · 海外到国家",
        },
        "heat": {
            "site": heat_rows(heat_site),
            "app": heat_rows(heat_app),
        },
        "depth": [
            {"k": "只看 1 页", "n": depth["1"]},
            {"k": "看 2–3 页", "n": depth["2_3"]},
            {"k": "看 4 页以上", "n": depth["4p"]},
        ],
        "retention": {
            "has": has_age,
            "today": age_rows(age_today),
            "window": age_rows(age_window),
        },
        "mine": {
            # 网站侧（pv/uv/dau/下载）已经把这些剔出去了；桌面端那侧没剔，只是单列
            "excludedFromSite": True,
            "excludedFromApp": True,     # 桌面端也剔了（2026-09-13 起）
            "events": len(mine_events),
            "appDays": len(mine_app_days),
            "hours": round(mine_sec / 3600, 1),
            "downloads": len(mine_dl),
            "ips": len(_owner_ips),
        },
        "downloadSplit": {
            "web": len(dl_people),           # 官网下载人数（去重 IP）
            "updateCount": len(upd_dl),      # 应用内更新次数
            "updatePeople": len(upd_people), # 应用内更新人数（去重 IP）
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
            "downloads": len(dl_people),
            "todayDownloads": len(dl_by_day.get(today, ())),
        },
        "trend": [
            {
                "d": d,
                "uv": len(uv_by_day.get(d, set())),
                "pv": pv_by_day.get(d, 0),
                "dl": len(dl_by_day.get(d, ())),
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
