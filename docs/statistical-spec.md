# Statistical specification (frozen)

**Status:** DRAFT — awaiting Approval 2 in `records/approvals.md`
**Frozen on:** _(date to be entered by the PM at approval time)_
**Dataset:** `data/clean/analysis_dataset.csv`, one row per title

---

## Outcome

`positive_rate` = `total_positive / (total_positive + total_negative)`

A proportion over reviewers, bounded in [0,1].

It measures the share of reviewers who recommend the title. It does not measure sales, revenue,
player counts, unique players, or audience demographics. Reviewers are a self-selected subset of
players, so the quantity describes the reviewing population.

## Specification

$$ \text{logit}(\mathbb{E}[p_i]) = \beta_0 + \beta_1 \text{IsFree}_i + \beta_2 \text{Age}_i + \beta_3 \text{Age}_i^2 + \beta_4 \log(1 + \text{Reviews}_i) + \sum_k \gamma_k \text{Tag}_{ik} $$

In code:

```
positive_rate ~ is_free + age_years + I(age_years**2) + C(assigned_tag) + log_reviews
```

| Symbol | Variable | Role | Mechanism |
|---|---|---|---|
| $p_i$ | `positive_rate` | outcome | — |
| $\beta_1$ | `is_free` | focal | Business-model composition of the reviewing population |
| $\beta_2, \beta_3$ | `age_years`, squared | focal | Ageing of the reviewing population, tested for non-linearity |
| $\beta_4$ | `log_reviews` | control | Exposure and precision of the rate |
| $\gamma_k$ | `assigned_tag` | control | Genre-level differences in reviewing behaviour |

### Second specification carrying the gameplay feature

The brief requires at least one genre variable **and** one plot, narrative or gameplay feature.
`assigned_tag` supplies the genre variable. The gameplay feature is `multiplayer_emphasis`, and it
enters a second specification rather than the primary one, so that the focal business-model and
ageing estimates are not conditional on a feature that is itself correlated with them.

```
positive_rate ~ is_free + age_years + I(age_years**2) + C(assigned_tag) + log_reviews + multiplayer_emphasis
```

Model 1 above is the primary specification. Model 2 is reported alongside it. They are not
competing models chosen after seeing results: both are declared here, before execution, and both
are always reported.

### How the gameplay feature is measured

`multiplayer_emphasis` is **derived, not hand-coded**: it is 1 when the retrieved `categories` list
contains any of `Multi-player`, `Co-op`, `Online Co-op`, `PvP`, `MMO`, or `Shared/Split Screen`,
and 0 otherwise.

This is deliberate. A label read mechanically from the provider's own list is reproducible from the
raw record, cannot drift with the coder's mood, and does not depend on model memory. Deriving it in
code also means the outcome cannot contaminate the feature, which is the risk the brief's
hide-the-outcome rule targets.

Because a derived label can still be wrong, a **human validity check** is required and is recorded
separately: a 20% subsample is coded independently by the PM from the retrieved store descriptions
with the outcome column withheld, and agreement with the derived label is reported in
`records/coding-agreement.md`. The derived label remains the variable used in the model either way;
the human pass measures how much the label can be trusted, and disagreement is reported rather than
resolved by preference.

### A focal predictor that was dropped

An earlier draft listed `has_predecessor` (whether a title has a prior instalment) as a focal
predictor for the expectation-breach mechanism. It is **not** in any specification. Sequel status
cannot be established reliably from the permitted fields: `appdetails` carries no franchise or
series identifier, and inferring it by string-matching titles to earlier releases would produce
false positives that are indistinguishable from true ones. Rather than enter a variable whose
measurement error cannot be bounded, the mechanism is discussed qualitatively and the specification
is narrowed to what the data can support. This is recorded as an amendment, not a silent omission.

## Estimator

**Fractional logit**: a generalised linear model with a binomial family and a logit link, fitted
with iteratively reweighted least squares.

**Why.** The outcome is a proportion. A binomial GLM with a logit link keeps fitted values inside
the permissible range without transforming the outcome, and tolerates the non-integer, continuous
proportions this design produces. A linear model on the raw proportion can predict values outside
[0,1]; a log-odds transform of the raw proportion is undefined at the boundaries.

**Reporting requirement.** Coefficients are reported on the logit scale with odds ratios, and
accompanying marginal effects are reported on the probability scale. A logit coefficient alone is
not interpretable to a product audience.

## Diagnostics required

- Influential titles via Cook's distance, with a 4/n threshold
- Dispersion: Pearson chi-squared divided by residual degrees of freedom
- Sparse categories in the genre control
- Assessment of the non-linearity term

## Sensitivity analyses (pre-declared)

1. **Review-weighted fit.** Refit with `freq_weights = total_reviews`. If the focal estimates move
   materially, the unweighted result depends on treating a rate over 50 reviews as comparable to a
   rate over 1,000, and that must be stated.
2. **Settled-population fit.** Refit excluding titles younger than six months. If the age effect
   disappears, the original estimate was driven by young titles with unsettled reviewing
   populations.

## What would change the specification

Any change requires a recorded amendment in this file and a PM approval entry. Changes made after
the first execution of the model are labelled **exploratory**.

## Amendment log

| # | Date | Change | Reason | Status |
|---|---|---|---|---|
| 1 | 2026-10-12 | Added Model 2 carrying `multiplayer_emphasis`; defined the feature as a code-derived label from `categories` plus a 20% human validity check | The brief requires a plot/narrative/gameplay feature, and no fitted specification carried one | Before first execution |
| 2 | 2026-10-12 | Dropped `has_predecessor` from the focal predictors | Sequel status is not measurable from the permitted fields without unbounded false positives | Before first execution |

Both amendments were made before the model was first executed on real data, so neither is labelled
exploratory.

## Known limitations to carry into the report

1. The outcome is provider-aggregated and the reviewing population is self-selected.
2. Titles outside the sampling frame are unobserved, not zeros.
3. Unmeasured confounders include developer reputation, marketing spend, and launch build quality.
4. The design supports association, not causal identification. No coefficient here licenses a claim
   that a characteristic causes a reception level.
