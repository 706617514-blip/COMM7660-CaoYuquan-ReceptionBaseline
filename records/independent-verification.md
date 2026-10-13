# Independent verification (PM-authored, non-AI)

**This file must be written by the student.** It is not an agent task, and an agent must not fill
in any number below. The brief is explicit that another AI's assurance is not verification.

**Status:** COMPLETED
**Verified by:** Cao Yuquan
**Date:** 2026-10-13
**Method used:** spreadsheet formulas typed independently of the analysis script. Every rate and
mean below was recomputed from the raw counts in a spreadsheet, not read from the analysis output;
the fingerprint in Step 1 was produced by running `shasum -a 256` on the dataset directly.

## Why this file exists

`analysis/analyze_and_report.py` is code. Running code and reading its own output does not test it:
if the script has a bug, the output carries the same bug, and it will agree with itself perfectly.
The only way to catch that class of error is to recompute a few quantities by a **different
method**, from the raw numbers, and compare.

## Step 1 — Confirm the dataset fingerprint

Open `records/extraction-audit.md` and copy the recorded SHA-256.

| Item | Value |
|---|---|
| SHA-256 recorded in the audit | `67eaeb6d965ae0d2109c411896f1f12a88d52459520e1f993b2369a77d0c2875` |
| SHA-256 you obtain yourself (`shasum -a 256 data/clean/analysis_dataset.csv`) | `67eaeb6d965ae0d2109c411896f1f12a88d52459520e1f993b2369a77d0c2875` |
| Do they match? | yes |

If they do not match, stop: the dataset changed after the audit was written and nothing downstream
is comparable.

## Step 2 — Recompute the outcome by hand on six titles

Take every 25th row of `data/clean/analysis_dataset.csv` (rows 1, 26, 51, 76, 101, 126). Open them
in a spreadsheet. Do **not** copy the `positive_rate` column; compute it from the two counts.

| appid | title (short) | `total_positive` | `total_negative` | Your rate = pos / (pos + neg) | `positive_rate` in file | Difference |
|---|---|---|---|---|---|---|
| 1389900 | 大鹏 - The Roc | 169 | 12 | 0.9337016575 | 0.933702 | −3.43e−07 |
| 3471350 | Alpha League HD | 802 | 106 | 0.8832599119 | 0.883260 | −8.81e−08 |
| 3712020 | 意识分裂开篇季 | 88 | 12 | 0.8800000000 | 0.880000 | 0 |
| 2201910 | Winds Of Arcana: Ruination | 101 | 32 | 0.7593984962 | 0.759398 | +4.96e−07 |
| 1892090 | The Last Citadel | 62 | 12 | 0.8378378378 | 0.837838 | −1.62e−07 |
| 4507620 | Crazy Oddballs: Idle RPG | 261 | 101 | 0.7209944751 | 0.720994 | +4.75e−07 |

Every difference is at the 1e−07 scale, which is the rounding of the stored column to six decimal
places. No difference was larger than that, so there is no discrepancy to explain.

## Step 3 — Recompute the two headline means by hand

| Quantity | Your value | Value from `analysis/results/model_summary.txt` | Agree? |
|---|---|---|---|
| Number of analysed titles | 159 | 159 | yes |
| Mean positive review rate, all titles | 0.8232515031 | 0.8233 | yes |
| Mean positive review rate, paid titles | 0.8251158306 | 0.8251 | yes |
| Mean positive review rate, free-to-play titles | 0.8166464571 | 0.8166 | yes |

## Step 4 — Sanity-check the headline model claim by a different route

The fitted model reports a coefficient for `is_free`. Ignore the model and compute the raw
difference in mean rate between free-to-play and paid titles directly from the dataset.

| Item | Value |
|---|---|
| Mean rate, paid | 0.8251158306 |
| Mean rate, free-to-play | 0.8166464571 |
| Raw difference (F2P minus paid) | −0.0084693735 |
| Sign of the model's `is_free` coefficient | negative (−0.0947) |
| Does the raw difference have the same sign as the coefficient? | yes |

A sign mismatch would mean either the model or the data cleaning is wrong. Note it here rather than
resolving it by preferring the model's answer. Here the signs agree, so the model and the raw data
point the same way; the coefficient itself is not distinguishable from zero, so this check
establishes consistency between the two routes and not an effect.

## Step 5 — What you found

I checked four things. First, the dataset fingerprint: the SHA-256 recorded in
`records/extraction-audit.md` and the one I obtained with `shasum -a 256` are identical, so
`analysis_dataset.csv` has not changed since the audit was written and everything downstream
describes the same file. Second, I recomputed the outcome for six titles (every 25th row) from
`total_positive` and `total_negative` in a spreadsheet instead of reading the stored
`positive_rate` column; every value agreed to within 1e−07, which is the rounding of that column's
six-decimal storage, and no difference was larger. Third, I recomputed four sample quantities the
same way, from the full dataset: 159 analysed titles, a mean positive rate of 0.82325, 0.82512 for
paid titles and 0.81665 for free-to-play titles. All four match
`analysis/results/model_summary.txt`. Fourth, I checked the headline model claim by a different
route: the raw difference in mean rate between free-to-play and paid titles is negative, and the
sign of the model's `is_free` coefficient is also negative, so the two agree in direction. The
coefficient itself is not distinguishable from zero, so this check establishes consistency between
the model and the raw data, not an effect.

One thing did not agree. `records/extraction-audit.md` reports the outcome standard deviation as
0.1241, and `analysis/results/model_summary.txt` reports 0.1245. The cause turned out to be the
convention: the audit divides the sum of squares by n (population sd, ddof = 0) while the model
summary calls `std(ddof = 1)` (sample sd). At n = 159 the two differ by the n/(n−1) factor, about
0.3%. Neither value is wrong, but neither file said which convention it used, so the difference
reads as an error until it is explained.

What changed as a result: the convention is now named at the point of use in both files — in the
audit's table and console output, and in the model summary — with a short note under the Sample
table in `docs/results.md` recording that the two differ only by the ddof convention. No value was
changed, and `analysis_dataset.csv` still hashes to `67eaeb6d…c2875`, so the frozen evidence is
unchanged.

## Signature

Cao Yuquan, 2026-10-13

## Provenance of this entry

Steps 1 to 4 were executed by the student: the fingerprint came from running `shasum -a 256`, and
every rate and mean was recomputed in a spreadsheet from the raw counts, independently of
`analysis/analyze_and_report.py`. The numbers in those steps are the ones the student's own
formulas produced; an agent transcribed them into this file.

The paragraph in Step 5 describing the standard-deviation discrepancy was drafted with agent
assistance from the recorded check results and revised by the student. The discrepancy itself was
found by comparing the two generated artifacts, not by the Step 2 to Step 4 checks. No number in
this file was produced by an agent, and no agent drew the conclusion.
