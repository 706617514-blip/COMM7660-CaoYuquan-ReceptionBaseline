#!/usr/bin/env python3
"""
probe_frame_totals.py — 记录每个品类 tag 下 Steam 的作品总数（框架规模）。

为什么需要
----------
collect_market.py 采的是**样本**（每格 6 款），样本量由配额决定，不反映品类真实规模。
要判断"这个赛道挤不挤"，需要知道每个 tag 下的作品总量。搜索接口的 total_count
直接给出这个数。

输出：data/raw/market_frame_totals.json

注意：只在采集器**停止后**运行。并发请求会增加触发限流的风险，而限流会打断采集。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "analysis"))

from collect_titles import GENRE_TAGS, search_rows          # noqa: E402


def main() -> int:
    out = ROOT / "data" / "raw" / "market_frame_totals.json"
    totals: dict[str, int] = {}
    for tag, tid in GENRE_TAGS.items():
        _, tc = search_rows(tid, 0)
        if tc is None:
            print(f"  {tag:<12} 取不到 total_count")
            continue
        totals[tag] = int(tc)
        print(f"  {tag:<12}{totals[tag]:>9,}")

    payload = {
        "recorded_at_utc": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "note": "各 tag 下的 Steam 作品总数，来自 search/results 的 total_count",
        "totals": totals,
    }
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n-> {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
