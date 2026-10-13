# Working plan — appendix

The brief sets the working plan at 600–800 words. `docs/working-plan.md` now sits inside that
limit, and this appendix holds the detail that was moved out to get there. Nothing was
deleted: the prose below is the original text of the plan's earlier, longer sections.

The plan does not depend on this appendix for its meaning. It is here so that the reasoning
behind each plan decision is still readable, and so that the trimming is visible rather than
silent.

---

## A1. Conceptual rationale in full — from the plan's §3

**Mechanism.** Three channels are proposed.

*Expectation breach.* A title entering a market where comparable products have established a
quality benchmark is judged against that benchmark. A sequel, a series entry, or a title from a
developer with a prior record carries a higher implicit reference point, so the same delivered
quality can produce a lower positive rate. This predicts lower positive rates for titles with a
predecessor, holding other characteristics constant.

**Status: withdrawn.** This channel was operationalised as `has_predecessor`. The frozen
specification dropped that variable on 12 October 2026 because sequel status cannot be measured
from the permitted fields without unbounded false positives. It is recorded here as withdrawn so
that the plan and the specification can be read together without contradiction. The amendment is
entry 2 in the amendment log of `docs/statistical-spec.md`.

*Business-model composition of the reviewing population.* A free-to-play title is evaluated as an
ongoing service, often after many hours of play and after content updates, while a premium
single-purchase title is evaluated as a finished object at the point of consumption. These are
different measurement instruments applied to different things. This predicts a lower positive rate
for free-to-play titles, and predicts that the effect is not attributable to price alone.

*Ageing of the reviewing population.* Over a title's life the marginal reviewer changes. Early
reviewers self-select for enthusiasm; later reviewers arrive with different exposure. This
predicts a relationship between time since release and positive rate that is not simply monotonic.

**Why not data availability as the rationale.** The API exposes these fields because it serves a
storefront, not because they are theoretically interesting. Each predictor in the plan is included
because it carries one of the three mechanisms above.

## A2. Sampling and frame notes — from the plan's §4

**Stratification rationale.** Genre is the stratification the brief requires, and it is the
variable the analysis must carry. Quarterly cells sit on top of it so that a title's release date
does not become an accidental proxy for its position in the index: without them a depth walk fills
up with the newest titles and leaves `age_years` with almost no variance. The mechanism is in §9a
of the plan.

**What is deliberately not done.** Titles are not drawn from top-seller or trending lists. A
chart-selected sample describes successful titles rather than the population, and would confound
any genre contrast with commercial success.

**Coverage caveat to state in the results.** Titles released very recently have unstable positive
rates, because early reviewing populations are small and self-selected. The observation window is
therefore recorded and used as an explicit control rather than treated as a nuisance.

## A3. Outcome and predictor detail — from the plan's §5

**Justification for the scale.** The outcome is a proportion bounded in [0,1] over a count. Its
denominator varies substantially across titles, from thousands to millions. This motivates
weighting by the number of reviews, and testing whether conclusions hold under an unweighted
specification as a sensitivity analysis.

**Proposed mechanisms, one per focal predictor.**

| Variable | Role | Proposed mechanism |
|---|---|---|
| `is_free_to_play` | Focal | Business-model composition of the reviewing population |
| `has_predecessor` | Focal | Expectation breach from an established benchmark — **withdrawn**, see A1 |
| `years_since_release` | Focal | Ageing of the reviewing population; tested for non-linearity |

**Title-level feature, coded from retrieved descriptions.**

| Variable | Role |
|---|---|
| `genre_multiplayer_emphasis` | Coded from the retrieved store description and category list. Distinguishes titles whose core loop is social or competitive from those whose core loop is single-player. Required by the brief as a narrative or gameplay feature. |

**Controls.**

| Variable | Role |
|---|---|
| Primary genre (categorical) | Absorbs genre-level differences in reviewing behaviour |
| `log(review_count)` | Absorbs exposure. A rate estimated from more reviews is more precise, and volume correlates with visibility. |
| Price band (categorical) | Distinguishes free, low, mid, and high price tiers without assuming a linear price effect |
| Release year (categorical) | Absorbs period effects not captured by the continuous age term |

**Important unmeasured factors.** Developer reputation beyond having a predecessor; marketing
spend; the technical state of the build at launch; regional pricing; whether the title was in
early access; and whether an external event affected reception. These are named rather than
claimed as controlled.

**Circularity check.** The outcome is a review aggregate. Review count appears as a control, not
as a predictor of the rate's direction, and is itself analysed as a separate descriptive
quantity. No predictor is an input to the platform's computation of the outcome.

## A4. Estimator note — from the plan's §6

**Estimator note.** The final estimator, including how the weighting is implemented and whether
overdispersion requires an adjustment, is fixed in `docs/statistical-spec.md` after the pilot.
It is recorded in the plan as provisional.

It was fixed there as a fractional logit — a binomial GLM with a logit link — with the unweighted
fit primary and the review-weighted fit carried as a pre-declared sensitivity analysis rather than
as the default.
