---
name: validate-media-data
description: Clean title-level collected records, apply declared missing-data rules, and run duplicate, range, and consistency checks that produce a codebook and an extraction audit. Use after collection and before any modelling.
version: 0.2.0
adapted_from: original
---

# validate-media-data

## Purpose

Convert raw permitted records into a frozen analytical dataset with one row per title, with every
exclusion counted and justified, and with a codebook that makes the coding decisions inspectable.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `data/raw/steam_titles_*.jsonl` | yes | Verified collection output |
| `data/raw/steam_review_aggregates_*.csv` | yes | Positive/negative counts per title |
| `data/raw/steam_appdetails_*.json` | yes | Title metadata |
| coding rules | yes | Multi-label genre rules, ambiguous-case rules, unit conventions |
| missing-data rules | yes | Declared before inspection of the outcome distribution |

## Outputs

- `data/clean/analysis_dataset.csv` — one row per title
- `docs/codebook.md` — constructs, values, levels, units, sources, missing rules, model roles
- `analysis/validate_data.py` — executed cleaning code
- `records/extraction-audit.md` — eligible / retrieved / matched / excluded / analysed counts with reasons

## Steps

1. Apply the declared missing-data rules. Rules are fixed before the outcome is examined.
2. Remove duplicate application identifiers. Count how many were removed. A title appearing more
   than once is a defect, not a weighting decision.
3. Compute the outcome as `total_positive / (total_positive + total_negative)`. Reject titles
   where the denominator is zero.
4. Convert release dates to elapsed time at the declared collection timestamp. State the unit.
5. Join genre, category, and price metadata on application identifier. Count unmatched records.
6. Code the gameplay feature from the retrieved store description. The outcome must be hidden
   during this step.
7. Flag, but do not silently drop, records with implausible combinations, for example a high
   positive rate alongside a very small review count.
8. Record every exclusion with its reason.

## Checks

- [ ] Exactly one row per application identifier
- [ ] Duplicate rate reported, not just resolved
- [ ] Outcome lies within [0,1] for every row, with no NaN denominators
- [ ] Missingness reported per variable, not only overall
- [ ] Review count reconciles: positive + negative equals the reported total
- [ ] Genre stratification group sizes reported
- [ ] Feature coding was performed without access to the outcome column
- [ ] Every exclusion attributed to a named rule
- [ ] Row counts reconcile: eligible = analysed + excluded, with reasons summing correctly

## Stopping conditions

Stop and return to the PM if:

- A declared missing-data rule removes more than a quarter of titles.
- The outcome has near-zero variance in the retrieved sample.
- Genre coverage is too thin to support even a descriptive contrast.
- Reconciliation requires inventing a rule not previously declared.
- The outcome column was visible during feature coding.

Report the problem rather than adjusting the rule to preserve the sample.
