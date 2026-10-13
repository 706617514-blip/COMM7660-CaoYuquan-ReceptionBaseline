---
name: analyze-and-report
description: Execute the PM-approved statistical model on frozen title-level data, produce diagnostics, sensitivity checks, and results linked to saved outputs. Use only after the specification is frozen and approved. Does not change the specification.
version: 0.2.0
adapted_from: original
---

# analyze-and-report

## Purpose

Run the approved specification and report what it shows, including what it fails to show. The
skill executes; it does not choose the model.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `data/clean/analysis_dataset.csv` | yes | Frozen, one row per title; hash recorded before the run |
| `docs/statistical-spec.md` | yes | PM-approved specification |
| `docs/codebook.md` | yes | Variable roles and coding values |
| sensitivity specifications | yes | Two pre-declared alternatives |

## Outputs

- `analysis/analyze_and_report.py` — executed code, with the seed recorded
- `analysis/results/` — tables as CSV, figures as PNG
- `docs/results.md` — every result sentence linked to the output that produced it
- `records/skill-log.md` — one appended row

## Required figures

1. Distribution of the outcome, with the model scale shown alongside the raw proportion
2. A category comparison relevant to the research question, with group sizes displayed
3. A model-based comparison, displayed with its uncertainty interval

## Required reported quantities

Analysed title count; estimates or contrasts; standard errors; 95 per cent confidence intervals;
an effect size; a model-fit measure; p values where they apply.

Because the outcome is a proportion, report effects on the probability scale as well as on the
modelled scale. A coefficient on a logit scale is not interpretable to a product audience without
conversion.

## Steps

1. Record the input file hash and the software versions before executing anything.
2. Produce the data-quality report and the descriptive figures first.
3. Assess whether the approved model suits the observed measures and distribution. If it does not,
   stop and report — do not silently substitute a different specification.
4. After approval, execute the model and its diagnostics.
5. Run the two pre-declared sensitivity analyses.
6. Link each result sentence to the specific saved output that supports it.

## Checks

- [ ] Input hash matches the frozen dataset
- [ ] Row count equals the analysed title count, with no duplicated titles
- [ ] Every reported number traces to a saved artifact
- [ ] Confidence intervals reported alongside point estimates, never instead of them
- [ ] Effects converted to the probability scale, not left on the logit scale only
- [ ] Assumption checks cover influential titles, sparse genre categories, unequal variance, and
      overdispersion
- [ ] A non-significant result reported as such rather than re-specified away
- [ ] No specification change without a recorded amendment

## Planned sensitivity analyses

Declared before execution:

1. **Unweighted fit.** Refit without review-count weighting. If the focal estimates move
   materially, the weighted result depends on large titles dominating and that must be stated.
2. **Exclusion of recent and early-access titles.** Refit on titles with a settled reviewing
   population. If the age effect disappears, the original estimate was driven by unstable young
   titles.

## Stopping conditions

Stop and escalate to the PM if:

- Diagnostics indicate the approved model is inappropriate for the observed outcome.
- A sensitivity analysis reverses the direction of the focal estimate.
- Overdispersion is severe enough that standard errors are not credible.
- The effective sample size cannot support the number of estimated parameters.
- Producing an expected result would require changing the specification.

The skill must not search alternative specifications until one yields a preferred result.
