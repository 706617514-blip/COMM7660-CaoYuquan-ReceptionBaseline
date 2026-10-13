#!/usr/bin/env python3
"""
test_validate_rules.py — fixture test for the declared exclusion rules R1-R4.

Builds a synthetic raw file containing exactly one defect per rule, runs
validate_data.py over it, and asserts that each defect is attributed to the rule
that is supposed to catch it.

This exists because passing a rule is not the same as the rule being reachable:
a defect injected carelessly can be caught by an earlier rule instead, which
leaves the later rule untested. R4 in particular is only reachable by a record
that satisfies R1-R3 first.

Run:  python analysis/test_validate_rules.py      (exit 0 = all assertions hold)
"""

from __future__ import annotations

import csv
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ["appid", "name", "release_date", "release_quarter", "is_free", "genres",
          "categories", "developers", "publishers", "price_initial", "price_currency",
          "total_positive", "total_negative", "total_reviews", "positive_rate",
          "review_score_desc", "short_description", "assigned_tag", "type"]


def row(**kw) -> dict:
    base = {f: "" for f in FIELDS}
    base.update({"name": "fixture", "release_date": "2025-06-01", "is_free": "False",
                 "total_positive": "80", "total_negative": "20", "total_reviews": "100",
                 "positive_rate": "0.8", "assigned_tag": "Action", "type": "game"})
    base.update(kw)
    return base


FIXTURE = [
    row(appid="1001"),                                              # valid
    row(appid="1001"),                                              # R1 duplicate
    row(appid=""),                                                  # R1 missing appid
    row(appid="1002", release_date="2023-01-01"),                   # R2 outside window
    row(appid="1003", release_date="not a date"),                   # R2 unparseable
    row(appid="1004", total_reviews="10", total_positive="8",
        total_negative="2"),                                        # R3 too few reviews
    row(appid="1005", total_reviews="100", total_positive="0",
        total_negative="0", positive_rate=""),                      # R4 non-positive counts
    row(appid="1006", total_reviews="100", total_positive="70",
        total_negative="20"),                                       # R4 sum mismatch
    row(appid="1007", total_reviews="100", total_positive="110",
        total_negative="-10"),                                      # R4 negative count
]

EXPECTED = {
    "R1 missing appid": 1,
    "R1 duplicate appid": 1,
    "R2 outside 24-month window": 1,
    "R2 unparseable release date": 1,
    "R3 fewer than 50 reviews": 1,
    "R4 non-positive review counts": 2,
    "R4 counts inconsistent with total_reviews": 1,
}


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tmpd = Path(tmp)
        raw = tmpd / "synthetic_rules_raw.csv"
        with raw.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(FIXTURE)

        out = tmpd / "synthetic_rules_clean.csv"
        audit = tmpd / "synthetic_rules_audit.md"
        proc = subprocess.run(
            [sys.executable, str(ROOT / "analysis" / "validate_data.py"),
             "--input", str(raw), "--out", str(out), "--audit", str(audit)],
            capture_output=True, text=True)
        print(proc.stdout.strip())
        if proc.returncode != 0:
            print(proc.stderr.strip(), file=sys.stderr)
            print("FAIL: validator exited non-zero")
            return 1

        text = audit.read_text(encoding="utf-8")
        failures = []
        for rule, count in EXPECTED.items():
            line = f"| {rule} | {count} |"
            if line not in text:
                failures.append(f"expected row not found: {line}")
        if "| Analysed (clean rows) | 1 |" not in text:
            failures.append("expected exactly 1 surviving row")

        # every annotated rule must actually appear somewhere in the audit
        for rule in EXPECTED:
            if rule not in text:
                failures.append(f"rule never reported: {rule}")

        if failures:
            print("\nFAIL")
            for f in failures:
                print(f"  - {f}")
            return 1
        print(f"\nPASS: {len(EXPECTED)} rule attributions verified, 1 row survived")
        return 0


if __name__ == "__main__":
    sys.exit(main())
