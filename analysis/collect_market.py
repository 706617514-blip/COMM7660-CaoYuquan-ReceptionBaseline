#!/usr/bin/env python3
"""
collect_market.py — Phase 2 市场样本采集，用于「该开发什么类型的游戏」这一决策。

与 Phase 1 的 collect_titles.py 的三点关键差异
==============================================

1. **数据来源变了，因为 Steam 改了接口。**
   2026-11-05 复核：`appreviews` 端点对 JSON 请求返回的是商店页 HTML（约 979 KB），
   不再返回 JSON。`appdetails` 仍然可用。因此评论数据改从**搜索结果的 tooltip** 读取：

       data-tooltip-html="Mostly Negative<br>25% of the 118 user reviews ... are positive."

   这给出全时段的评论数与好评百分比。代价是百分比为整数，好评率精度变成 ±0.5 个百分点；
   Phase 1 用的是精确的 pos/neg 计数。这一差异记入 data/source-access-manifest.md。

2. **不做评论数下限。** Phase 1 用 ≥50 条评论保证好评率的估计精度，这适合研究"口碑"，
   但会系统性地删掉"几乎没人评论"的作品——而那正是判断"这个品类能不能找到受众"的核心信息。
   本脚本默认 min_reviews=0，把零评论作品也收进来，才能测出真实的评论量分布。

3. **按发布日期配额抽样，不做任何按表现的筛选。** 每个（品类 × 季度）格子里取前 N 个
   落在窗口内的候选。因为搜索页按发行日期倒序，这等价于对该时段的作品近似随机抽样，
   不会因为"评论多"或"评分高"而偏倚。

输出：data/raw/market_titles_<stamp>.csv（与 Phase 1 的 raw 文件并列，不覆盖）

用法：
  python3 analysis/collect_market.py --cutoff 2026-11-05 --per-quarter 6
  python3 analysis/collect_market.py --calibrate-only     # 只看深度标定
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "analysis"))

# 复用 Phase 1 采集器的搜索解析与深度标定逻辑（只读导入，不修改它）
from collect_titles import (                                  # noqa: E402
    GENRE_TAGS,
    PAGE_SIZE,
    PROBE_DEPTHS,
    QUARTER_SWEEP_FRACTIONS,
    MAX_SWEEP_OFFSET,
    MIN_SWEEP_STEP,
    depth_for_date,
    depth_per_day,
    observed_dates,
    quarter_bounds,
    quarter_midpoint_date,
    quarter_of,
    quarters_between,
    search_rows,
)

API_APP = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
REQUEST_DELAY = 1.2

ALL_TAGS = ["Action", "Indie", "RPG", "Strategy", "Simulation",
            "Adventure", "Racing", "Sports", "Casual"]


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def details(appid: str) -> dict | None:
    """appdetails 仍然可用；review 数据不从这里取（recommendations.total 只做交叉校验）。"""
    req = urllib.request.Request(API_APP.format(appid=appid), headers={
        "User-Agent": "Mozilla/5.0 (academic-coursework; COMM7660)",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.loads(r.read().decode("utf-8", "replace"))
        if not payload.get(str(appid), {}).get("success"):
            return None
        return payload[str(appid)].get("data")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            log("RATE LIMITED (429). 停止，而不是绕过限制。")
            raise SystemExit(2)
        return None
    except Exception:                                          # noqa: BLE001
        return None
    finally:
        time.sleep(REQUEST_DELAY)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutoff", default="2026-11-05")
    ap.add_argument("--window-months", type=int, default=24)
    ap.add_argument("--per-quarter", type=int, default=6,
                    help="每个（品类 × 季度）格子取多少款")
    ap.add_argument("--max-per-tag", type=int, default=70)
    ap.add_argument("--min-reviews", type=int, default=0,
                    help="默认 0：保留零评论作品，否则无法测出真实评论量分布")
    ap.add_argument("--tags", default=",".join(ALL_TAGS))
    ap.add_argument("--extra-tags", default="",
                    help="补充标签，格式 Name=id,Name=id（如 Roguelite=3959,Farming Sim=87918）。"
                         "用于针对某个具体方向做定向采样，不改动 9 个基础品类。")
    ap.add_argument("--outdir", default="data/raw")
    ap.add_argument("--calibrate-only", action="store_true")
    args = ap.parse_args()

    cutoff = date.fromisoformat(args.cutoff)
    y, m = cutoff.year, cutoff.month - args.window_months
    while m <= 0:
        m += 12
        y -= 1
    window_start = date(y, m, cutoff.day)
    # 定向标签：允许把 Steam 的具体 tag 加进本次采样（不改动 GENRE_TAGS 这个基础定义）
    tagmap = dict(GENRE_TAGS)
    for spec in (args.extra_tags or "").split(","):
        spec = spec.strip()
        if not spec or "=" not in spec:
            continue
        name, _, sid = spec.partition("=")
        try:
            tagmap[name.strip()] = int(sid)
        except ValueError:
            log(f"忽略无法解析的标签: {spec}")
    requested = [t.strip() for t in args.tags.split(",") if t.strip()]
    tags = [t for t in requested if t in tagmap]
    if not tags and tagmap:
        tags = list(tagmap)          # 只给了 --extra-tags 时，就只采这些
    all_q = quarters_between(window_start, cutoff)

    log(f"cutoff={cutoff}  window={window_start}..{cutoff}  quarters={len(all_q)}")
    log(f"tags={len(tags)}  per_quarter={args.per_quarter}  min_reviews={args.min_reviews}")

    outdir = ROOT / args.outdir
    outdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ckpt = outdir / "market_checkpoint.json"

    accepted: dict[str, dict] = {}
    reject: Counter = Counter()
    observed: dict[str, dict] = {}
    seen: set[str] = set()
    done: set[str] = set()
    tooltip_absent = 0        # 无评论汇总的候选数（应记作 0 评论，而非丢弃）
    parse_mismatch = 0        # tooltip 说 0 但 appdetails 说有评论（解析失效信号）

    if ckpt.exists():
        st = json.loads(ckpt.read_text(encoding="utf-8"))
        accepted = st["accepted"]
        reject = Counter(st["reject"])
        observed = st["observed"]
        seen = set(st["seen"])
        done = set(st["done"])
        stamp = st.get("stamp", stamp)
        log(f"续跑：已有 {len(accepted)} 款")

    def save() -> None:
        ckpt.write_text(json.dumps({
            "stamp": stamp, "accepted": accepted, "reject": dict(reject),
            "observed": observed, "seen": sorted(seen), "done": sorted(done),
        }), encoding="utf-8")

    def anchors(tag: str):
        return observed_dates(observed.get(tag, {}))

    def seed(tag: str, tid: int) -> None:
        obs = observed.setdefault(tag, {})
        for d in PROBE_DEPTHS:
            if str(d) in obs:
                continue
            rows, _ = search_rows(tid, d)
            if not rows:
                if d >= 16000:
                    break
                continue
            mid = sorted(r["release_date"] for r in rows)[len(rows) // 2]
            obs[str(d)] = mid.isoformat()
        save()

    def locate(tag: str, tid: int, target: date):
        obs = observed.setdefault(tag, {})
        depth = max(0, (depth_for_date(anchors(tag), target) // PAGE_SIZE) * PAGE_SIZE)
        rows = []
        for _ in range(6):
            rows, _ = search_rows(tid, depth)
            if not rows:
                depth = max(0, depth - 500)
                continue
            mid = sorted(r["release_date"] for r in rows)[len(rows) // 2]
            obs[str(depth)] = mid.isoformat()
            dates = [r["release_date"] for r in rows]
            if min(dates) <= target <= max(dates):
                return depth, rows
            slope = depth_per_day(anchors(tag), target)
            depth = int(depth + (slope * (min(dates) - target).days * 0.8)
                        if target < min(dates)
                        else depth - slope * (target - max(dates)).days * 0.8)
            depth = max(0, (depth // PAGE_SIZE) * PAGE_SIZE)
        return depth, rows

    if args.calibrate_only:
        for tag in tags:
            seed(tag, tagmap[tag])
            a = anchors(tag)
            log(f"  {tag}: {a[0][0]}->{a[0][1]} .. {a[-1][0]}->{a[-1][1]}" if a else f"  {tag}: 无锚点")
        return 0

    for tag in tags:
        tid = tagmap[tag]
        if not observed.get(tag):
            log(f"--- 标定 {tag} ---")
            seed(tag, tid)
        got_tag = sum(1 for r in accepted.values() if r["assigned_tag"] == tag)
        log(f"--- {tag} 已有 {got_tag} ---")

        for q in all_q:
            cell = f"{tag}:{q}"
            if cell in done or got_tag >= args.max_per_tag:
                continue
            target = min(max(quarter_midpoint_date(q), window_start), cutoff)
            base, _ = locate(tag, tid, target)
            qs, qe = quarter_bounds(q)
            half_days = max(1.0, (qe - qs).days / 2.0)
            slope = depth_per_day(anchors(tag), target)
            half_off = int(min(MAX_SWEEP_OFFSET, max(0.0, slope * half_days * 0.95)))
            offsets = []
            for frac in QUARTER_SWEEP_FRACTIONS:
                off = int(round(half_off * abs(frac))) * (1 if frac >= 0 else -1)
                if off and abs(off) < MIN_SWEEP_STEP:
                    off = MIN_SWEEP_STEP * (1 if off > 0 else -1)
                if off not in offsets:
                    offsets.append(off)

            got_q = 0
            for off in offsets:
                if got_q >= args.per_quarter or got_tag >= args.max_per_tag:
                    break
                rows, _ = search_rows(tid, max(0, base + off))
                cands = [r for r in rows
                         if window_start <= r["release_date"] <= cutoff
                         and quarter_of(r["release_date"]) == q
                         and r["appid"] not in seen]
                for r in cands:
                    if got_q >= args.per_quarter or got_tag >= args.max_per_tag:
                        break
                    seen.add(r["appid"])
                    # tooltip 缺失 ≠ 未知：Steam 只在有评论时才渲染这条 tooltip。
                    # 把 None 当成"未知"再丢掉，等于系统性地删掉零评论作品——
                    # 而那正是本次市场分析最需要保留的样本（"大多数游戏没人评论"本身是结论）。
                    rc_raw = r.get("search_review_count")
                    pct = r.get("search_review_pct")
                    rc = 0 if rc_raw is None else int(rc_raw)
                    if rc_raw is None:
                        tooltip_absent += 1
                    if rc < args.min_reviews:
                        reject["below_min_reviews"] += 1
                        continue
                    d = details(r["appid"])
                    if not d or d.get("type") != "game":
                        reject["not_a_game"] += 1
                        continue
                    price = d.get("price_overview") or {}
                    rec_total = (d.get("recommendations") or {}).get("total")
                    accepted[r["appid"]] = {
                        "appid": r["appid"],
                        "name": d.get("name") or r["name"],
                        "assigned_tag": tag,
                        "type": d.get("type"),
                        "release_date": r["release_date"].isoformat(),
                        "release_quarter": q,
                        "is_free": bool(d.get("is_free", False)),
                        "price_initial": price.get("initial"),
                        "price_currency": price.get("currency"),
                        "genres": "|".join(g["description"] for g in d.get("genres", [])),
                        "categories": "|".join(c["description"]
                                               for c in d.get("categories", [])),
                        "developers": "|".join(d.get("developers", [])),
                        "publishers": "|".join(d.get("publishers", [])),
                        # 评论数据来自搜索页 tooltip（全时段）
                        "total_reviews": rc,
                        "review_pct": pct,
                        "recommendations_total": rec_total,
                        "coming_soon": bool((d.get("release_date") or {}).get("coming_soon")),
                        "short_description": (d.get("short_description") or "")[:2000],
                    }
                    # 交叉校验：tooltip 记 0 但 appdetails 的 recommendations.total > 0
                    # 说明 tooltip 解析可能失效，必须记下来而不是静默接受。
                    if rc == 0 and rec_total and rec_total > 0:
                        parse_mismatch += 1
                    got_q += 1
                    got_tag += 1
                    save()
            if got_q >= args.per_quarter:
                done.add(cell)
            save()
            log(f"  {q} 取 {got_q}/{args.per_quarter}（tag 累计 {got_tag}，总 {len(accepted)}）")

    rows_out = sorted(accepted.values(), key=lambda r: r["release_date"])
    out = outdir / f"market_titles_{stamp}.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows_out[0].keys()))
        w.writeheader()
        w.writerows(rows_out)
    ckpt.unlink(missing_ok=True)

    audit = {
        "collected_at_utc": stamp, "cutoff": args.cutoff,
        "window_start": window_start.isoformat(),
        "per_quarter": args.per_quarter, "min_reviews": args.min_reviews,
        "tags": tags, "accepted": len(rows_out),
        "rejections": dict(reject),
        "by_tag": dict(sorted(Counter(r["assigned_tag"] for r in rows_out).items())),
        "review_data_source": "search result tooltip (all-time count + positive %)",
        "zero_review_titles": sum(1 for r in rows_out if r["total_reviews"] == 0),
        "tooltip_absent_candidates": tooltip_absent,
        "tooltip_parse_mismatch": parse_mismatch,
        "outfile": str(out),
    }
    (outdir / f"market_audit_{stamp}.json").write_text(
        json.dumps(audit, indent=2), encoding="utf-8")

    log(f"采集完成：{len(rows_out)} 款 -> {out.name}")
    log(f"  按品类: {audit['by_tag']}")
    log(f"  零评论作品: {audit['zero_review_titles']}"
        f"（其中 tooltip 缺失记作 0 的候选 {tooltip_absent} 个，解析冲突 {parse_mismatch} 个）")
    log(f"  拒绝: {dict(reject)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
