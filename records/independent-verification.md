# Independent verification (PM-authored, non-AI)

**This file must be written by the student.** It is not an agent task, and an agent must not fill
in any number below. The brief is explicit that another AI's assurance is not verification.

**Status:** NOT YET COMPLETED
**Verified by:** _(student name)_
**Date:** _(date)_
**Method used:** _(e.g. hand calculation, or a spreadsheet formula typed independently of the
analysis script — state which)_

## Why this file exists

`analysis/analyze_and_report.py` is code. Running code and reading its own output does not test it:
if the script has a bug, the output carries the same bug, and it will agree with itself perfectly.
The only way to catch that class of error is to recompute a few quantities by a **different
method**, from the raw numbers, and compare.

## Step 1 — Confirm the dataset fingerprint

Open `records/extraction-audit.md` and copy the recorded SHA-256.

| Item | Value |
|---|---|
| SHA-256 recorded in the audit | _(paste)_ |
| SHA-256 you obtain yourself (`shasum -a 256 data/clean/analysis_dataset.csv`) | _(paste)_ |
| Do they match? | _(yes / no)_ |

If they do not match, stop: the dataset changed after the audit was written and nothing downstream
is comparable.

## Step 2 — Recompute the outcome by hand on six titles

Take every 25th row of `data/clean/analysis_dataset.csv` (rows 1, 26, 51, 76, 101, 126). Open them
in a spreadsheet. Do **not** copy the `positive_rate` column; compute it from the two counts.

| appid | title (short) | `total_positive` | `total_negative` | Your rate = pos / (pos + neg) | `positive_rate` in file | Difference |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

_(Record any difference, however small. A 0.0001 difference is rounding; anything larger is a
discrepancy that must be explained before the analysis is used.)_

## Step 3 — Recompute the two headline means by hand

| Quantity | Your value | Value from `analysis/results/model_summary.txt` | Agree? |
|---|---|---|---|
| Number of analysed titles | | | |
| Mean positive review rate, all titles | | | |
| Mean positive review rate, paid titles | | | |
| Mean positive review rate, free-to-play titles | | | |

## Step 4 — Sanity-check the headline model claim by a different route

The fitted model reports a coefficient for `is_free`. Ignore the model and compute the raw
difference in mean rate between free-to-play and paid titles directly from the dataset.

| Item | Value |
|---|---|
| Mean rate, paid | _(from Step 3)_ |
| Mean rate, free-to-play | _(from Step 3)_ |
| Raw difference (F2P minus paid) | |
| Sign of the model's `is_free` coefficient | _(positive / negative)_ |
| Does the raw difference have the same sign as the coefficient? | _(yes / no)_ |

A sign mismatch would mean either the model or the data cleaning is wrong. Note it here rather than
resolving it by preferring the model's answer.

## Step 5 — What you found

_(Write plainly: what agreed, what did not, and what you changed as a result. If nothing disagreed,
say so — but state what you checked, so that "nothing disagreed" is a claim about a specific check
rather than a general impression.)_

## Signature

_(student name, date)_
