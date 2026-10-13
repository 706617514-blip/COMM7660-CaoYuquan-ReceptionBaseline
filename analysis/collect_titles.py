#!/usr/bin/env python3
"""
collect_titles.py — title-level collection for the COMM7660 Phase 1 analysis.

Permitted sources only (documented Steam endpoints, no key):
  - search/results : index navigation; one row per candidate title
  - appreviews     : https://store.steampowered.com/appreviews/<appid>  (summary block)
  - appdetails     : https://store.steampowered.com/api/appdetails

Why it screens from the search page
-----------------------------------
The search endpoint returns `results_html`, and every result row already carries both
the appid and the release date:

    <a ... data-ds-appid="4361520" data-ds-tagids="[19,21,122,492,599]" ...>
        <span class="title">Pixel Dungeon VR - Mystic Twins Pack</span>
        <div class="search_released responsive_secondrow"> 30 Jan, 2026 </div>

So a single request screens 50 candidates for release date. An earlier version asked
`appdetails` once per candidate to learn that date: ~50 requests to screen 50
candidates, after which most were discarded anyway. Screening from the page is about
50x cheaper per candidate, and it means the review and detail calls are spent only on
candidates already known to be inside the window.

Depth geometry
--------------
Sorted by Released_DESC, page depth maps monotonically to release date, so deep pages
reach older titles. Measured on 2026-10-12 (50 per page), one page covers only one or
two release *days*.

The script therefore does not walk pages linearly. For each (tag, quarter) cell it
seeks the page containing that quarter's midpoint, interpolating a depth from observed
(depth, date) pairs and then correcting by stepping until the page actually brackets
the target date. Every page visited becomes a new calibration point, so the map
improves as collection proceeds rather than depending on a fixed table.

Rate limiting: every request is spaced by REQUEST_DELAY. No concurrency, no retry
under a different identity, no proxy, no cache-busting. On HTTP 429 the script stops
and reports rather than working around the limit.

Reviewer identifiers are never requested and never written.
"""

from __future__ import annotations

import argparse
import csv
import html as htmllib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

API_APP = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
API_REV = ("https://store.steampowered.com/appreviews/{appid}"
           "?json=1&num_per_page=0&language=all&purchase_type=all")
API_SEARCH = ("https://store.steampowered.com/search/results/?query&start={start}"
              "&count={count}&dynamic_data=&sort_by=Released_DESC&infinite=1{extra}")

REQUEST_DELAY = 1.2      # seconds between requests; do not lower
PAGE_SIZE = 50           # candidates per search page

# Coarse probe depths used only to seed the depth/date map before any cell is
# visited. Each probe is a single request.
PROBE_DEPTHS = [0, 4000, 8000, 12000, 16000, 20000, 24000, 28000, 32000]

# A located page covers only one or two release days, so a single page cannot fill a ~90-day
# quarter. The sweep is computed per cell from the measured depth-per-day slope so that its span
# covers the whole quarter rather than a sliver around the midpoint. These fractions of the
# half-quarter are visited on both sides of the midpoint.
QUARTER_SWEEP_FRACTIONS = [0.0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]
MIN_SWEEP_STEP = 300      # depth units; avoids revisiting the same page many times
MAX_SWEEP_OFFSET = 25000  # depth units; keeps a single cell from wandering across the window

ROW_RE = re.compile(r'<a\b[^>]*data-ds-appid="(\d+)"(.*?)</a>', re.S)
NAME_RE = re.compile(r'<span class="title">(.*?)</span>', re.S)
REL_RE = re.compile(r'class="search_released[^"]*"[^>]*>\s*(.*?)\s*</div>', re.S)
# The result row also carries the review summary as a tooltip attribute, for example
#   "Very Positive<br>90% of the 186 user reviews for this game are positive."
# This is what lets the review floor be applied before any per-title request is spent.
REVDIV_RE = re.compile(r'class="search_reviewscore[^"]*"[^>]*>(.*?)</div>', re.S)
TOOLTIP_RE = re.compile(r'data-tooltip-html="([^"]*)"')
REVCOUNT_RE = re.compile(r'([\d,]+)\s+user reviews')
REVPCT_RE = re.compile(r'(\d+)\s*%')

GENRE_TAGS = {
    "Action": 19,
    "Indie": 492,
    "RPG": 122,
    "Strategy": 9,
    "Simulation": 599,
    "Adventure": 21,
    "Racing": 699,
    "Sports": 701,
    "Casual": 597,
}
DEFAULT_TAGS = ["Action", "Indie", "RPG", "Strategy", "Simulation", "Adventure"]


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch(url: str) -> dict | None:
    """Fetch JSON. Stops on a rate-limit response rather than retrying."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (academic-coursework; COMM7660)",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8", "replace")
        return json.loads(payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            log("RATE LIMITED (429). Stopping rather than working around the limit.")
            raise SystemExit(2)
        log(f"HTTP {exc.code} for {url[:80]}")
        return None
    except Exception as exc:                                  # noqa: BLE001
        log(f"{type(exc).__name__} for {url[:80]}")
        return None
    finally:
        time.sleep(REQUEST_DELAY)


def parse_release(text: str) -> date | None:
    """Steam returns dates in several shapes; try the common ones."""
    if not text:
        return None
    text = htmllib.unescape(re.sub(r"<[^>]+>", "", text)).strip()
    for fmt in ("%d %b, %Y", "%b %d, %Y", "%d %B, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def quarter_of(d: date) -> str:
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def last_day_of_month(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    return date.fromordinal(date(year, month + 1, 1).toordinal() - 1)


def quarter_bounds(q: str) -> tuple[date, date]:
    year, qtr = (int(x) for x in q.split("-Q"))
    first = (qtr - 1) * 3 + 1
    last = first + 2
    if last > 12:
        return date(year, first, 1), last_day_of_month(year + 1, last - 12)
    return date(year, first, 1), last_day_of_month(year, last)


def quarter_midpoint_date(q: str) -> date:
    start, end = quarter_bounds(q)
    return date.fromordinal((start.toordinal() + end.toordinal()) // 2)


def quarters_between(start: date, end: date) -> list[str]:
    """All release quarters touched by [start, end], newest first."""
    out: list[str] = []
    y, m = start.year, start.month
    while True:
        q = f"{y}-Q{(m - 1) // 3 + 1}"
        if q not in out:
            out.append(q)
        if (y, m) >= (end.year, end.month):
            break
        m += 3
        if m > 12:
            m -= 12
            y += 1
    return list(reversed(out))


def search_rows(tag_id: int, start: int) -> tuple[list[dict], int | None]:
    """One request -> every candidate on the page, each with its release date."""
    data = fetch(API_SEARCH.format(start=max(0, start), count=PAGE_SIZE,
                                   extra=f"&tags={tag_id}"))
    if not data:
        return [], None
    html = data.get("results_html", "")
    out = []
    for m in ROW_RE.finditer(html):
        appid, block = m.group(1), m.group(2)
        rel = REL_RE.search(block)
        if not rel:
            continue
        d = parse_release(rel.group(1))
        if d is None:
            continue                                  # unannounced / "Coming soon"
        nm = NAME_RE.search(block)

        # Review count and share from the row's own tooltip. These are a SCREEN only: they let
        # the review floor be applied without spending a request per candidate. The authoritative
        # counts still come from the appreviews endpoint for every accepted title.
        rev_count, rev_pct = None, None
        revdiv = REVDIV_RE.search(block)
        if revdiv:
            tip = TOOLTIP_RE.search(revdiv.group(1))
            if tip:
                text = htmllib.unescape(tip.group(1))
                mc = REVCOUNT_RE.search(text)
                if mc:
                    rev_count = int(mc.group(1).replace(",", ""))
                mp_ = REVPCT_RE.search(text)
                if mp_:
                    rev_pct = int(mp_.group(1))

        out.append({
            "appid": appid,
            "name": htmllib.unescape(nm.group(1)).strip() if nm else "",
            "release_date": d,
            "search_review_count": rev_count,
            "search_review_pct": rev_pct,
        })
    return out, data.get("total_count")


def observed_dates(obs: dict[str, str]) -> list[tuple[int, date]]:
    return sorted(((int(d), date.fromisoformat(t)) for d, t in obs.items()),
                  key=lambda x: x[0])


def depth_for_date(anchors: list[tuple[int, date]], target: date) -> int:
    """Invert the depth->date map. Linear inside the bracket, last slope outside."""
    pts = sorted(anchors, key=lambda x: x[0])
    if not pts:
        return 0
    if len(pts) == 1:
        return pts[0][0]
    if target >= pts[0][1]:          # newer than anything seen: start at the top
        return pts[0][0]
    for (d0, t0), (d1, t1) in zip(pts, pts[1:]):
        lo, hi = min(t0, t1), max(t0, t1)
        if lo <= target <= hi:
            span = (t1 - t0).days
            if span == 0:
                return d0
            return int(d0 + ((target - t0).days / span) * (d1 - d0))
    (d0, t0), (d1, t1) = pts[-2], pts[-1]
    span = (t1 - t0).days
    if span == 0:
        return d1
    return max(0, int(d1 + ((d1 - d0) / span) * (target - t1).days))


def depth_per_day(anchors: list[tuple[int, date]], target: date) -> float:
    """Local slope in depth units per calendar day. Used to size a correction step."""
    pts = sorted(anchors, key=lambda x: x[0])
    if len(pts) < 2:
        return 20.0
    best = None
    for (d0, t0), (d1, t1) in zip(pts, pts[1:]):
        lo, hi = min(t0, t1), max(t0, t1)
        span = abs((t1 - t0).days) or 1
        slope = abs(d1 - d0) / span
        if lo <= target <= hi:
            return max(1.0, slope)
        dist = abs((t0 - target).days)
        if best is None or dist < best[0]:
            best = (dist, slope)
    return max(1.0, best[1] if best else 20.0)


def details(appid: str) -> dict | None:
    det = fetch(API_APP.format(appid=appid))
    if not det or not det.get(str(appid), {}).get("success"):
        return None
    return det[str(appid)].get("data")


def summary_block(appid: str) -> dict | None:
    rv = fetch(API_REV.format(appid=appid))
    if not rv:
        return None
    return rv.get("query_summary")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutoff", default="2026-10-09",
                    help="data cutoff, ISO date. Window is the 24 months before it.")
    ap.add_argument("--min-reviews", type=int, default=50)
    ap.add_argument("--per-quarter", type=int, default=4,
                    help="target titles per (tag, quarter) cell")
    ap.add_argument("--max-per-tag", type=int, default=40,
                    help="hard ceiling on titles drawn from one tag")
    ap.add_argument("--max-checks-per-quarter", type=int, default=40,
                    help="review calls spent on one cell before moving on")
    ap.add_argument("--tags", default=",".join(DEFAULT_TAGS),
                    help="comma-separated tag names to walk")
    ap.add_argument("--outdir", default="data/raw")
    ap.add_argument("--no-resume", action="store_true",
                    help="ignore an existing checkpoint and start fresh")
    ap.add_argument("--calibrate-only", action="store_true",
                    help="print the seed depth/date map and exit")
    args = ap.parse_args()

    cutoff = date.fromisoformat(args.cutoff)
    window_start = date(cutoff.year - 2, cutoff.month, cutoff.day)
    tags = [t.strip() for t in args.tags.split(",") if t.strip() in GENRE_TAGS]
    all_quarters = quarters_between(window_start, cutoff)

    log(f"cutoff={cutoff}  window={window_start}..{cutoff}  quarters={len(all_quarters)}")
    log(f"tags={tags}  min_reviews={args.min_reviews}  per_quarter={args.per_quarter}")

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    ckpt = outdir / "checkpoint.json"
    accepted: dict[str, dict] = {}
    reject: Counter = Counter()
    observed: dict[str, dict[str, str]] = {}
    totals_by_tag: dict[str, int] = {}
    seen: set[str] = set()
    done_cells: set[str] = set()
    stamp = None

    if ckpt.exists() and not args.no_resume:
        state = json.loads(ckpt.read_text(encoding="utf-8"))
        accepted = state["accepted"]
        reject = Counter(state["reject"])
        observed = state.get("observed", {})
        totals_by_tag = state.get("totals_by_tag", {})
        seen = set(state["seen"])
        done_cells = set(state["done_cells"])
        stamp = state.get("stamp")
        log(f"RESUMED: {len(accepted)} accepted, {len(seen)} candidates screened, "
            f"{len(done_cells)} cells full")
    if not stamp:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    def save() -> None:
        ckpt.write_text(json.dumps({
            "stamp": stamp,
            "accepted": accepted,
            "reject": dict(reject),
            "observed": observed,
            "totals_by_tag": totals_by_tag,
            "seen": sorted(seen),
            "done_cells": sorted(done_cells),
        }), encoding="utf-8")

    def anchors_for(tag: str) -> list[tuple[int, date]]:
        return observed_dates(observed.get(tag, {}))

    def seeds(tag: str, tag_id: int) -> None:
        obs = observed.setdefault(tag, {})
        for depth in PROBE_DEPTHS:
            if str(depth) in obs:
                continue
            rows, tc = search_rows(tag_id, depth)
            if tc is not None:
                totals_by_tag[tag] = tc
            if not rows:
                if depth >= 16000:
                    break
                continue
            mid = sorted(r["release_date"] for r in rows)[len(rows) // 2]
            obs[str(depth)] = mid.isoformat()
            save()
        a = anchors_for(tag)
        if a:
            log(f"    {tag} frame={totals_by_tag.get(tag)} "
                f"map {a[0][0]}->{a[0][1]} .. {a[-1][0]}->{a[-1][1]}")

    if args.calibrate_only:
        for tag in tags:
            log(f"--- seeding {tag} ---")
            seeds(tag, GENRE_TAGS[tag])
        return 0

    def locate(tag: str, tag_id: int, target: date) -> tuple[int, list[dict]]:
        """Fetch the page bracketing `target`, correcting the depth as needed."""
        obs = observed.setdefault(tag, {})
        depth = depth_for_date(anchors_for(tag), target)
        depth = max(0, (depth // PAGE_SIZE) * PAGE_SIZE)
        rows: list[dict] = []
        for _ in range(6):
            rows, tc = search_rows(tag_id, depth)
            if tc is not None:
                totals_by_tag[tag] = tc
            if not rows:
                depth = max(0, depth - 500)
                continue
            mid = sorted(r["release_date"] for r in rows)[len(rows) // 2]
            obs[str(depth)] = mid.isoformat()
            save()
            dates = [r["release_date"] for r in rows]
            if min(dates) <= target <= max(dates):
                return depth, rows
            slope = depth_per_day(anchors_for(tag), target)
            if target > max(dates):                       # too recent: go deeper
                depth = int(depth - slope * (target - max(dates)).days * 0.8)
            else:                                         # too old: come back up
                depth = int(depth + slope * (min(dates) - target).days * 0.8)
            depth = max(0, (depth // PAGE_SIZE) * PAGE_SIZE)
        return depth, rows

    for tag in tags:
        tag_id = GENRE_TAGS[tag]
        if not observed.get(tag):
            log(f"--- seeding {tag} (id={tag_id}) ---")
            seeds(tag, tag_id)
        got_tag = sum(1 for r in accepted.values() if r["assigned_tag"] == tag)
        log(f"--- tag {tag} (id={tag_id}) --- frame={totals_by_tag.get(tag)} "
            f"[have {got_tag}]")

        for q in all_quarters:
            if got_tag >= args.max_per_tag:
                break
            cell = f"{tag}:{q}"
            if cell in done_cells:
                continue
            target = min(max(quarter_midpoint_date(q), window_start), cutoff)
            base_depth, _ = locate(tag, tag_id, target)

            # Size the sweep from the measured slope so the cell is sampled across the whole
            # quarter rather than around its midpoint only.
            q_start, q_end = quarter_bounds(q)
            half_days = max(1.0, (q_end - q_start).days / 2.0)
            slope = depth_per_day(anchors_for(tag), target)
            half_offset = int(min(MAX_SWEEP_OFFSET, max(0.0, slope * half_days * 0.95)))
            offsets: list[int] = []
            for frac in QUARTER_SWEEP_FRACTIONS:
                off = int(round(half_offset * abs(frac))) * (1 if frac >= 0 else -1)
                if off != 0 and abs(off) < MIN_SWEEP_STEP:
                    off = MIN_SWEEP_STEP * (1 if off > 0 else -1)
                if off not in offsets:
                    offsets.append(off)
            log(f"  {q}: sweep half-offset {half_offset} depth "
                f"(slope {slope:.1f}/day, half-quarter {half_days:.0f} days)")

            checks = 0
            got_q = 0
            for offset in offsets:
                if got_q >= args.per_quarter or got_tag >= args.max_per_tag:
                    break
                if checks >= args.max_checks_per_quarter:
                    break
                rows = search_rows(tag_id, max(0, base_depth + offset))[0]
                in_cell = [r for r in rows
                           if window_start <= r["release_date"] <= cutoff
                           and quarter_of(r["release_date"]) == q
                           and r["appid"] not in seen
                           and r["appid"] not in accepted]
                # Apply the review floor from the page itself. Candidates the screen already
                # rules out cost nothing; only survivors earn a per-title request.
                cands = [r for r in in_cell
                         if (r["search_review_count"] or 0) >= args.min_reviews]
                screened_out = len(in_cell) - len(cands)
                if screened_out:
                    reject["below_floor_by_page_screen"] += screened_out
                log(f"  {q} @{base_depth + offset:>6}: {len(rows)} rows, "
                    f"{len(in_cell)} in-cell, {len(cands)} clear floor "
                    f"({got_q}/{args.per_quarter})")
                for r in cands:
                    if got_q >= args.per_quarter or got_tag >= args.max_per_tag:
                        break
                    if checks >= args.max_checks_per_quarter:
                        break
                    seen.add(r["appid"])
                    checks += 1
                    qs = summary_block(r["appid"])
                    if not qs:
                        reject["no_review_summary"] += 1
                        continue
                    pos = qs.get("total_positive", 0)
                    neg = qs.get("total_negative", 0)
                    total = pos + neg
                    if total == 0:
                        reject["zero_reviews"] += 1
                        continue
                    if total < args.min_reviews:
                        reject["below_min_reviews"] += 1
                        continue
                    data = details(r["appid"])
                    if not data or data.get("type") != "game":
                        reject["not_a_game_or_unavailable"] += 1
                        continue
                    price = data.get("price_overview") or {}
                    accepted[r["appid"]] = {
                        "appid": r["appid"],
                        "name": data.get("name") or r["name"],
                        "assigned_tag": tag,
                        "type": data.get("type"),
                        "release_date": r["release_date"].isoformat(),
                        "release_quarter": q,
                        "is_free": bool(data.get("is_free", False)),
                        "genres": "|".join(g["description"]
                                           for g in data.get("genres", [])),
                        "categories": "|".join(c["description"]
                                               for c in data.get("categories", [])),
                        "developers": "|".join(data.get("developers", [])),
                        "publishers": "|".join(data.get("publishers", [])),
                        "price_initial": price.get("initial"),
                        "price_currency": price.get("currency"),
                        "total_positive": pos,
                        "total_negative": neg,
                        "total_reviews": total,
                        "positive_rate": round(pos / total, 6),
                        "review_score_desc": qs.get("review_score_desc", ""),
                        "short_description": (data.get("short_description") or "")[:2000],
                    }
                    got_q += 1
                    got_tag += 1
                    save()
            if got_q >= args.per_quarter:
                done_cells.add(cell)
            save()
            log(f"    {q} ended {got_q}/{args.per_quarter}; tag {got_tag}, "
                f"overall {len(accepted)}")

    rows_out = sorted(accepted.values(), key=lambda r: r["release_date"])
    outfile = outdir / f"steam_titles_{stamp}.csv"
    if rows_out:
        with outfile.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows_out[0].keys()))
            w.writeheader()
            w.writerows(rows_out)
    ckpt.unlink(missing_ok=True)

    audit = {
        "collected_at_utc": stamp,
        "cutoff": args.cutoff,
        "window_start": window_start.isoformat(),
        "min_reviews": args.min_reviews,
        "per_quarter_target": args.per_quarter,
        "max_per_tag": args.max_per_tag,
        "max_checks_per_quarter": args.max_checks_per_quarter,
        "request_delay_seconds": REQUEST_DELAY,
        "tags_walked": tags,
        "frame_total_count_by_tag": totals_by_tag,
        "depth_date_observations": {
            k: {d: v for d, v in sorted(vals.items(), key=lambda kv: int(kv[0]))}
            for k, vals in observed.items()},
        "accepted_titles": len(rows_out),
        "candidates_screened": len(seen),
        "rejections": dict(reject),
        "release_quarters": dict(sorted(Counter(r["release_quarter"]
                                                for r in rows_out).items())),
        "by_tag": dict(sorted(Counter(r["assigned_tag"] for r in rows_out).items())),
        "free_to_play": sum(r["is_free"] for r in rows_out),
        "outfile": str(outfile),
    }
    auditfile = outdir / f"collection_audit_{stamp}.json"
    auditfile.write_text(json.dumps(audit, indent=2), encoding="utf-8")

    log(f"accepted {len(rows_out)} titles from {len(seen)} screened candidates")
    log(f"-> {outfile}")
    log(f"-> {auditfile}")
    log(f"quarters: {audit['release_quarters']}")
    log(f"by tag: {audit['by_tag']}")
    log(f"rejections: {dict(reject)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
