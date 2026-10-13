# Product decision memo

**Product:** Reception Baseline — a base-rate locator for expected Steam reception
**Decision owner:** student, acting as PM · **Phase 1** · Full evidence: `docs/results.md`

---

## Decision

**Build Reception Baseline.** A single-input media app: the user enters the positive review rate
they expect, sees its percentile among recent Steam releases drawn against the full distribution,
and is then shown the ten real titles nearest that position, each linking to its Steam store page.
The task ends in content — comparable games the developer can open and judge — not in a number.

**Reject Concept B**, the cross-market reception gap detector. The rate is computed within each
language community's own voting pool, so a community-to-community difference confounds reception
with the composition of reviewers. No further collection from the same endpoints could separate
them. Concept B is deferred on measurement grounds, not because it is uninteresting.

## Why the evidence supports this

The analysis is a near-null result: the declared attributes explain **under 1% of the variation**
in reception (pseudo-R² 0.007, N = 159), and no focal coefficient is distinguishable from zero.
Paid titles averaged 0.825 against 0.817 for free-to-play, with the free-to-play *median* the
higher of the two.

| Estimate | Logit coef. | p | Interval on the rate |
|---|---|---|---|
| `is_free` | −0.095 | 0.856 | −0.161 to +0.134 |
| `age_years` | +0.434 | 0.742 | — |
| `multiplayer_emphasis` | −0.486 | 0.376 | n = 28 |

This rules out one product, then a second. **Not a predictor:** at this explanatory power a
predicted score would restate the sample mean while appearing title-specific. **Not a conditional
benchmark either:** the unconditional interquartile range is 0.755–0.920 (width 0.165) while the
six genre medians span only 0.825–0.867 (width 0.042), so a user selecting a genre would watch the
answer stay still. Those inputs were removed rather than kept as decoration.

What survives is the base rate, which answers the question developers actually have: they cannot
tell whether expecting 0.75 is ordinary caution or a warning sign. The mechanism responds to its
input — 0.70 sits at the 14th percentile, 0.90 at the 67th — and the interface states that the
tested attributes did not explain the variation, so it declines to imply a conditional answer.

**Delay option:** not taken; the base-rate mechanism was validated against the frozen dataset
before deciding, at zero additional collection cost.

## Cost of being wrong

| Risk | Consequence | Mitigation |
|---|---|---|
| Percentile read as a forecast | Positioning anchored on the market, not the title | State in the surface that it describes the market; measure comprehension in the pilot |
| Genre's absence read as a broken tool | Product looks unfinished | Place the non-conditioning disclosure before the input; score comprehension |
| 50-review floor excludes the worst-received titles | Range optimistic at the bottom | Label the floor explicitly |

## What would change this decision

- Genre medians separating by **more than the population spread (0.165)**, against 0.042 here.
- The `is_free` interval narrowing enough to exclude a commercially meaningful effect.
- A predictor with real explanatory power, which would reopen the predictive framing.

## Bounded commitment

Build only the three must-have capabilities in `docs/prd.md`. Reconsider if the pilot's completion
rate falls below 70% or its comprehension measure below 60%.

---

_Signature and date to be entered by the PM. This memo recommends; the approval decision is the
student's, recorded in `records/approvals.md`._
