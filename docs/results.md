# Results

Generated from `data/clean/analysis_dataset.csv` by `analysis/analyze_and_report.py`.
Full console output: `analysis/results/model_summary.txt`.

| Property | Value |
|---|---|
| Titles analysed | 159 |
| Dataset SHA-256 | `67eaeb6d965ae0d2109c411896f1f12a88d52459520e1f993b2369a77d0c2875` |
| Data cutoff | 2026-10-09 |
| Release window | 2024-10-09 to 2026-10-09 |
| Software | pandas 2.3.3, statsmodels 0.14.6, numpy 2.0.2 |
| Random seed | 20261009 |
| Estimator | Fractional logit (GLM binomial, logit link, IRLS) |

---

## Headline

**The declared attributes barely predict a title's positive review rate in this sample.** The
primary model explains almost none of the variation (pseudo-R² 0.007), and none of the focal
coefficients is statistically distinguishable from zero.

This is a negative result, and it is reported as one. It is not a failure of the pipeline: the
model converged, the diagnostics are clean, and the sample has usable variance in the outcome
(sd 0.124, range 0.331 to 1.000). The finding is that the business model, the title's age, its
review volume, and its genre tag do not, individually or jointly, account for much of the
difference in reception among recently released titles.

## Sample

| Property | Value |
|---|---|
| Titles | 159 |
| Mean positive rate | 0.8233 |
| SD | 0.1245 |
| Range | 0.3308 to 1.0000 |
| Titles below 0.5 | 5 |
| Free-to-play | 35 (22.0%) |
| Multi-player / co-op emphasis | 28 (17.6%) |
| Early Access | 17 (10.7%) |
| Review counts | 50 to 115,758 |
| Genre strata | 6 (Action, Adventure, Indie, RPG, Simulation, Strategy) |
| Quarters represented | 9 |

Collection screened 577 candidates across 6 genre strata. Of the 54 (tag × quarter) cells, 49
reached the three-title quota. Four were partial, and every one of those four is 2026-Q4 — the
nine-day slice between 1 and 9 October that the cutoff leaves at the end of the window. One cell,
Indie in 2026-Q4, was empty: no Indie release in that nine-day stretch had reached 50 reviews. The
page-level screen rejected a further 1,998 candidates on the review floor before any per-title
request was spent.

## Primary specification

`positive_rate ~ is_free + age_years + I(age_years**2) + C(assigned_tag) + log_reviews`

| Term | Logit coef. | SE | p | Marginal effect on the rate |
|---|---|---|---|---|
| `is_free` | −0.095 | 0.522 | 0.856 | −0.014 (95% CI −0.161 to +0.134) |
| `age_years` | +0.434 | 1.318 | 0.742 | +0.063 |
| `age_years²` | −0.192 | 0.664 | 0.772 | −0.028 |
| `log_reviews` | +0.119 | 0.163 | 0.467 | +0.017 |
| Genre dummies (vs Action) | +0.086 to +0.358 | ~0.70 | 0.60–0.90 | +0.012 to +0.052 |

**Reading the `is_free` result.** The point estimate is −1.4 percentage points on the probability
scale, and its 95% interval runs from −16 to +13 points. The honest statement is therefore not
"business model does not matter" but **"this sample cannot detect whether it matters, and cannot
rule out an effect large enough to matter commercially."** With 35 free-to-play titles, the design
is underpowered for an effect of that size, and the wide interval is the finding rather than an
inconvenience.

### Raw group means

| Group | n | Mean rate | Median | SD |
|---|---|---|---|---|
| Paid | 124 | 0.8251 | 0.8417 | 0.1250 |
| Free-to-play | 35 | 0.8166 | 0.8574 | 0.1243 |

The gap in raw means is 0.9 percentage points — smaller than the standard error of either mean. The
free-to-play group's *median* is in fact higher than the paid group's, so the two groups are not
even cleanly ordered.

**This does not replicate the pilot.** The 9 October pilot of 40 titles showed free-to-play and
live-service titles clustering at the bottom of the range (PUBG 0.605, War Thunder 0.712). In the
159-title sample that pattern disappears. The pilot's examples were apparently not representative,
which is exactly the risk a pilot of 40 titles carries. The earlier reading is withdrawn rather
than reconciled: the larger sample is the better evidence, and the direction it shows is "no
detectable difference".

### By sampling tag

| Tag | n | Mean rate |
|---|---|---|
| Adventure | 25 | 0.8437 |
| RPG | 26 | 0.8378 |
| Indie | 29 | 0.8331 |
| Strategy | 25 | 0.8287 |
| Simulation | 27 | 0.8115 |
| Action | 27 | 0.7865 |

Action sits 5.7 points below Adventure, the widest gap between any two strata, and it is the only
ordering that looks like a pattern. It is not statistically distinguishable either (all genre
p-values exceed 0.60), so it is reported as an observation and not as a finding.

## Second specification: the gameplay feature

`... + multiplayer_emphasis`

| Group | n | Mean rate | Median |
|---|---|---|---|
| Single-player-led | 131 | 0.8349 | 0.8599 |
| Multi-player / co-op led | 28 | 0.7688 | 0.7948 |

| Term | Logit coef. | SE | p |
|---|---|---|---|
| `multiplayer_emphasis` | −0.486 | 0.549 | 0.376 |

Multi-player-led titles sit 6.6 percentage points lower on the raw mean, the largest gap anywhere in
the analysis. It is still not statistically distinguishable from zero at this sample size, and
adding the feature moves `is_free` from −0.095 to +0.009 — a sign change across specifications that
is itself a caution against reading either coefficient as an estimate of anything.

This is the one pattern worth a follow-up study rather than a product claim: it is large enough to
matter, consistent in sign in both the raw means and the model, and measured on only 28 titles.

## Diagnostics

| Check | Result | Reading |
|---|---|---|
| Pearson χ² / dof | 0.103 | No overdispersion; the fractional logit's variance assumption is not strained |
| Influential titles (Cook's D > 4/n) | 0 | No single title drives the fit |
| Sparse categories (<10 titles) | 0 | Every genre stratum is adequately sized |
| Pseudo-R² (Cox–Snell) | 0.007 | The model explains almost none of the outcome variation |

The dispersion statistic is important to state clearly: it is *not* evidence that the model is
good. It says the residual variance matches the assumed variance, which is what a well-specified
model with essentially no explanatory power also looks like.

## Sensitivity analyses (pre-declared)

| Analysis | `is_free` | `age_years` | Reading |
|---|---|---|---|
| Primary (unweighted) | −0.095 | +0.434 | Not significant |
| Review-weighted | −0.439 | −0.275 | Still not significant; both gain magnitude and the age sign flips |
| Excluding titles under 6 months (n=110) | −0.332 | −0.268 | `is_free` magnitude more than triples; still not significant; age sign flips again |

The `is_free` coefficient ranges from −0.095 to −0.439 across three defensible specifications. The
sign is stable, so the direction of the (undetected) association is at least consistent; the
magnitude is not, so no single value can be reported as *the* estimate. A reader is entitled to ask
which specification was chosen, and the answer is that all three are reported and none is
privileged.

## What the analysis does support

1. **A population distribution to locate an expectation in.** The distribution is well measured:
   mean 0.823, sd 0.125, interquartile range 0.755–0.920, with a long left tail (5 of 159 titles
   below 0.5). An expected rate of 0.70 sits at the 14th percentile and 0.90 at the 67th. Reporting
   that position requires no model and no causal claim.
2. **A negative result worth acting on.** A developer choosing free-to-play in the belief that it
   will depress reception has no support for that belief in this data. Neither does the opposite.
3. **An upper bound on predictability, and a second bound on conditioning.** Simple published
   attributes explain about 1% of the variance, and the conditional ranges barely separate: the
   interquartile range is 0.165 wide while the six genre medians span only 0.042. A product
   promising to forecast reception from these attributes is overpromising, and so is one that
   offers a genre-specific answer. This is the evidence for scoping the MVP to a base-rate locator
   rather than a predictor or a conditional benchmark.

## What the analysis does not support

- Any causal claim. The design is observational and the covariates are not exogenous.
- Forecasting a specific reception figure for a specific unreleased title.
- Audience or demographic claims. The outcome is a share over reviewers, who are self-selected.
- Comparisons of the rate across language communities: each rate is computed within its own voting
  pool, so a cross-language contrast confounds community composition with reception.
- Generalisation beyond the frame. Titles the endpoints do not return are unobserved, not zeros.

## Limitations

1. **Power.** 159 titles with 35 free-to-play and 28 multi-player-led. The confidence intervals are
   wide, and "not significant" here means "not detected", not "absent".
2. **Selection on review volume.** The ≥50-review floor excludes the long tail of releases that
   attracted almost no attention. The findings describe titles that found *some* audience, not all
   releases. This is a substantive restriction: the excluded titles are likely the worst-received.
3. **Frozen aggregates.** Review counts and rates were retrieved at one timestamp. Rates drift as
   later reviewers arrive, and nothing here observes that drift.
4. **Unmeasured confounders.** Developer reputation, marketing spend, price point, and launch build
   quality are absent and plausibly correlated with both business model and reception.
5. **Derived feature.** `multiplayer_emphasis` is computed from the provider's category list, not
   hand-verified for every title; a 20% human validity check is reported separately in
   `records/coding-agreement.md`.
6. **One code path.** Every number above comes from one script. The independent recomputation in
   `records/independent-verification.md` exists precisely because that is a single point of failure.
