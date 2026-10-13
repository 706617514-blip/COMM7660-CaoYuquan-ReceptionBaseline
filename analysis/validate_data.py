#!/usr/bin/env python3
"""
validate_data.py — clean the collected title-level records and emit the analysis dataset.

Reads the newest data/raw/steam_titles_*.csv (or a path given with --input) and writes:
  - data/clean/analysis_dataset.csv   one row per title
  - records/extraction-audit.md       retrieved / excluded / analysed counts

Declared rules, applied in this order and fixed before the outcome is examined:
  R1  exactly one row per appid (duplicates removed, counted)
  R2  release date must fall inside the 24-month window
  R3  total_reviews must be at least MIN_REVIEWS
  R4  the outcome must be computable from consistent counts
  R5  release quarter, age in years, and log review count derived

Nothing is dropped silently. Every exclusion is attributed to a rule and counted.

Synthetic-data guard: a file whose name starts with `synthetic_` may only be written
to an output path that also starts with `synthetic_`, so test fixtures can never
overwrite the analysis dataset.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import math
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CLEAN = ROOT / "data" / "clean"
RECORDS = ROOT / "records"

CUTOFF = date(2026, 10, 9)
MIN_REVIEWS = 50
SEED = 20261009

# Markers in the provider's own `categories` list that identify a social or
# competitive core loop. Matched as substrings, so the list stays short:
# "Co-op" covers "Online Co-op"/"Shared/Split Screen Co-op", and "PvP" covers
# "Online PvP"/"LAN PvP".
MULTIPLAYER_MARKERS = ("Multi-player", "Co-op", "PvP", "MMO", "Shared/Split Screen")


def latest(pattern: str) -> Path:
    hits = sorted(RAW.glob(pattern))
    if not hits:
        sys.exit(f"no file matching {pattern} in {RAW}")
    return hits[-1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=None,
                    help="raw CSV to clean (default: newest steam_titles_*.csv in data/raw)")
    ap.add_argument("--out", default=None,
                    help="clean CSV to write (default: data/clean/analysis_dataset.csv)")
    ap.add_argument("--audit", default=None,
                    help="audit markdown to write (default: records/extraction-audit.md)")
    args = ap.parse_args()

    src = Path(args.input) if args.input else latest("steam_titles_*.csv")
    if not src.is_absolute():
        src = (ROOT / src).resolve()
    if not src.exists():
        sys.exit(f"no such input file: {src}")

    synthetic = src.name.startswith("synthetic_")
    out = Path(args.out) if args.out else (CLEAN / "analysis_dataset.csv")
    audit_path = Path(args.audit) if args.audit else (RECORDS / "extraction-audit.md")
    if not out.is_absolute():
        out = ROOT / out
    if not audit_path.is_absolute():
        audit_path = ROOT / audit_path
    if synthetic and not out.name.startswith("synthetic_"):
        sys.exit(f"refusing to write synthetic input {src.name} to non-synthetic "
                 f"output {out.name}")

    rows = list(csv.DictReader(src.open(encoding="utf-8")))
    excluded: Counter = Counter()
    kept: list[dict] = []
    seen: set[str] = set()
    window_start = date(CUTOFF.year - 2, CUTOFF.month, CUTOFF.day)

    for r in rows:
        appid = (r.get("appid") or "").strip()

        # R1 — one row per title
        if not appid:
            excluded["R1 missing appid"] += 1
            continue
        if appid in seen:
            excluded["R1 duplicate appid"] += 1
            continue
        seen.add(appid)

        # R2 — inside the release window
        try:
            rdate = date.fromisoformat(r["release_date"])
        except (ValueError, KeyError, TypeError):
            excluded["R2 unparseable release date"] += 1
            continue
        if not (window_start <= rdate <= CUTOFF):
            excluded["R2 outside 24-month window"] += 1
            continue

        # R3 — minimum review count
        try:
            n = int(r["total_reviews"])
        except (ValueError, KeyError, TypeError):
            excluded["R3 unparseable review count"] += 1
            continue
        if n < MIN_REVIEWS:
            excluded[f"R3 fewer than {MIN_REVIEWS} reviews"] += 1
            continue

        # R4 — outcome computable from counts that agree with each other.
        # A record can pass R3 and still be unusable here, so this check is not
        # redundant: it catches source records whose totals do not add up.
        try:
            pos, neg = int(r["total_positive"]), int(r["total_negative"])
        except (ValueError, KeyError, TypeError):
            excluded["R4 unparseable review counts"] += 1
            continue
        if pos < 0 or neg < 0 or pos + neg == 0:
            excluded["R4 non-positive review counts"] += 1
            continue
        if pos + neg != n:
            excluded["R4 counts inconsistent with total_reviews"] += 1
            continue
        rate = pos / (pos + neg)
        if not (0.0 <= rate <= 1.0):
            excluded["R4 rate outside [0,1]"] += 1
            continue

        # R5 — derived fields
        age_years = (CUTOFF - rdate).days / 365.25
        q = f"{rdate.year}-Q{(rdate.month - 1) // 3 + 1}"

        kept.append({
            "appid": appid,
            "name": r.get("name", ""),
            "release_date": rdate.isoformat(),
            "release_quarter": q,
            "release_year": rdate.year,
            "age_years": round(age_years, 4),
            "assigned_tag": r.get("assigned_tag", ""),
            "is_free": 1 if str(r.get("is_free", "")).lower() in ("true", "1") else 0,
            "price_initial": r.get("price_initial") or "",
            "price_currency": r.get("price_currency") or "",
            "total_positive": pos,
            "total_negative": neg,
            "total_reviews": n,
            "log_reviews": round(math.log1p(n), 6),
            "positive_rate": round(rate, 6),
            "review_score_desc": r.get("review_score_desc", ""),
            "genres": r.get("genres", ""),
            "categories": r.get("categories", ""),
            "genre_count": len([g for g in r.get("genres", "").split("|") if g]),
            "coded_early_access": 1 if "Early Access" in r.get("genres", "") else 0,
            "multiplayer_emphasis": 1 if any(m in r.get("categories", "")
                                             for m in MULTIPLAYER_MARKERS) else 0,
            "short_description": r.get("short_description", ""),
        })

    if not kept:
        sys.exit("no rows survived validation; nothing written")

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(kept[0].keys()))
        w.writeheader()
        w.writerows(kept)

    digest = hashlib.sha256(out.read_bytes()).hexdigest()

    by_q = Counter(r["release_quarter"] for r in kept)
    by_tag = Counter(r["assigned_tag"] for r in kept)
    rates = sorted(r["positive_rate"] for r in kept)
    n_kept = len(rates)
    mean = sum(rates) / n_kept
    sd = (sum((x - mean) ** 2 for x in rates) / n_kept) ** 0.5
    mult = sum(1 for r in kept if r["genre_count"] > 1)

    audit = f"""# Extraction audit

Generated by `analysis/validate_data.py`. Source: `{src.name}`
{"**Synthetic fixture — software test only. Not evidence for any conclusion.**" if synthetic else ""}

## Counts

| Stage | Count |
|---|---|
| Retrieved (raw rows) | {len(rows)} |
| Analysed (clean rows) | {len(kept)} |
| Excluded | {sum(excluded.values())} |

## Exclusions by rule

| Rule | Count |
|---|---|
""" + "".join(f"| {k} | {v} |\n" for k, v in sorted(excluded.items())) + f"""
## Sample composition

| Property | Value |
|---|---|
| Titles analysed | {len(kept)} |
| Outcome mean | {mean:.4f} |
| Outcome sd | {sd:.4f} |
| Outcome min / max | {rates[0]:.4f} / {rates[-1]:.4f} |
| Free-to-play titles | {sum(r['is_free'] for r in kept)} |
| Multi-player / co-op emphasis | {sum(r['multiplayer_emphasis'] for r in kept)} ({sum(r['multiplayer_emphasis'] for r in kept) / len(kept):.1%}) |
| Early Access titles | {sum(r['coded_early_access'] for r in kept)} |
| Multi-label titles (genre_count > 1) | {mult} ({mult / len(kept):.1%}) |
| Earliest release | {min(r['release_date'] for r in kept)} |
| Latest release | {max(r['release_date'] for r in kept)} |

## Release quarters

| Quarter | Titles |
|---|---|
""" + "".join(f"| {k} | {v} |\n" for k, v in sorted(by_q.items())) + f"""
## Assigned sampling tag

| Tag | Titles |
|---|---|
""" + "".join(f"| {k} | {v} |\n" for k, v in by_tag.most_common()) + f"""
## Integrity

| Property | Value |
|---|---|
| Dataset file | `{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}` |
| SHA-256 | `{digest}` |
| Random seed | {SEED} |
| Minimum reviews applied | {MIN_REVIEWS} |
| Cutoff | {CUTOFF.isoformat()} |
| Window | {window_start.isoformat()} to {CUTOFF.isoformat()} |
| Synthetic input | {"yes" if synthetic else "no"} |

## Notes

- Multi-label titles are retained. The sampling tag records provenance; the `genres` field
  records the provider's labels. Coding rules for multi-label cases are defined in the codebook.
- The outcome is a proportion over reviewers, so reviewers are a self-selected subset of players.
- An excluded title is unobserved, not a zero.
- R4 is not redundant with R3: a record whose `total_reviews` clears the threshold while
  `total_positive + total_negative` disagrees is caught only by R4.
"""
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(audit, encoding="utf-8")

    print(f"analysed {len(kept)} titles (from {len(rows)} raw)")
    print(f"excluded {sum(excluded.values())}: {dict(excluded)}")
    print(f"outcome mean={mean:.4f} sd={sd:.4f} range={rates[0]:.4f}-{rates[-1]:.4f}")
    print(f"quarters: {dict(sorted(by_q.items()))}")
    print(f"free-to-play: {sum(r['is_free'] for r in kept)}")
    print(f"sha256: {digest}")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
