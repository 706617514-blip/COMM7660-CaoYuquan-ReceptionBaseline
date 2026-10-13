#!/usr/bin/env python3
"""
analyze_and_report.py — execute the approved specification on the frozen dataset.

Specification (docs/statistical-spec.md):
    positive_rate ~ is_free + age_years + age_years^2 + C(assigned_tag) + log_reviews

Estimated as a fractional logit (GLM binomial with a logit link), which keeps fitted
values inside [0,1] without transforming the outcome. Reported effects are converted
to the probability scale, because a logit coefficient is not interpretable to a
product audience on its own.

Outputs:
  analysis/results/model_summary.txt
  analysis/results/coefficients.csv
  analysis/results/table1_descriptives.csv
  analysis/results/fig1_outcome_distribution.png
  analysis/results/fig2_rate_by_business_model.png
  analysis/results/fig3_model_contrast.png
  docs/results.md

This script does not choose the model. If the specification does not fit, it reports
that and stops rather than substituting a different one.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import math
import sys
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "clean" / "analysis_dataset.csv"
OUT = ROOT / "analysis" / "results"
SEED = 20261009


def rel(p: Path) -> str:
    """Path relative to the repository when possible, absolute otherwise."""
    return str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p)

try:
    import pandas as pd
    import statsmodels.api as sm
    import statsmodels.formula.api as smf
except ImportError as exc:                                   # noqa: BLE001
    sys.exit(f"missing dependency: {exc}. Run: pip install -r requirements.txt")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAVE_PLOT = True
except ImportError:
    HAVE_PLOT = False

FORMULA = "positive_rate ~ is_free + age_years + I(age_years**2) + C(assigned_tag) + log_reviews"

# Model 2 is not an alternative chosen after seeing results. Both specifications are
# declared in docs/statistical-spec.md before execution and both are always reported.
# Model 2 is the one that carries the gameplay feature the brief requires.
FORMULA_2 = FORMULA + " + multiplayer_emphasis"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=None,
                    help="clean dataset to analyse (default: data/clean/analysis_dataset.csv)")
    ap.add_argument("--out", default=None,
                    help="results directory (default: analysis/results)")
    args = ap.parse_args()

    data_path = Path(args.input) if args.input else DATA
    if not data_path.is_absolute():
        data_path = (ROOT / data_path).resolve()
    out_dir = Path(args.out) if args.out else OUT
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir

    if not data_path.exists():
        sys.exit(f"missing {data_path}; run analysis/validate_data.py first")
    out_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(data_path.read_bytes()).hexdigest()
    df = pd.read_csv(data_path)
    np.random.seed(SEED)

    lines: list[str] = []
    def say(s: str = "") -> None:
        print(s, flush=True)
        lines.append(s)

    say("=" * 72)
    say("COMM7660 Phase 1 — executed analysis")
    say("=" * 72)
    say(f"input            : {rel(data_path)}")
    say(f"input sha256     : {digest}")
    say(f"software         : pandas {pd.__version__}, statsmodels {sm.__version__}, numpy {np.__version__}")
    say(f"random seed      : {SEED}")
    say(f"formula          : {FORMULA}")
    say()

    # ---- data quality -------------------------------------------------
    say("--- data quality ---")
    say(f"analyse titles   : {len(df)}")
    say(f"duplicated appid : {df['appid'].duplicated().sum()}")
    say(f"missing values   : {int(df.isna().sum().sum())}")
    say(f"outcome range    : {df.positive_rate.min():.4f} .. {df.positive_rate.max():.4f}")
    say(f"outcome mean/sd  : {df.positive_rate.mean():.4f} / {df.positive_rate.std(ddof=1):.4f}")
    say(f"free-to-play     : {int(df.is_free.sum())} of {len(df)}")
    say(f"quarters covered : {df.release_quarter.nunique()}")
    say()

    # ---- descriptives -------------------------------------------------
    # reindex to [0, 1] and then label, so the table keeps a stable row order and
    # still renders when one of the two groups is absent from the sample.
    desc = (df.groupby("is_free")["positive_rate"]
              .agg(["count", "mean", "std", "median"])
              .reindex([0, 1]))
    desc.index = ["paid", "free-to-play"]
    desc.index.name = "group"           # named so downstream readers get a labelled column
    desc["mean_pct"] = (desc["mean"] * 100).round(2)
    desc.to_csv(out_dir / "table1_descriptives.csv")
    say("--- outcome by business model ---")
    for idx, row in desc.iterrows():
        if pd.isna(row["count"]) or row["count"] == 0:
            say(f"  {idx:<14} n=   0  (no titles in this group)")
            continue
        sd_txt = "n/a" if pd.isna(row["std"]) else f"{row['std']:.4f}"
        say(f"  {idx:<14} n={int(row['count']):>4}  mean={row['mean']:.4f}  "
            f"median={row['median']:.4f}  sd={sd_txt}")
    say()

    tag_summary = (df.groupby("assigned_tag")["positive_rate"]
                     .agg(["count", "mean", "median"])
                     .sort_values("mean", ascending=False))
    say("--- outcome by sampling tag ---")
    for idx, row in tag_summary.iterrows():
        say(f"  {idx:<14} n={int(row['count']):>4}  mean={row['mean']:.4f}")
    say()

    # ---- fit ----------------------------------------------------------
    say("--- model fit ---")
    try:
        model = smf.glm(FORMULA, data=df, family=sm.families.Binomial()).fit()
    except Exception as exc:                                  # noqa: BLE001
        sys.exit(f"model failed to fit: {exc}")
    say(model.summary().as_text())
    say()

    # ---- diagnostics ---------------------------------------------------
    say("--- diagnostics ---")
    infl = model.get_influence()
    cooks = infl.cooks_distance[0]
    n_big = int((cooks > 4 / len(df)).sum())
    say(f"influential titles (Cook's D > 4/n) : {n_big}")
    if n_big:
        worst = np.argsort(cooks)[-5:][::-1]
        for i in worst:
            say(f"    appid={df.iloc[i]['appid']} {str(df.iloc[i]['name'])[:34]:<34} D={cooks[i]:.4f}")
    pearson_chi2 = model.pearson_chi2
    dof = model.df_resid
    disp = pearson_chi2 / dof
    say(f"Pearson chi2 / dof (dispersion)     : {disp:.3f}")
    if disp > 2:
        say("    -> overdispersion present; standard errors may be understated")
    else:
        say("    -> no strong evidence of overdispersion")
    cats = df.assigned_tag.value_counts()
    say(f"sparse categories (<10 titles)      : {(cats < 10).sum()}")
    say()

    # ---- coefficients, converted to the probability scale --------------
    prob = model.get_margeff(at="overall")
    coef_rows = []
    for name in model.params.index:
        p = model.params[name]
        se = model.bse[name]
        lo, hi = model.conf_int().loc[name]
        est = float(math.exp(p)) if name != "Intercept" else float("nan")
        coef_rows.append({
            "term": name,
            "logit_coef": round(float(p), 6),
            "std_error": round(float(se), 6),
            "z": round(float(model.tvalues[name]), 4),
            "p_value": round(float(model.pvalues[name]), 6),
            "odds_ratio": None if math.isnan(est) else round(est, 4),
            "ci_low_logit": round(float(lo), 6),
            "ci_high_logit": round(float(hi), 6),
        })
    with (out_dir / "coefficients.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(coef_rows[0].keys()))
        w.writeheader()
        w.writerows(coef_rows)
    say("--- coefficients (logit scale, with odds ratios) ---")
    for r in coef_rows:
        if r["term"] == "Intercept":
            continue
        ors = "" if r["odds_ratio"] is None else f"  OR={r['odds_ratio']:.3f}"
        say(f"  {r['term']:<34} b={r['logit_coef']:>9.4f}  se={r['std_error']:.4f}  p={r['p_value']:.4f}{ors}")
    say()
    say("--- marginal effects (probability scale) ---")
    me = prob.summary_frame()
    say(me.to_string())
    me.to_csv(out_dir / "marginal_effects.csv")
    say()

    # ---- sensitivity ---------------------------------------------------
    say("--- sensitivity analysis 1: unweighted vs review-weighted ---")
    try:
        m_w = smf.glm(FORMULA, data=df, family=sm.families.Binomial(),
                      freq_weights=df["total_reviews"]).fit()
        for name in ["is_free", "age_years"]:
            if name in model.params.index and name in m_w.params.index:
                say(f"  {name:<12} unweighted b={model.params[name]:+.4f}   weighted b={m_w.params[name]:+.4f}")
    except Exception as exc:                                  # noqa: BLE001
        say(f"  weighted fit unavailable: {exc}")
    say()

    say("--- sensitivity analysis 2: excluding titles under 6 months old ---")
    settled = df[df.age_years >= 0.5]
    say(f"  titles retained: {len(settled)} of {len(df)}")
    if len(settled) >= 30:
        m_s = smf.glm(FORMULA, data=settled, family=sm.families.Binomial()).fit()
        for name in ["is_free", "age_years"]:
            if name in model.params.index and name in m_s.params.index:
                say(f"  {name:<12} full b={model.params[name]:+.4f}   settled b={m_s.params[name]:+.4f}")
    else:
        say("  too few settled titles to refit")
    say()

    # ---- model 2: the specification carrying the gameplay feature --------
    say("--- model 2: gameplay feature ---")
    say(f"formula          : {FORMULA_2}")
    if "multiplayer_emphasis" not in df.columns:
        say("  multiplayer_emphasis absent from the dataset; model 2 not fitted")
    elif df.multiplayer_emphasis.nunique() < 2:
        say("  multiplayer_emphasis is constant in this sample; model 2 not identified")
    else:
        n_mp = int(df.multiplayer_emphasis.sum())
        say(f"  multi-player / co-op emphasis : {n_mp} of {len(df)} titles "
            f"({n_mp / len(df):.1%})")
        grp = (df.groupby("multiplayer_emphasis")["positive_rate"]
                 .agg(["count", "mean", "median"])
                 .reindex([0, 1]))
        for lab, idx in (("single-player-led", 0), ("multiplayer-led", 1)):
            r_ = grp.loc[idx]
            if pd.isna(r_["count"]) or r_["count"] == 0:
                say(f"    {lab:<20} n=   0")
                continue
            say(f"    {lab:<20} n={int(r_['count']):>4}  mean={r_['mean']:.4f}  "
                f"median={r_['median']:.4f}")
        grp.index.name = "multiplayer_emphasis"
        grp.to_csv(out_dir / "table2_by_gameplay_feature.csv")
        try:
            m2 = smf.glm(FORMULA_2, data=df, family=sm.families.Binomial()).fit()
            say("")
            say(m2.summary().as_text())
            rows2 = []
            for name in m2.params.index:
                lo, hi = m2.conf_int().loc[name]
                rows2.append({
                    "term": name,
                    "logit_coef": round(float(m2.params[name]), 6),
                    "std_error": round(float(m2.bse[name]), 6),
                    "z": round(float(m2.tvalues[name]), 4),
                    "p_value": round(float(m2.pvalues[name]), 6),
                    "ci_low_logit": round(float(lo), 6),
                    "ci_high_logit": round(float(hi), 6),
                })
            with (out_dir / "coefficients_model2.csv").open("w", newline="",
                                                           encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows2[0].keys()))
                w.writeheader()
                w.writerows(rows2)
            # how much does carrying the feature move the focal estimates?
            for name in ("is_free", "age_years"):
                if name in model.params.index and name in m2.params.index:
                    say(f"  focal move {name:<12} model1 b={model.params[name]:+.4f}   "
                        f"model2 b={m2.params[name]:+.4f}")
            if "multiplayer_emphasis" in m2.params.index:
                say(f"  multiplayer_emphasis     b={m2.params['multiplayer_emphasis']:+.4f}  "
                    f"se={m2.bse['multiplayer_emphasis']:.4f}  "
                    f"p={m2.pvalues['multiplayer_emphasis']:.4f}")
        except Exception as exc:                              # noqa: BLE001
            say(f"  model 2 failed to fit: {exc}")
    say()

    (out_dir / "model_summary.txt").write_text("\n".join(lines), encoding="utf-8")

    # ---- figures -------------------------------------------------------
    if HAVE_PLOT:
        fig, ax = plt.subplots(figsize=(7, 4.2))
        ax.hist(df.positive_rate, bins=20, color="#4b6cb7", edgecolor="white")
        ax.set_xlabel("Positive review rate")
        ax.set_ylabel("Number of titles")
        ax.set_title(f"Distribution of the outcome (n={len(df)} titles)")
        fig.tight_layout(); fig.savefig(out_dir / "fig1_outcome_distribution.png", dpi=150); plt.close(fig)

        fig, ax = plt.subplots(figsize=(6, 4.2))
        paid = df.loc[df.is_free == 0, "positive_rate"]
        free = df.loc[df.is_free == 1, "positive_rate"]
        ax.boxplot([paid, free], tick_labels=[f"Paid (n={len(paid)})", f"F2P (n={len(free)})"])
        ax.set_ylabel("Positive review rate")
        ax.set_title("Outcome by business model")
        fig.tight_layout(); fig.savefig(out_dir / "fig2_rate_by_business_model.png", dpi=150); plt.close(fig)

        # model-based contrast with uncertainty: predicted rate at paid vs F2P, other vars held
        fig, ax = plt.subplots(figsize=(6, 4.2))
        preds, los, his, labels = [], [], [], []
        for val, lab in ((0, "Paid"), (1, "Free-to-play")):
            sub = df.copy(); sub["is_free"] = val
            pr = model.get_prediction(sub).summary_frame()
            preds.append(float(pr["mean"].mean()))
            los.append(float(pr["mean_ci_lower"].mean()))
            his.append(float(pr["mean_ci_upper"].mean()))
            labels.append(lab)
        x = np.arange(len(labels))
        ax.errorbar(x, preds, yerr=[np.array(preds) - np.array(los), np.array(his) - np.array(preds)],
                    fmt="o", capsize=6, color="#2f4858")
        ax.set_xticks(x); ax.set_xticklabels(labels)
        ax.set_ylabel("Predicted positive rate")
        ax.set_title("Model-based contrast with 95% intervals")
        fig.tight_layout(); fig.savefig(out_dir / "fig3_model_contrast.png", dpi=150); plt.close(fig)
        say(f"figures written to {rel(out_dir)}")
    else:
        say("matplotlib unavailable; figures skipped")

    print(f"\noutputs -> {out_dir}")
    return 0


if __name__ == "__main__":
    warnings.filterwarnings("ignore")
    sys.exit(main())
