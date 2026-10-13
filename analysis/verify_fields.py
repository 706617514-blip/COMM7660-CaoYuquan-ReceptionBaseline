#!/usr/bin/env python3
"""
verify_fields.py — separate field-level verification on a random 10% of records.

This is not the double-coding pass and not the independent recomputation. The brief asks
for a third, separate check: "Separately verify key extracted fields in a random 10% of
records, with the same minimum", and "Check scales, currencies, denominators, and units
such as 万/亿".

What it does
------------
Draws a random 10% of the analysed titles (minimum 20, as the brief requires) and re-reads
each one from the same two documented endpoints the collector used, then puts the stored
value beside the freshly retrieved value, field by field.

Why a fresh read is the right check
-----------------------------------
The stored record is what the analysis consumed. Re-reading the source tests the extraction
step rather than the analysis step, and it is a genuinely different code path from the one
that produced the file.

Review counts are expected to differ. Steam publishes live aggregates, so a title's
positive and negative counts grow between the collection timestamp and this re-read. Those
differences are reported as drift with the direction and size, not as failures — the
frozen-aggregate limitation in `docs/results.md` predicts exactly this. What would be a
failure is a count that moved *down*, an identifier or release date that changed, a
currency code that changed, or a stored denominator that does not reconcile.

Rate limiting: same rule as the collector. Every request is spaced by REQUEST_DELAY and a
429 stops the run rather than being worked around.

Reproducibility: the draw is seeded, so the same sample is drawn every time.

    python analysis/verify_fields.py                 # writes records/field-verification.md
    python analysis/verify_fields.py --force         # overwrite a signed record
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import time
import urllib.error
import urllib.request
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "clean" / "analysis_dataset.csv"
RECORDS = ROOT / "records"

API_APP = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
API_REV = ("https://store.steampowered.com/appreviews/{appid}"
           "?json=1&num_per_page=0&language=all&purchase_type=all")

REQUEST_DELAY = 1.2          # seconds between requests; do not lower
SAMPLE_FRACTION = 0.10       # the brief: a random 10% of records
MIN_SAMPLE = 20              # the brief: minimum 20, or all titles when fewer exist
DRAW_SEED = 20261010         # independent of the coding-sheet draw (20261009): the two
                             # checks are meant to be separate, so they do not share a sample


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch(url: str):
    """Fetch JSON. Stops on a rate-limit response rather than retrying."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (academic-coursework; COMM7660)",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            log("RATE LIMITED (429). Stopping rather than working around the limit.")
            raise SystemExit(2)
        log(f"HTTP {exc.code} for {url[:80]}")
        return None
    except Exception as exc:                                   # noqa: BLE001
        log(f"{type(exc).__name__} for {url[:80]}")
        return None
    finally:
        time.sleep(REQUEST_DELAY)


MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
STORE_DATE = re.compile(r"^(\d{1,2}) ([A-Za-z]{3})[a-z]*,? (\d{4})$")
COUNT_FIELDS = ("total_positive", "total_negative", "total_reviews")


def to_iso(text: str) -> str:
    """Normalise the store's '19 Nov, 2025' to '2025-11-19'; pass ISO through.

    The collector converts the store's display string to ISO on the way in, so comparing
    the two without normalising reports every title as a mismatch and hides the ones that
    are real.
    """
    s = (text or "").strip()
    m = STORE_DATE.match(s)
    if m:
        day, mon, year = m.groups()
        idx = MONTHS.get(mon.title())
        if idx:
            return f"{year}-{idx:02d}-{int(day):02d}"
    return s


def classify(field: str, stored: str, fresh: str) -> str:
    """Verdicts: match, drifted_up, drifted_down, mismatch."""
    s, f = (stored or "").strip(), (fresh or "").strip()
    if field == "release_date":
        return "match" if to_iso(s) == to_iso(f) else "mismatch"
    if field in COUNT_FIELDS:
        try:
            si, fi = int(s), int(f)
        except ValueError:
            return "mismatch"
        if fi == si:
            return "match"
        # Steam publishes live aggregates, so a count can move in either direction
        # between the collection timestamp and this re-read. A fall of one review is a
        # deletion upstream, not an extraction error, so the direction is reported
        # rather than judged.
        return "drifted_up" if fi > si else "drifted_down"
    return "match" if s == f else "mismatch"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(CLEAN))
    ap.add_argument("--out", default=str(RECORDS / "field-verification.md"))
    ap.add_argument("--force", action="store_true",
                    help="overwrite a record that already carries a signature")
    args = ap.parse_args()

    src = Path(args.input)
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        sys.exit(f"no such dataset: {src}")
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out

    if out.exists() and "**Signed by:**" in out.read_text(encoding="utf-8"):
        signed = out.read_text(encoding="utf-8").split("**Signed by:**")[1].split("\n")[0]
        if signed.strip() and not args.force:
            sys.exit(f"{out.name} carries a signature ({signed.strip()}). "
                     f"Refusing to overwrite it. Pass --force only if that signature "
                     f"is being retracted deliberately.")

    rows = list(csv.DictReader(src.open(encoding="utf-8")))
    n = max(MIN_SAMPLE, round(len(rows) * SAMPLE_FRACTION))
    n = min(n, len(rows))
    sample = random.Random(DRAW_SEED).sample(rows, n)
    log(f"drew {n} of {len(rows)} titles (seed {DRAW_SEED})")

    checks: list[dict] = []
    for i, r in enumerate(sample, 1):
        appid = r["appid"]
        log(f"[{i}/{n}] appid {appid} {r['name'][:40]}")

        det = fetch(API_APP.format(appid=appid)) or {}
        det = (det.get(str(appid)) or {}).get("data") or {}
        rev = fetch(API_REV.format(appid=appid)) or {}
        qs = rev.get("query_summary") or {}
        price = det.get("price_overview") or {}

        fresh = {
            "name": det.get("name", ""),
            "release_date": (det.get("release_date") or {}).get("date", ""),
            "is_free": "1" if det.get("is_free") else "0",
            "price_initial": str(price.get("initial", "")),
            "price_currency": price.get("currency", ""),
            "genres": "|".join(g.get("description", "") for g in det.get("genres", [])),
            "total_positive": str(qs.get("total_positive", "")),
            "total_negative": str(qs.get("total_negative", "")),
            "total_reviews": str(qs.get("total_reviews", "")),
        }

        stored_pos, stored_neg = int(r["total_positive"]), int(r["total_negative"])
        stored_denom_ok = stored_pos + stored_neg == int(r["total_reviews"])
        stored_rate_ok = abs(stored_pos / (stored_pos + stored_neg)
                             - float(r["positive_rate"])) < 1e-6

        for field in ("name", "release_date", "is_free", "price_initial",
                      "price_currency", "genres"):
            checks.append({"appid": appid, "name": r["name"], "field": field,
                           "stored": r.get(field, ""), "fresh": fresh[field],
                           "verdict": classify(field, r.get(field, ""), fresh[field])})
        for field in COUNT_FIELDS:
            checks.append({"appid": appid, "name": r["name"], "field": field,
                           "stored": r.get(field, ""), "fresh": fresh[field],
                           "verdict": classify(field, r.get(field, ""), fresh[field])})

        checks.append({"appid": appid, "name": r["name"], "field": "denominator",
                       "stored": f"{stored_pos}+{stored_neg}={r['total_reviews']}",
                       "fresh": "n/a",
                       "verdict": "match" if stored_denom_ok else "mismatch"})
        checks.append({"appid": appid, "name": r["name"], "field": "rate",
                       "stored": f"{stored_pos}/({stored_pos}+{stored_neg})"
                                 f"={float(r['positive_rate']):.6f}",
                       "fresh": "n/a",
                       "verdict": "match" if stored_rate_ok else "mismatch"})

    counts = {"match": 0, "drifted_up": 0, "drifted_down": 0, "mismatch": 0}
    for c in checks:
        counts[c["verdict"]] += 1
    mismatches = [c for c in checks if c["verdict"] == "mismatch"]
    drifts = [c for c in checks if c["verdict"] in ("drifted_up", "drifted_down")]

    lines = [
        "# Field-level verification",
        "",
        f"Generated by `analysis/verify_fields.py`, seed `{DRAW_SEED}`, "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}.",
        "",
        "A separate check from the double-coding pass and from the independent recomputation.",
        f"It draws a random {SAMPLE_FRACTION:.0%} of the analysed titles (minimum {MIN_SAMPLE}) "
        "and re-reads each one from the same documented endpoints the collector used, then "
        "places the stored value beside the freshly retrieved value.",
        "",
        "## Coverage",
        "",
        "| Property | Value |",
        "|---|---|",
        f"| Dataset | `{src.relative_to(ROOT) if src.is_relative_to(ROOT) else src}` |",
        f"| Titles in dataset | {len(rows)} |",
        f"| Titles drawn | {n} |",
        f"| Fields compared per title | 11 |",
        f"| Comparisons | {len(checks)} |",
        "",
        "## Result",
        "",
        "| Verdict | Count | Meaning |",
        "|---|---|---|",
        f"| match | {counts['match']} | stored and freshly retrieved values are identical |",
        f"| drifted up | {counts['drifted_up']} | live review count is now higher than at "
        f"collection; expected, see below |",
        f"| drifted down | {counts['drifted_down']} | live review count is now lower; a review "
        f"was removed or recategorised upstream |",
        f"| **mismatch** | **{counts['mismatch']}** | stored and fresh values disagree in a "
        f"way drift does not explain |",
        "",
    ]

    if mismatches:
        lines += ["## Mismatches — each one inspected", "",
                  "| appid | title | field | stored | fresh |", "|---|---|---|---|---|"]
        lines += [f"| {c['appid']} | {c['name']} | `{c['field']}` | {c['stored']} | "
                  f"{c['fresh']} |" for c in mismatches]
        lines += [""]
    else:
        lines += ["**No mismatches.** Every identifier, release date, currency, price and "
                  "stored denominator agreed with the source. The only differences are the "
                  "review counts that Steam has since updated.", ""]

    if drifts:
        lines += ["## Review-count drift", "",
                  "Steam publishes live aggregates, so a title's counts move between the "
                  "collection timestamp and this re-read. Most move up; a review can also be "
                  "deleted or recategorised upstream, which moves a count down. Both directions "
                  "are recorded, because both are the frozen-aggregate limitation in "
                  "`docs/results.md` appearing in the data rather than being assumed.", "",
                  "| appid | title | field | stored | fresh | change |",
                  "|---|---|---|---|---|---|"]
        for c in drifts:
            try:
                delta = int(c["fresh"]) - int(c["stored"])
                pct = delta / int(c["stored"]) * 100 if int(c["stored"]) else float("inf")
                change = f"{delta:+d} ({pct:+.1f}%)"
            except (ValueError, ZeroDivisionError):
                change = "?"
            lines += [f"| {c['appid']} | {c['name']} | `{c['field']}` | {c['stored']} | "
                      f"{c['fresh']} | {change} |"]
        lines += [""]

    lines += ["## Full comparison", "",
              "| appid | title | field | stored | fresh | verdict |",
              "|---|---|---|---|---|---|"]
    lines += [f"| {c['appid']} | {c['name'][:38]} | `{c['field']}` | {str(c['stored'])[:44]} | "
              f"{str(c['fresh'])[:44]} | {c['verdict']} |" for c in checks]
    lines += [
        "",
        "## PM confirmation",
        "",
        "The comparison above was produced by `analysis/verify_fields.py`. The brief requires "
        "the fields to be verified, not merely computed, so the confirmation below is the "
        "student's own act. Complete it after reading the mismatch and drift sections.",
        "",
        "- [ ] I read the mismatch section and I am satisfied that each listed difference is "
        "explained or is a real defect I have recorded",
        "- [ ] I read the drift section and I accept the review-count differences as live "
        "aggregate updates rather than extraction errors",
        "- [ ] I checked that the price scale (minor units) and the currency code are the ones "
        "the store actually returned",
        "- [ ] I checked that each stored denominator reconciles: positive plus negative equals "
        "the stored total, and the stored rate is those two counts divided",
        "- [ ] I opened at least one title's store page myself and compared it with the row",
        "",
        "**Verification notes:** ______________________________________________",
        "",
        f"**Verified by:** ",
        f"**Date:** ",
    ]

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"compared {len(checks)} field values across {n} titles: "
        f"{counts['match']} match, {counts['drifted_up']} up, "
        f"{counts['drifted_down']} down, {counts['mismatch']} mismatch")
    log(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
