#!/usr/bin/env python3
"""
build_product_data.py — 从冻结的分析数据集生成产品所需的参照分布数据。

产出：
  product/reference-distribution.json   便于审计的纯数据文件
  product/reference-data.js             同一份数据，包成 JS 变量供页面直接 <script> 加载

为什么用 <script> 而不是 fetch
------------------------------
页面要能"双击直接在浏览器打开"。用 fetch 读本地 JSON 会被 file:// 的 CORS 规则拦掉，
而 <script src> 不受该限制。所以数据以 JS 变量形式提供，同时另存一份 JSON 供审计。

有意**不**包含的字段
--------------------
数据里只有 appid、名称、发行日期、评论数、好评率。
**不含 genres，也不含 is_free。**
这不是遗漏：产品承诺不做品类/商业模式分类，把这两列从产品数据里去掉，
就让"意外加上条件筛选"在结构上不可能发生，而不是靠界面自觉。
完整数据集（含这些字段）在 data/clean/analysis_dataset.csv，任何人可去核对。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "clean" / "analysis_dataset.csv"
PRODUCT = ROOT / "product"

CUTOFF = "2026-10-09"
MIN_REVIEWS = 50

# 产品数据中允许出现的字段。白名单，防止日后误加会引入条件筛选的列。
ALLOWED = {"appid", "name", "release_date", "total_reviews", "positive_rate"}
FORBIDDEN = {"genres", "categories", "is_free", "assigned_tag", "multiplayer_emphasis",
             "price_initial", "developers", "publishers", "short_description",
             "coded_early_access", "review_score_desc"}


def percentile_definition() -> dict:
    return {
        "method": "empirical_cdf_interpolated",
        "description": ("按好评率升序排列的 159 款作品，将输入值线性插值到排序位置上，"
                        "再换算为 0-100 的百分位。该定义在整个输入区间上严格单调递增。"),
        "notes": [
            "输入等于最小好评率时返回 0，等于最大时返回 100。",
            "相同好评率之间的区间用较低一侧的位置，避免除零。",
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=None)
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    src = Path(args.input) if args.input else CLEAN
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        sys.exit(f"缺少数据集：{src}。请先运行 analysis/validate_data.py。")

    outdir = Path(args.outdir) if args.outdir else PRODUCT
    if not outdir.is_absolute():
        outdir = ROOT / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    rows = list(csv.DictReader(src.open(encoding="utf-8")))

    # 断言：数据集中确实存在我们有意排除的列，否则说明源文件不对
    present = set(rows[0].keys())
    if not (FORBIDDEN & present):
        sys.exit("源数据集缺少预期字段；看起来不是本项目的分析数据集。")

    titles = []
    for r in rows:
        titles.append({
            "appid": r["appid"],
            "name": r["name"],
            "release_date": r["release_date"],
            "total_reviews": int(r["total_reviews"]),
            "positive_rate": round(float(r["positive_rate"]), 6),
        })

    # 白名单校验
    for t in titles:
        extra = set(t) - ALLOWED
        if extra:
            sys.exit(f"产品数据中出现未允许字段：{extra}")
    leak = set(titles[0]) & FORBIDDEN
    if leak:
        sys.exit(f"产品数据中泄漏了受限字段：{leak}")

    rates = sorted(t["positive_rate"] for t in titles)
    n = len(rates)

    def median(v):
        m = len(v) // 2
        return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2

    payload = {
        "product": "Reception Baseline",
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "source": {
            "dataset": str(src.relative_to(ROOT)) if src.is_relative_to(ROOT) else str(src),
            "sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
            "cutoff": CUTOFF,
            "min_reviews": MIN_REVIEWS,
        },
        "reference_set_description": (
            f"Steam 作品 {n} 款，发行于 2024-10-09 至 {CUTOFF}，评论数至少 {MIN_REVIEWS} 条"
        ),
        "n": n,
        "rates_sorted": rates,
        "summary": {
            "mean": round(sum(rates) / n, 6),
            "median": round(median(rates), 6),
            "q1": rates[n // 4],
            "q3": rates[(3 * n) // 4],
            "min": rates[0],
            "max": rates[-1],
        },
        "percentile_definition": percentile_definition(),
        "titles": titles,
        "excluded_from_product_data": sorted(FORBIDDEN),
        "excluded_reason": ("产品承诺不按品类或商业模式分类（两者经检验均不显著）。"
                            "从产品数据中移除这些列，使条件筛选在结构上无法发生。"
                            "完整数据集见 data/clean/analysis_dataset.csv。"),
    }

    (outdir / "reference-distribution.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    (outdir / "reference-data.js").write_text(
        "// 由 analysis/build_product_data.py 生成，请勿手工编辑。\n"
        f"// 来源：{payload['source']['dataset']}  sha256={payload['source']['sha256']}\n"
        "window.REFERENCE_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8")

    print(f"参照集：{n} 款")
    print(f"  均值 {payload['summary']['mean']:.3f}  中位 {payload['summary']['median']:.3f}  "
          f"四分位 {payload['summary']['q1']:.3f}–{payload['summary']['q3']:.3f}")
    print(f"  范围 {payload['summary']['min']:.3f}–{payload['summary']['max']:.3f}")
    print(f"  数据集 sha256 = {payload['source']['sha256'][:16]}…")
    print(f"-> {outdir / 'reference-distribution.json'}")
    print(f"-> {outdir / 'reference-data.js'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
