# Codebook

**Dataset:** `data/clean/analysis_dataset.csv`
**Unit of analysis:** one title (one row per distinct Steam application)
**Source:** Steam Web API, documented public endpoints. See `data/source-access-manifest.md`.

Rules in this codebook were declared **before** the outcome distribution was examined, with one
exception noted under the amendment log.

---

## Identifiers

| Variable | Type | Values | Source | Role |
|---|---|---|---|---|
| `appid` | string | Steam application identifier | API | Identifier, not modelled |
| `name` | string | Title name as published | API | Reference only |

## Temporal

| Variable | Type | Values | Units | Source | Role |
|---|---|---|---|---|---|
| `release_date` | date | ISO 8601 | — | `release_date.date` | Source for derived fields |
| `release_quarter` | category | `YYYY-Qn`, n ∈ 1–4 | — | Derived from `release_date` | Sampling strata; descriptive |
| `release_year` | integer | 2024–2026 | years | Derived | Descriptive |
| `age_years` | continuous | 0.0–2.0 | years | Cutoff minus `release_date`, divided by 365.25 | Focal predictor |

**Cutoff:** 2026-10-09. All ages are measured at this single declared timestamp, so ages are
comparable across titles.

## Outcome

| Variable | Type | Values | Units | Source | Role |
|---|---|---|---|---|---|
| `positive_rate` | continuous | [0, 1] | proportion of reviewers | `total_positive / (total_positive + total_negative)` | **Outcome** |

**Construct.** The share of reviewers who gave a positive recommendation.

**It does not measure:** sales, revenue, player counts, unique players, playtime, or audience
demographics.

**Measurement caveat.** The denominator is reviewers, who are a self-selected subset of players.
A title with more reviews has a more precisely estimated rate, which is why review count enters as
a control.

## Review aggregates

| Variable | Type | Values | Source | Role |
|---|---|---|---|---|
| `total_positive` | integer | ≥ 0 | `query_summary.total_positive` | Numerator |
| `total_negative` | integer | ≥ 0 | `query_summary.total_negative` | Denominator component |
| `total_reviews` | integer | ≥ 50 | Sum of the two above | Eligibility filter; sensitivity weight |
| `log_reviews` | continuous | log(1 + `total_reviews`) | Derived | Control: exposure and precision |
| `review_score_desc` | category | e.g. "Very Positive" | `query_summary.review_score_desc` | Reference; derived from the outcome, so **not used as a predictor** |

> `review_score_desc` is a binned version of the outcome. Including it as a predictor would be
> circular. It is retained for descriptive reporting only.

## Business model

| Variable | Type | Values | Source | Role |
|---|---|---|---|---|
| `is_free` | binary | 0 = paid, 1 = free to play | `is_free` | **Focal predictor** |
| `price_initial` | integer | minor currency units | `price_overview.initial` | Descriptive |
| `price_currency` | category | e.g. `HKD` | `price_overview.currency` | Descriptive |

**Unit warning.** Prices are returned in minor units in the account's local currency, which varies
by request. Prices are therefore **not comparable across rows** and are not used as a predictor.
Only `is_free` is used.

## Genre and category coding

| Variable | Type | Values | Source | Role |
|---|---|---|---|---|
| `genres` | multi-label | pipe-separated | `genres[].description` | Coding source |
| `categories` | multi-label | pipe-separated | `categories[].description` | Coding source |
| `genre_count` | integer | ≥ 1 | Derived | Descriptive |
| `assigned_tag` | category | 6 sampling tags walked | Sampling stratum | **Control** |

**Multi-label rule.** A title may carry several genre labels; the observed maximum in this dataset
is seven. Two distinct fields serve two distinct purposes:

- `assigned_tag` records **how the title entered the sample**. Each title is assigned exactly one
  tag, so the control is not duplicated across rows.
- `genres` records **the provider's labels**. These may exceed one and are retained unmodified.

**Ambiguous cases.** Where a title's labels span several of the sampling tags, `assigned_tag`
reflects the stratum it was drawn from, not a claim about its dominant genre. This is stated
because a reader could otherwise mistake the field for a classification.

**Feature coding from the provider's description.** `short_description` is retrieved so that a
gameplay or narrative feature can be coded from the **actual source text** rather than from model
memory. The outcome column must not be visible during that coding step.

## Derived gameplay features

Both features below are **derived in code from the retrieved record**, not hand-coded. A label read
mechanically from the provider's own lists is reproducible from the raw data, cannot drift between
coding sessions, and cannot be contaminated by the outcome.

| Variable | Type | Values | Source | Role |
|---|---|---|---|---|
| `multiplayer_emphasis` | binary | 1 = social/competitive core loop | `categories` containing any of `Multi-player`, `Co-op`, `PvP`, `MMO`, `Shared/Split Screen` | **Gameplay feature**; enters Model 2 |
| `coded_early_access` | binary | 1 = Early Access | `genres` containing `Early Access` | Descriptive / robustness |

**Why `multiplayer_emphasis` is matched as substrings.** The provider's category list is verbose and
inconsistent in how it records the same concept (`Online Co-op`, `Shared/Split Screen Co-op`,
`Online PvP`, `LAN PvP`). Matching a short marker list collapses those variants into one construct.
The trade-off is that a substring match could fire on an unrelated label; no such label exists in
the observed list, and the human validity check below is the guard against one appearing.

**Human validity check (required).** Because a derived label can still be wrong, a 20% subsample is
coded independently by the PM from `short_description` alone, with the outcome **and** the
`categories` list withheld, and agreement is reported in `records/coding-agreement.md`:

```bash
python analysis/make_coding_sheet.py          # build the sheet
python analysis/make_coding_sheet.py --score records/coding-sheet-round1-filled.csv
```

Withholding `categories` matters: the derived label is computed from that list, so a coder shown it
would be copying the machine label rather than checking it. The derived label remains the variable
used in the model regardless of the outcome of the check; the check measures how far it can be
trusted, and every disagreement is listed individually rather than resolved by preference.


## Derived and excluded

| Field | Status | Reason |
|---|---|---|
| `short_description` | held, not modelled | Coding input; retained for auditability |
| `developers`, `publishers` | held, not modelled | Identifier-like; would absorb many degrees of freedom |
| `release_year` | held, not modelled | Collinear with the age term |

## Missing data rules (declared before inspection)

| Code | Rule | Action |
|---|---|---|
| M1 | `release_date` unparseable | Exclude the title |
| M2 | `total_reviews` == 0 | Exclude — the outcome is undefined |
| M3 | `total_positive` + `total_negative` ≠ `total_reviews` | Investigate; exclude if unreconciled |
| M4 | `is_free` absent | Treat as 0 only if `price_overview` is present; otherwise exclude |

An excluded title is unobserved, not a zero. Exclusion counts appear in
`records/extraction-audit.md`.

## Measurement levels summary

| Variable | Level | Note |
|---|---|---|
| `positive_rate` | ratio | True zero and equal intervals on the proportion scale |
| `age_years` | ratio | True zero at release |
| `total_reviews` | ratio | Count, heavily right-skewed; log-transformed for modelling |
| `is_free` | nominal binary | — |
| `assigned_tag` | nominal | Six sampling categories |
| `genres` | nominal multi-label | Coded, not modelled directly |
| `multiplayer_emphasis` | nominal binary | Derived from `categories` |
| `coded_early_access` | nominal binary | Derived from `genres` |

## Amendment log

| Date | Amendment | Reason | Status |
|---|---|---|---|
| 2026-10-09 | Outcome moved from per-review helpfulness score to title-level positive rate | Pilot found the per-review score had sd 0.072 and correlated 0.896 with raw upvotes, making it both low-variance and near-circular | **Pre-specification feasibility correction**, not outcome-informed |
| 2026-10-09 | Unit of analysis moved from review to title | The brief specifies a title-level design | Pre-specification |
| 2026-10-12 | Added `multiplayer_emphasis` and `coded_early_access` as code-derived features, plus the 20% human validity check | The brief requires a plot/narrative/gameplay feature; deriving it from retrieved labels avoids both hand-coding drift and outcome contamination | Before first execution on real data |
| 2026-10-12 | Sampling tags reduced from nine to six walked tags (Action, Indie, RPG, Strategy, Simulation, Adventure) | Racing, Sports, and Casual are small frames in which most titles fall below the review threshold, so walking them spent requests without adding usable titles | Before first execution |
| 2026-10-12 | `MIN_REVIEWS` retained at 50 | Declared before collection. Recent quarters yield few qualifying titles as a result; that is a property of the population and is reported rather than relaxed after the fact | Unchanged |
