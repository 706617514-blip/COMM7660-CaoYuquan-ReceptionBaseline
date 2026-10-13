# COMM7660 Individual Project — Working Plan

**Student:** _(name / ID)_
**Repository:** _(GitHub URL)_
**Date:** 9 October 2026
**Data cutoff:** 9 October 2026
**Status:** Draft working plan — Phase 1 in progress

---

## 1. Intended users and decision-maker

**Decision-maker:** the student, acting as product manager, within the effort bound of the
assignment period.

**Intended users (provisional):** small studios and self-publishing developers preparing a
launch, who must decide how to position a title and what reception to expect. Their problem is
specific to a media market: Steam aggregates user evaluation into a public score, and a title's
position in that system is visible to every prospective buyer. A developer who misjudges where a
title will land cannot easily correct the positioning after release.

**Explicitly not claimed:** the demographic composition or platform preferences of this audience.
Genre labels and storefront positioning are not evidence of who the users are. Audience fit
remains an untested assumption carried into Phase 2.

## 2. Two competing concepts

**Concept A — Expected-reception benchmarking tool.** A tool that takes a title's type,
business model, and release characteristics and returns the range of positive review rates
observed for comparable titles, flagging when a title's positioning implies a reception level the
comparable set does not support. The product surface is a positioning check performed before or
shortly after launch.

**Concept B — Cross-market reception gap detector.** A tool that identifies titles whose Chinese-
language and English-language review communities evaluate them differently, framed as a
localisation diagnostic.

**Delay option.** Build the single-market benchmarking surface first, validate the comparability
of the reference set, and defer the second surface until evidence justifies expanding it.

**Why the comparison is made with one analysis rather than two.** Concept B requires a
cross-language comparison of a rate whose voting pool differs by language community. That is a
measurement problem Concept A does not have. Demonstrating the asymmetry with the same dataset
is stronger evidence for the decision than running two separate studies.

## 3. Research question and conceptual rationale

**Research question.** Among Steam titles, which title-level characteristics are associated with
the share of positive reviews a title receives?

**Mechanism.** Three channels are proposed.

*Expectation breach.* A title entering a market where comparable products have established a
quality benchmark is judged against that benchmark. A sequel, a series entry, or a title from a
developer with a prior record carries a higher implicit reference point, so the same delivered
quality can produce a lower positive rate. This predicts lower positive rates for titles with a
predecessor, holding other characteristics constant.

*Business-model composition of the reviewing population.* A free-to-play title is evaluated as an
ongoing service, often after many hours of play and after content updates, while a
premium single-purchase title is evaluated as a finished object at the point of consumption.
These are different measurement instruments applied to different things. This predicts a lower
positive rate for free-to-play titles, and predicts that the effect is not attributable to price
alone.

*Ageing of the reviewing population.* Over a title's life the marginal reviewer changes. Early
reviewers self-select for enthusiasm; later reviewers arrive with different exposure. This
predicts a relationship between time since release and positive rate that is not simply
monotonic.

**Why not data availability as the rationale.** The API exposes these fields because it serves a
storefront, not because they are theoretically interesting. Each predictor below is included
because it carries one of the three mechanisms above.

## 4. Population, sampling frame, period, unit

| Element | Definition |
|---|---|
| Population | Steam titles released within 24 months before the data cutoff |
| Sampling frame | Titles reachable through the Steam store, enumerated by walking the release-date-ordered index under six genre tags |
| Stratification | Quota sample over (genre tag × release quarter) cells, three titles per cell |
| Release period | 9 October 2024 – 9 October 2026 |
| Observation period | Review aggregates retrieved at one declared collection timestamp |
| Unit of analysis | One title per row |
| Sampling target | 100–200 distinct titles |

**Frame limitation.** The frame covers titles the API returns metadata for. A title absent from
the frame is unobserved, not a zero. No conclusion extends to titles outside the frame.

**Stratification rationale.** Genre is the stratification the brief requires, and it is the variable
the analysis must carry. Quarterly cells sit on top of it so that a title's release date does not
become an accidental proxy for its position in the index: without them a depth walk fills up with
the newest titles and leaves `age_years` with almost no variance. The mechanism is in §9a.

**What is deliberately not done.** Titles are not drawn from top-seller or trending lists. A
chart-selected sample describes successful titles rather than the population, and would confound
any genre contrast with commercial success.

**Coverage caveat to state in the results.** Titles released very recently have unstable positive
rates, because early reviewing populations are small and self-selected. The observation window is
therefore recorded and used as an explicit control rather than treated as a nuisance.

## 5. Outcome and predictors

**Outcome.** Positive review rate: `total_positive / (total_positive + total_negative)`.

What it measures: the share of reviewers who recommend the title, aggregated by the platform.
What it does **not** measure: sales, revenue, player counts, unique players, or audience
demographics. It is a proportion over reviewers, and reviewers are a self-selected subset of
players. It also does not measure review volume, which is a separate quantity and is analysed
separately.

**Justification for the scale.** The outcome is a proportion bounded in [0,1] over a count. Its
denominator varies substantially across titles, from thousands to millions. This motivates
weighting by the number of reviews, and testing whether conclusions hold under an unweighted
specification as a sensitivity analysis.

### Focal predictors

| Variable | Role | Proposed mechanism |
|---|---|---|
| `is_free_to_play` | Focal | Business-model composition of the reviewing population |
| `has_predecessor` | Focal | Expectation breach from an established benchmark |
| `years_since_release` | Focal | Ageing of the reviewing population; tested for non-linearity |

### Title-level feature, coded from retrieved descriptions

| Variable | Role |
|---|---|
| `genre_multiplayer_emphasis` | Coded from the retrieved store description and category list. Distinguishes titles whose core loop is social or competitive from those whose core loop is single-player. Required by the brief as a narrative or gameplay feature. |

### Controls

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

## 6. Provisional model

$$ \text{logit}(p_i) = \beta_0 + \beta_1 \text{IsFreeToPlay}_i + \beta_2 \text{HasPredecessor}_i + \beta_3 \text{YearsSinceRelease}_i + \beta_4 \text{YearsSinceRelease}_i^2 + \gamma' \mathbf{C}_i + \varepsilon_i $$

where $p_i$ is the positive review rate and $\mathbf{C}_i$ the control vector.

**Why this method.** The outcome is a proportion, which rules out an untransformed linear
specification as a default. A logistic specification on the logit scale is the standard
treatment. Because the outcome is an aggregate rather than an individual outcome, the fit is
weighted by the number of reviews behind each proportion, and the weighting decision is tested in
a sensitivity analysis rather than assumed.

**Estimator note.** The final estimator, including how the weighting is implemented and whether
overdispersion requires an adjustment, is fixed in `docs/statistical-spec.md` after the pilot.
It is recorded here as provisional.

## 7. Prototype boundary and success criteria

**Provisional boundary.** A browser application where a user enters a title's characteristics and
receives the modelled expected range of positive review rates for comparable titles, with the
uncertainty of that range displayed.

**Success criteria for the plan itself:** the pilot yields usable variation in the outcome; the
genre stratification produces non-trivial group sizes; the missing-data rules do not remove a
large share of records. If the pilot falsifies any of these, the plan is amended and the
amendment logged before the model is frozen.

## 8. Sources

Academic:

1. Deng, W., Yi, M., & Lu, Y. (2020). Vote or not? How various information cues affect helpfulness
   voting of online reviews. *Online Information Review*. https://doi.org/10.1108/oir-10-2018-0292
2. Guzsvinecz, T., & Szűcs, J. (2023). Length and sentiment analysis of reviews about top-level
   video game genres on the Steam platform. *Computers in Human Behavior*.
   https://doi.org/10.1016/j.chb.2023.107955
3. Kong, J., & Lou, C. (2023). Do cultural orientations moderate the effect of online review
   features on review helpfulness? *Journal of Retailing and Consumer Services*.
   https://doi.org/10.1016/j.jretconser.2023.103374

Platform:

4. Valve. (n.d.). *User reviews — Get list*. Steamworks Documentation.
   https://partner.steamgames.com/doc/store/getreviews

## 9. Pilot findings and the amendment they produced

A feasibility pilot was run on 9 October 2026 before this plan was frozen. It changed the design.
The change is recorded here rather than silently absorbed.

**What the pilot tested.** Two candidate outcomes were checked for usable variation: the
per-review helpfulness score, and the title-level positive review rate.

**Finding 1.** The per-review helpfulness score has near-zero usable variance. Across 900 reviews
from nine titles its standard deviation was 0.072 and its range was 0.68 to 0.99, with no
observations at either bound. Within a single title the standard deviation was 0.038.

**Finding 2.** That score is close to a monotone transform of the raw upvote count. Its
correlation with the log of upvotes was 0.896 within one title. Using it as an outcome would
largely reconstruct an existing platform quantity rather than estimate a relationship.

**Finding 3.** The brief specifies a title-level unit of analysis. A per-review outcome was
therefore misaligned with the required design independently of its variance.

**Amendment.** The unit of analysis moved from the review to the title, and the outcome moved
from the per-review helpfulness score to the title-level positive review rate. The pilot
established that the new outcome has usable variation: across 40 titles its standard deviation
was 0.098 and its range 0.605 to 0.987.

This amendment precedes the frozen specification and is therefore not an outcome-informed change
to a tested hypothesis. It is a feasibility correction, made before hypothesis testing.

## 9a. Sampling mechanism, and two collection attempts that failed

The frame is the Steam release index sorted newest-first. Page depth maps monotonically to release
date, so deep pages reach older titles. What makes the sampling non-obvious is that **one page of 50
candidates covers only one or two release days**. Measured on 12 October 2026:

| Depth | Date reached | Depth | Date reached |
|---|---|---|---|
| 0 | 2026-10-08 | 24 500 | 2025-05-20 |
| 4 000 | 2026-08-21 | 30 000 | 2024-12-02 |
| 8 000 | 2026-06-15 | 32 000 | 2024-10-09 (window start) |
| 16 000 | 2025-12-18 | 100 000 | empty (index ends near 90 800) |

Because a page is so narrow in time, walking pages in order spends almost every request confirming
that a page is in the wrong period. The mechanism finally adopted:

1. **Screen from the search page.** Each result row carries the appid and the release date in the
   endpoint's own `results_html`, so one request screens 50 candidates for date. The earlier version
   called `appdetails` once per candidate to learn that date — about 50 requests to screen 50
   candidates, most discarded anyway.
2. **Seek the page for each cell.** For each (sampling tag, release quarter) cell, interpolate a
   depth from observed (depth, date) pairs and step until the page actually brackets the target
   date. Every page visited becomes a new calibration point, so the depth/date map is measured
   rather than assumed.
3. **Quota per cell.** Accept up to three titles per cell, screening dates for free and spending a
   review call only on candidates already known to be in the window and in the right quarter.

**Two failed attempts, recorded because they shaped the final design.** The first full run was
launched under `nohup` and died after 2 h 20 min having written nothing: the script accumulated
results in memory and wrote only at the end, so an interruption discarded all of it. The second died
the same way within minutes. Both were fixed by checkpointing after every accepted title and
resuming from the checkpoint, and by running collection as a supervised background job rather than a
detached process. The per-candidate screening cost described above was the other half of the fix:
it turned a run that could not finish into one that completes in about half an hour.

**Honest limitation.** Recent quarters yield fewer qualifying titles than older ones, because a
title released a few months ago often has fewer than the 50 reviews this design requires. The
threshold was declared before collection and is **not** relaxed afterwards; the realised cell counts
are reported in `records/extraction-audit.md` and the collection audit rather than smoothed over.

## 10. Pilot and approval sequence

1. Collect 10–20 pilot records through the documented endpoint. **Completed 9 October 2026.**
2. Inspect the saved pilot personally. Record defects found. **Pending.**
3. Freeze a dated analysis plan before substantive hypothesis testing.
4. Label any later outcome-informed change as exploratory and log the amendment.
