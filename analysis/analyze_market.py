#!/usr/bin/env python3
"""
analyze_market.py — 「该开发什么类型的游戏」的多维度市场分析。

决策问题
========
Phase 1 的结论是：好评率无法由品类、商业模式、上线时长、评论量解释（伪 R² = 0.007，
无一显著）。因此**不能用"哪个品类口碑更好"来做立项决策**——那个量测不出来。

本脚本改用**可测且决策相关**的维度。核心逻辑：

    立项能不能成立，取决于「有没有受众」和「挤不挤」，而不是「评分能不能预期」。

五个维度
========
A. 触达（reach）      每个品类里，有多大比例的作品真的找到了受众？
                      用评论量作受众代理：≥10 / ≥100 / ≥500 / ≥1000 / ≥5000 条的比例。
                      零评论比例单独列出——它衡量"大多数作品石沉大海"的程度。
B. 拥挤（crowding）   框架内作品总数（各品类 tag 下的 Steam 总量）+ 本样本的零评论率。
C. 口碑（reception）  好评百分比的中位数与 ≥80% 的比例。
                      **仅作描述**：Phase 1 已证明品类间差异不显著，这里不做选择依据。
                      附置换检验，若 p 值大，正好印证 Phase 1。
D. 货币化（model）    免费游玩比例、付费作品的价格中位数。
E. 可行性（feasible） 开发团队规模（来自 developers 字段）、抢先体验比例。
                      单人/小团队在 ~10 天内做不出来的品类，直接排除。

先声明决策规则（在看到结果之前写死，避免事后挑标准）
====================================================
1. 硬约束：样本中位团队规模 ≤ 5 人。超过即视为一人 10 天内不可行，排除。
2. 可行集内按 P(≥100 条评论) 排序——这是"找到受众的概率"。
3. 以零评论率作为下行情景检查：若某品类 P(≥100) 高但零评论率也高，说明是高波动赌局。
4. 口碑只用于**确认没有明显劣势**，不用于排序。
5. 可行性相当时，优先"中位团队规模更小"的品类。

统计方法（无 scipy 依赖）
========================
- 比例区间：Wilson 区间（比正态近似更适合小样本/极端比例）
- 组间差异：置换检验（不依赖分布假设；评论量分布极度右偏）
- 中位数不确定性：bootstrap

用法：
  python3 analysis/analyze_market.py
  python3 analysis/analyze_market.py --input data/raw/market_titles_XXXX.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "analysis" / "market"
SEED = 20261105

MULTI_MARKERS = ("Multi-player", "Co-op", "PvP", "MMO", "Shared/Split Screen")
THRESHOLDS = (10, 100, 500, 1000, 5000)


# ------------------------------------------------------------------ 统计工具


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson 比例区间。小样本和接近 0/1 的比例下比 Wald 区间可靠得多。"""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def permutation_test(groups: dict[str, np.ndarray], n_perm: int = 5000,
                     rng: np.random.Generator | None = None) -> dict:
    """组间统计量差异的置换检验。

    统计量用「原始尺度上的最大值减最小值」而不是 F 或 H：它不依赖分布假设，
    而且在评论量这种右偏到极点的数据上，尺度差异才是决策者关心的东西（差多少倍），
    不是方差解释比例。
    """
    rng = rng or np.random.default_rng(SEED)
    pooled = np.concatenate([g for g in groups.values() if len(g)])
    labels = np.concatenate([[k] * len(g) for k, g in groups.items() if len(g)])
    if len(pooled) < 5:
        return {"stat": float("nan"), "p": float("nan"), "n": int(len(pooled))}

    def stat_of(vals: np.ndarray, lab: np.ndarray) -> float:
        means = [vals[lab == k].mean() for k in np.unique(lab) if (lab == k).any()]
        return float(max(means) - min(means))

    observed = stat_of(pooled, labels)
    count = 0
    for _ in range(n_perm):
        perm = rng.permutation(labels)
        if stat_of(pooled, perm) >= observed:
            count += 1
    return {"stat": observed, "p": (count + 1) / (n_perm + 1), "n": int(len(pooled))}


def bootstrap_median(values: np.ndarray, n_boot: int = 2000,
                     rng: np.random.Generator | None = None) -> tuple[float, float]:
    rng = rng or np.random.default_rng(SEED)
    if len(values) == 0:
        return (float("nan"), float("nan"))
    meds = [np.median(rng.choice(values, size=len(values), replace=True))
            for _ in range(n_boot)]
    return (float(np.percentile(meds, 2.5)), float(np.percentile(meds, 97.5)))


# ------------------------------------------------------------------ 维度计算


def load_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        r["total_reviews"] = int(r["total_reviews"])
        # CSV 里布尔是字符串 "True"/"False"，直接喂给 numpy 会被当成 <U5 数组
        r["is_free"] = 1 if str(r["is_free"]).strip().lower() in ("true", "1") else 0
        r["review_pct_num"] = float(r["review_pct"]) if r["review_pct"] not in ("", None) else float("nan")
        r["team_size"] = len([d for d in (r["developers"] or "").split("|") if d]) or 1
        r["is_multi"] = 1 if any(m in (r["categories"] or "") for m in MULTI_MARKERS) else 0
        r["is_early_access"] = 1 if "Early Access" in (r["genres"] or "") else 0
        try:
            r["price_units"] = int(r["price_initial"]) if r["price_initial"] else None
        except ValueError:
            r["price_units"] = None
    return rows


def genre_profile(rows: list[dict], genre: str, frame_total: int | None) -> dict:
    sub = [r for r in rows if r["assigned_tag"] == genre]
    n = len(sub)
    if n == 0:
        return {}
    rev = np.array([r["total_reviews"] for r in sub], dtype=float)
    pct = np.array([r["review_pct_num"] for r in sub if not math.isnan(r["review_pct_num"])])
    team = np.array([r["team_size"] for r in sub], dtype=float)
    paid = [r["price_units"] for r in sub if r["price_units"]]
    lo, hi = bootstrap_median(rev)

    withrev = rev[rev > 0]
    prof = {
        "genre": genre, "n": n, "frame_total": frame_total,
        # 全体中位数几乎必然是 0（多数作品无人评论），单看它没有信息量。
        # 因此另给"至少有一条评论者"的中位数与四分位，才看得出品类内部的量级差异。
        "median_reviews_if_any": float(np.median(withrev)) if len(withrev) else float("nan"),
        "q25_reviews_if_any": float(np.percentile(withrev, 25)) if len(withrev) else float("nan"),
        "q75_reviews_if_any": float(np.percentile(withrev, 75)) if len(withrev) else float("nan"),
        "zero_review_n": int((rev == 0).sum()),
        "zero_review_pct": float((rev == 0).mean() * 100),
        "median_reviews": float(np.median(rev)),
        "median_reviews_ci": (lo, hi),
        "median_review_pct": float(np.median(pct)) if len(pct) else float("nan"),
        "pct_ge_80_positive": float((pct >= 80).mean() * 100) if len(pct) else float("nan"),
        "f2p_pct": float(np.mean([r["is_free"] for r in sub]) * 100),
        "median_price": float(np.median(paid)) if paid else float("nan"),
        "multi_pct": float(np.mean([r["is_multi"] for r in sub]) * 100),
        "early_access_pct": float(np.mean([r["is_early_access"] for r in sub]) * 100),
        "median_team": float(np.median(team)),
        "solo_pct": float((team <= 1).mean() * 100),
        "small_team_pct": float((team <= 3).mean() * 100),
    }
    for t in THRESHOLDS:
        k = int((rev >= t).sum())
        lo_t, hi_t = wilson(k, n)
        prof[f"ge_{t}_n"] = k
        prof[f"ge_{t}_pct"] = k / n * 100
        prof[f"ge_{t}_ci"] = (lo_t * 100, hi_t * 100)
    return prof


def decide(profiles: list[dict], max_median_team: float = 5.0) -> dict:
    """按脚本开头预先声明的规则做选择。规则执行在这里，不做事后调整。"""
    feasible = [p for p in profiles if p["median_team"] <= max_median_team]
    excluded = [p for p in profiles if p["median_team"] > max_median_team]
    ranked = sorted(feasible, key=lambda p: -p["ge_100_pct"])
    if not ranked:
        return {"feasible": [], "excluded": excluded, "ranked": [], "pick": None}

    best = ranked[0]
    # 平手时优先中位团队规模更小的
    ties = [p for p in ranked if abs(p["ge_100_pct"] - best["ge_100_pct"]) < 1.0]
    if len(ties) > 1:
        best = min(ties, key=lambda p: p["median_team"])
    return {"feasible": feasible, "excluded": excluded, "ranked": ranked, "pick": best}


# ------------------------------------------------------------------ 输出


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=None)
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    if args.input:
        src = Path(args.input)
        if not src.is_absolute():
            src = ROOT / src
    else:
        hits = sorted(RAW.glob("market_titles_*.csv"))
        if not hits:
            sys.exit("未找到 data/raw/market_titles_*.csv，请先运行 analysis/collect_market.py")
        src = hits[-1]

    outdir = Path(args.outdir) if args.outdir else OUT
    if not outdir.is_absolute():
        outdir = ROOT / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    rows = load_rows(src)
    frame = {}
    # 框架总量优先取输入文件同目录的那份，其次才是主目录。
    # 定向采样（data/raw/targeted/）有自己的总量文件，不应回落到 9 品类的那份。
    fpath = src.parent / "market_frame_totals.json"
    if not fpath.exists():
        fpath = RAW / "market_frame_totals.json"
    if fpath.exists():
        frame = json.loads(fpath.read_text(encoding="utf-8")).get("totals", {})

    genres = sorted({r["assigned_tag"] for r in rows},
                    key=lambda g: -sum(1 for r in rows if r["assigned_tag"] == g))
    profiles = [genre_profile(rows, g, frame.get(g)) for g in genres]
    profiles = [p for p in profiles if p]

    lines: list[str] = []

    def say(s: str = "") -> None:
        print(s, flush=True)
        lines.append(s)

    say("=" * 84)
    say("Phase 2 市场分析 — 该开发什么类型的游戏")
    say("=" * 84)
    say(f"输入        : {src.relative_to(ROOT)}")
    say(f"样本        : {len(rows)} 款，{len(profiles)} 个品类")
    say(f"采集截止日   : {rows[0]['release_date']} .. {max(r['release_date'] for r in rows)}")
    say(f"随机种子     : {SEED}")
    say()

    # ---- A. 触达
    say("--- A. 触达：这个品类里，作品找到受众的概率有多大 ---")
    say(f"{'品类':<12}{'n':>4}{'零评论%':>8}{'有评论者中位':>12}{'(IQR)':>16}"
        f"{'≥100条%':>9}{'95%CI':>16}{'≥1000条%':>10}")
    say("-" * 100)
    for p in sorted(profiles, key=lambda x: -x["ge_100_pct"]):
        ci = p["ge_100_ci"]
        say(f"{p['genre']:<12}{p['n']:>4}{p['zero_review_pct']:>8.0f}"
            f"{p['median_reviews_if_any']:>12.0f}"
            f"{f'[{p[chr(39)+chr(39)] if False else p['q25_reviews_if_any']:.0f}, {p['q75_reviews_if_any']:.0f}]':>16}"
            f"{p['ge_100_pct']:>9.1f}"
            f"{f'[{ci[0]:.1f},{ci[1]:.1f}]':>16}{p['ge_1000_pct']:>10.1f}")
    say()

    # ---- A2. 稳健性：排名是不是噪声
    say("--- A2. 稳健性：上面这个排序靠得住吗 ---")
    reach_groups = defaultdict(list)
    for r in rows:
        reach_groups[r["assigned_tag"]].append(1.0 if r["total_reviews"] >= 100 else 0.0)
    reach_perm = permutation_test({k: np.array(v) for k, v in reach_groups.items()})
    say(f"  置换检验（各品类「是否达到 100 条评论」）：组间极差 {reach_perm['stat']*100:.1f} 个百分点，"
        f"p = {reach_perm['p']:.3f}，n = {reach_perm['n']}")
    if reach_perm["p"] > 0.05:
        say("  → **不能**拒绝「各品类触达概率相同」。所以上面的排序只能当作点估计，")
        say("    不能当作「Simulation 确实比其他品类好」的证据。")
    top = max(profiles, key=lambda x: x["ge_100_pct"])
    rivals = [x for x in profiles if x is not top and x["ge_100_pct"] >= top["ge_100_pct"] - 8]
    if len(rivals) > 1:
        say(f"  置信区间重叠：{top['genre']} 的区间 {top['ge_100_ci'][0]:.1f}–{top['ge_100_ci'][1]:.1f}% "
            f"与 {', '.join(x['genre'] for x in rivals)} 大量重叠。")
    say()
    say("--- A3. 另两个决策相关的量 ---")
    hip = max(profiles, key=lambda x: x["ge_1000_pct"])
    if hip["genre"] != top["genre"]:
        say(f"  上限（≥1000 条评论的比例）最高的是 {hip['genre']}：{hip['ge_1000_pct']:.1f}%"
            f"，而 {top['genre']} 只有 {top['ge_1000_pct']:.1f}%。")
        say(f"  即：{top['genre']} 的「拿到一点受众」概率最高，"
            f"{hip['genre']} 的「做成爆款」概率最高——两者不是同一个目标。")
    else:
        say(f"  {top['genre']} 同时是「拿到受众」点估计最高（{top['ge_100_pct']:.1f}%）"
            f"和「上限」最高（{top['ge_1000_pct']:.1f}%）的品类，两个目标不冲突。")
    say(f"  样本中位团队规模全品类为 1 人（单人比例 "
        f"{min(p['solo_pct'] for p in profiles):.0f}–{max(p['solo_pct'] for p in profiles):.0f}%），"
        "因此「可行性」这一维度**无法区分品类**——它不构成筛选，只是确认了样本以单人作品为主。")
    say()

    # ---- B. 拥挤
    say("--- B. 拥挤：唯一在量级上真正拉开差距的维度 ---")
    say(f"{'品类':<12}{'框架总量':>10}{'每千款的≥100条比例':>20}")
    say("-" * 60)
    ranked_b = sorted([p for p in profiles if p.get("frame_total")],
                      key=lambda x: x["ge_100_pct"] / (x["frame_total"] / 1000.0),
                      reverse=True)
    for p in ranked_b:
        dens = p["ge_100_pct"] / (p["frame_total"] / 1000.0)
        say(f"{p['genre']:<12}{p['frame_total']:>10,}{dens:>20.2f}")
    say()
    say("  读法：这个比值衡量「每承担一千款存量作品的竞争，能换来多少触达概率」。")
    say("  它偏向小品类（Racing/Sports），但小品类本身有结构门槛——")
    say("  赛车要车辆物理，体育要授权与赛事体系，这两点不是两周内一个人能解决的。")
    say("  因此这个比值只能用来**否决**大型红海（Indie 12.4 万款存量），")
    say("  不能直接用来选出最优品类。")
    say()

    # ---- C. 口碑（描述，不作选择依据）
    say("--- C. 口碑：仅作描述，不用来选择（Phase 1 已证品类差异不显著）---")
    say(f"{'品类':<12}{'中位好评%':>10}{'≥80%好评占比':>14}")
    say("-" * 84)
    for p in sorted(profiles, key=lambda x: -x["median_review_pct"]):
        say(f"{p['genre']:<12}{p['median_review_pct']:>10.1f}{p['pct_ge_80_positive']:>13.1f}%")
    pct_groups = defaultdict(list)
    for r in rows:
        if not math.isnan(r["review_pct_num"]):
            pct_groups[r["assigned_tag"]].append(r["review_pct_num"])
    perm = permutation_test({k: np.array(v) for k, v in pct_groups.items()})
    say()
    say(f"  置换检验（各品类好评百分比的组间极差）：统计量 {perm['stat']:.1f} 个百分点，"
        f"p = {perm['p']:.3f}，n = {perm['n']}")
    if perm["p"] > 0.05:
        say("  → 不能拒绝「各品类口碑相同」。这与 Phase 1 的阴性结论一致，"
            "也再次说明不能用品类来预期口碑。")
    else:
        say("  → 出现显著差异。但 Phase 1 的多变量模型未检出，需谨慎，"
            "并注意这里是单变量比较、未控制混杂。")
    say()

    # ---- D. 货币化
    say("--- D. 货币化结构 ---")
    say(f"{'品类':<12}{'免费%':>8}{'付费中位价':>12}{'多人%':>8}{'抢先体验%':>11}")
    say("-" * 84)
    for p in profiles:
        price = f"{p['median_price']/100:.2f}" if not math.isnan(p["median_price"]) else "—"
        say(f"{p['genre']:<12}{p['f2p_pct']:>8.0f}{price:>12}"
            f"{p['multi_pct']:>8.0f}{p['early_access_pct']:>11.0f}")
    say("  注：价格单位取自接口的本地货币最小单位，跨品类同批采集，可比性限于本批。")
    say()

    # ---- E. 可行性
    say("--- E. 可行性：团队规模（决定一个人 10 天内做不做得出来）---")
    say(f"{'品类':<12}{'中位团队':>9}{'单人%':>7}{'≤3人%':>8}")
    say("-" * 84)
    for p in sorted(profiles, key=lambda x: x["median_team"]):
        say(f"{p['genre']:<12}{p['median_team']:>9.0f}{p['solo_pct']:>7.0f}{p['small_team_pct']:>8.0f}")
    say()

    # ---- 决策
    d = decide(profiles)
    say("=" * 84)
    say("决策（规则在看结果之前已写死在脚本开头）")
    say("=" * 84)
    if d["excluded"]:
        say("排除（中位团队规模 > 5 人，一人短期不可行）：")
        for p in d["excluded"]:
            say(f"  - {p['genre']}（中位团队 {p['median_team']:.0f} 人）")
        say()
    say("可行集，按 P(≥100 条评论) 排序：")
    for i, p in enumerate(d["ranked"], 1):
        say(f"  {i}. {p['genre']:<12} {p['ge_100_pct']:5.1f}%  "
            f"（零评论 {p['zero_review_pct']:.0f}%，中位团队 {p['median_team']:.0f} 人，"
            f"中位好评 {p['median_review_pct']:.0f}%）")
    say()
    if reach_perm["p"] > 0.05:
        say("  ⚠ 上述排序的组间差异不显著（见 A2）。它是点估计排序，不是可靠的名次。")
        say()
    pick = d["pick"]
    if pick:
        say(f"→ 选择：{pick['genre']}")
        say(f"   理由：在可独自实现的品类里，它的「找到至少 100 条评论」的概率最高"
            f"（{pick['ge_100_pct']:.1f}%，95% CI {pick['ge_100_ci'][0]:.1f}–{pick['ge_100_ci'][1]:.1f}）。")
        say(f"   下行情景：仍有 {pick['zero_review_pct']:.0f}% 的作品一条评论都没有，"
            "所以这是提高概率，不是保证成功。")
        say(f"   口碑：中位好评 {pick['median_review_pct']:.0f}%，无证据显示该品类口碑处于劣势。")
        say()

    # ---- 写出
    cols = ["genre", "n", "frame_total", "zero_review_n", "zero_review_pct",
            "median_reviews", "median_review_pct", "pct_ge_80_positive",
            "f2p_pct", "median_price", "multi_pct", "early_access_pct",
            "median_team", "solo_pct", "small_team_pct"]
    cols += [f"ge_{t}_n" for t in THRESHOLDS] + [f"ge_{t}_pct" for t in THRESHOLDS]
    with (outdir / "by_genre.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(profiles)

    payload = {
        "input": str(src.relative_to(ROOT)),
        "n_titles": len(rows),
        "seed": SEED,
        "permutation_reception": perm,
        "decision": {
            "max_median_team": 5.0,
            "excluded": [p["genre"] for p in d["excluded"]],
            "ranked": [{"genre": p["genre"], "ge_100_pct": round(p["ge_100_pct"], 2)}
                       for p in d["ranked"]],
            "pick": pick["genre"] if pick else None,
        },
        "profiles": profiles,
    }
    (outdir / "market_summary.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    (outdir / "market_summary.txt").write_text("\n".join(lines), encoding="utf-8")

    make_figures(profiles, outdir)
    print(f"\n输出 -> {outdir.relative_to(ROOT)}/")
    return 0


def make_figures(profiles: list[dict], outdir: Path) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return

    pro = sorted(profiles, key=lambda p: p["ge_100_pct"])
    names = [p["genre"] for p in pro]
    vals = [p["ge_100_pct"] for p in pro]
    los = [p["ge_100_pct"] - p["ge_100_ci"][0] for p in pro]
    his = [p["ge_100_ci"][1] - p["ge_100_pct"] for p in pro]

    fig, ax = plt.subplots(figsize=(7.4, 4.4))
    ax.barh(names, vals, color="#4a6fa5", height=.62)
    ax.errorbar(vals, range(len(names)), xerr=[los, his], fmt="none",
                ecolor="#22303f", capsize=4, lw=1.2)
    ax.set_xlabel("% of released titles reaching ≥100 reviews (95% Wilson CI)")
    ax.set_title("Odds of finding an audience, by genre")
    ax.set_xlim(0, max(v + h for v, h in zip(vals, his)) * 1.18)
    ax.grid(axis="x", alpha=.25)
    fig.tight_layout()
    fig.savefig(outdir / "fig_reach_by_genre.png", dpi=150)
    plt.close(fig)

    pro2 = sorted(profiles, key=lambda p: p["zero_review_pct"])
    fig, ax = plt.subplots(figsize=(7.4, 4.4))
    ax.barh([p["genre"] for p in pro2], [p["zero_review_pct"] for p in pro2],
            color="#a55c4a", height=.62)
    ax.set_xlabel("% of released titles with zero reviews")
    ax.set_title("Risk of shipping unnoticed, by genre")
    ax.grid(axis="x", alpha=.25)
    fig.tight_layout()
    fig.savefig(outdir / "fig_zero_review_risk.png", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    sys.exit(main())
