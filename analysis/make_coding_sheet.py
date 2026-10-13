#!/usr/bin/env python3
"""
make_coding_sheet.py — build the human feature-coding sheet, and score it afterwards.

Two modes.

BUILD (default)
    Draws a deterministic 20% subsample of the analysis dataset and writes a sheet the PM
    fills in by hand. The sheet contains only the *retrieved store description* and the
    title: no review counts, no positive rate, no review summary, and no provider genre or
    category list.

    Withholding the outcome is what the brief's hide-the-outcome rule asks for: a coder who
    can see that a title is rated "Very Positive" is no longer coding the description.
    Withholding the provider's `categories` list matters for a different reason -- the
    derived `multiplayer_emphasis` label is computed from that list, so showing it would make
    the human pass a copy of the machine label rather than an independent check on it.

SCORE
    After the PM fills the `mp_human` column, compares it with the machine label and reports
    per-title disagreement plus percent agreement and Cohen's kappa. Disagreements are listed
    individually and are not resolved by preference.

Usage
    python analysis/make_coding_sheet.py                       # build 20% sheet
    python analysis/make_coding_sheet.py --frac 0.2 --seed 20261009
    python analysis/make_coding_sheet.py --score records/coding-sheet-round1-filled.csv
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "clean" / "analysis_dataset.csv"


def rel(p: Path) -> str:
    """Path relative to the repository when possible, absolute otherwise."""
    return str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p)

# Columns shown to the coder. Deliberately excludes everything outcome-related and the
# provider category list that the machine label is derived from.
SHEET_COLUMNS = ["appid", "name", "short_description", "mp_human", "coder_notes"]

# Must never appear in a coding sheet.
FORBIDDEN = ["positive_rate", "total_positive", "total_negative", "total_reviews",
             "review_score_desc", "categories", "log_reviews"]

INSTRUCTIONS = """\
# Feature-coding sheet — round 1

Coder: PM (student). One row per title. Fill the `mp_human` column yourself.

**Question for each title.** Reading only the retrieved store description, is the title's
core loop social or competitive — that is, does it depend on other players (multiplayer,
co-op, PvP, MMO, shared/split screen)? Enter `1` for yes, `0` for no.

- Judge the *core loop*, not marketing mentions. "Share your score with friends" is not
  multiplayer; "team up with up to four players" is.
- If the description is genuinely ambiguous, enter `?` and say why in `coder_notes`. An
  ambiguous case is a finding, not a failure.
- Do not look up the game on the store, and do not open the analysis dataset: the whole
  point is that this pass is independent of the machine label and of the outcome.

The outcome columns are withheld on purpose. If you can see a title's rating while coding,
you are coding the rating, not the description.
"""


def load_clean(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(f"missing {path}; run analysis/validate_data.py first")
    return list(csv.DictReader(path.open(encoding="utf-8")))


def build(args: argparse.Namespace) -> int:
    rows = load_clean(Path(args.input) if args.input else CLEAN)
    rows = sorted(rows, key=lambda r: r["appid"])
    n = max(1, round(len(rows) * args.frac))
    rng = random.Random(args.seed)
    sample = sorted(rng.sample(rows, n), key=lambda r: r["appid"])

    out = Path(args.out) if args.out else (ROOT / "records" / "coding-sheet-round1.csv")
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=SHEET_COLUMNS)
        w.writeheader()
        for r in sample:
            w.writerow({
                "appid": r["appid"],
                "name": r["name"],
                "short_description": r.get("short_description", ""),
                "mp_human": "",
                "coder_notes": "",
            })

    leaked = [c for c in FORBIDDEN if c in SHEET_COLUMNS]
    if leaked:
        sys.exit(f"refusing to write a sheet containing outcome/derived columns: {leaked}")

    inst = out.with_suffix(".instructions.md")
    inst.write_text(
        INSTRUCTIONS
        + f"\nSheet: `{out.name}`  \nTitles: {len(sample)} of {len(rows)} "
          f"({args.frac:.0%} subsample, seed {args.seed})  \n"
          f"Build the agreement report afterwards with:\n\n"
          f"    python analysis/make_coding_sheet.py --score {out.name}\n",
        encoding="utf-8")

    print(f"wrote {rel(out)} with {len(sample)} titles "
          f"({args.frac:.0%} of {len(rows)})")
    print(f"instructions -> {rel(inst)}")
    print(f"withheld columns: {', '.join(FORBIDDEN)}")
    return 0


def kappa(pairs: list[tuple[int, int]]) -> float:
    """Cohen's kappa for two binary raters."""
    n = len(pairs)
    if n == 0:
        return float("nan")
    po = sum(1 for a, b in pairs if a == b) / n
    pa1 = sum(a for a, _ in pairs) / n
    pb1 = sum(b for _, b in pairs) / n
    pe = pa1 * pb1 + (1 - pa1) * (1 - pb1)
    if pe == 1:
        return 1.0
    return (po - pe) / (1 - pe)


def score(args: argparse.Namespace) -> int:
    sheet_path = Path(args.score)
    if not sheet_path.is_absolute():
        sheet_path = ROOT / sheet_path
    if not sheet_path.exists():
        sys.exit(f"no such filled sheet: {sheet_path}")

    filled = {r["appid"]: r for r in
              csv.DictReader(sheet_path.open(encoding="utf-8"))}
    clean = {r["appid"]: r for r in load_clean(Path(args.input) if args.input else CLEAN)}

    keep = {k: v for k, v in filled.items() if k in clean}
    missing = sorted(set(filled) - set(clean))
    blank = [k for k, v in keep.items() if (v.get("mp_human") or "").strip() == ""]
    ambiguous = [k for k, v in keep.items() if (v.get("mp_human") or "").strip() == "?"]

    pairs: list[tuple[int, int]] = []
    disagree: list[tuple[str, str, str, str]] = []
    for k, v in sorted(keep.items()):
        raw = (v.get("mp_human") or "").strip()
        if raw not in ("0", "1"):
            continue
        human = int(raw)
        machine = int(clean[k]["multiplayer_emphasis"])
        pairs.append((human, machine))
        if human != machine:
            disagree.append((k, clean[k]["name"], str(machine), str(human)))

    n = len(pairs)
    if n == 0:
        sys.exit(f"no codeable rows in {sheet_path.name} "
                 f"({len(blank)} blank, {len(ambiguous)} ambiguous)")

    agree = sum(1 for a, b in pairs if a == b)
    k = kappa(pairs)

    lines = [
        "# Coding agreement report",
        "",
        "Generated by `analysis/make_coding_sheet.py --score`. Compares the PM's independent",
        "reading of the retrieved store description against the code-derived",
        "`multiplayer_emphasis` label (built from the provider's `categories` list).",
        "",
        "## Coverage",
        "",
        "| Property | Value |",
        "|---|---|",
        f"| Sheet | `{sheet_path.name}` |",
        f"| Rows in sheet | {len(filled)} |",
        f"| Codeable rows compared | {n} |",
        f"| Blank `mp_human` | {len(blank)} |",
        f"| Marked ambiguous (`?`) | {len(ambiguous)} |",
        f"| In sheet but not in dataset | {len(missing)} |",
        "",
        "## Agreement",
        "",
        "| Property | Value |",
        "|---|---|",
        f"| Agreeing rows | {agree} of {n} ({agree / n:.1%}) |",
        f"| Cohen's kappa | {k:.3f} |",
        "",
        "## Disagreements",
        "",
    ]
    if disagree:
        lines += ["| appid | title | machine | human |", "|---|---|---|---|"]
        lines += [f"| {a} | {b} | {m} | {h} |" for a, b, m, h in disagree]
        lines += ["", "Each row is inspected individually. Where the description supports the "
                      "human reading, the machine label is a false negative, and that is "
                      "reported as a limitation on the feature rather than corrected in "
                      "silence."]
    else:
        lines.append("None. The two passes agree on every codeable row.")

    if ambiguous:
        lines += ["", "## Rows marked ambiguous", "", 
                  "| appid | title | coder note |", "|---|---|---|"]
        lines += [f"| {a} | {clean[a]['name']} | "
                  f"{(filled[a].get('coder_notes') or '').replace('|', '/')} |"
                  for a in sorted(ambiguous) if a in clean]

    out = Path(args.out) if args.out else (ROOT / "records" / "coding-agreement.md")
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"compared {n} rows: agreement {agree / n:.1%}, kappa {k:.3f}")
    print(f"disagreements: {len(disagree)}")
    print(f"-> {rel(out)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=None, help="clean dataset (default data/clean/...)")
    ap.add_argument("--out", default=None, help="sheet path for BUILD mode")
    ap.add_argument("--frac", type=float, default=0.20, help="subsample fraction")
    ap.add_argument("--seed", type=int, default=20261009)
    ap.add_argument("--score", default=None,
                    help="path to a filled sheet; switches to SCORE mode")
    args = ap.parse_args()
    return score(args) if args.score else build(args)


if __name__ == "__main__":
    sys.exit(main())
