# COMM7660 Individual Project — Working Plan

**Student:** Cao Yuquan — student identifier 26366290
**Repository:** <https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline>
**Date:** 9 October 2026, amended 12–13 October 2026
**Data cutoff:** 9 October 2026
**Status:** Plan in force. The model specification it led to is frozen in `docs/statistical-spec.md`.

**Length and scope of this document.** Sections 1–7 are the working plan and run to **767 words**,
inside the brief's 600–800. The count excludes the table rows and the source list in §8, which is a
reference list rather than prose. Sections 9 onwards are appended records — the pilot findings, the
sampling mechanism, and the approval sequence — and are not part of the plan's word budget. Detail
trimmed from §1–7 to reach the limit is kept in `docs/working-plan-appendix.md`, which the plan
links to where it matters and does not depend on for meaning.

---

## 1. Intended users and decision-maker

**Decision-maker:** the student, acting as product manager, within the effort bound of the
assignment period.

**Intended users (provisional):** small studios and self-publishers preparing a launch. Their
problem is specific to a media market. Steam aggregates user evaluation into a public score shown
on every store page, but never publishes the distribution behind it, so a developer cannot tell
whether expecting a 0.75 positive rate is ordinary caution or a warning sign, and positioning is
hard to correct after release.

**Explicitly not claimed:** the demographic composition or platform preferences of this audience.
Genre labels and storefront positioning are not evidence of who users are. Audience fit remains an
untested assumption carried into Phase 2.

## 2. Two competing concepts

**Concept A — expected-reception benchmarking.** Takes a title's characteristics and returns the
range of positive review rates observed for comparable titles, flagging a positioning that implies
a reception level the comparable set does not support.

**Concept B — cross-market reception gap detector.** Identifies titles whose Chinese-language and
English-language review communities evaluate them differently, framed as a localisation diagnostic.

**Delay option.** Build the single-market benchmarking surface first, validate the comparability of
the reference set, and defer the second surface until evidence justifies expanding it.

Concept B needs a cross-language comparison of a rate whose voting pool differs by community — a
measurement problem Concept A does not have. Demonstrating that asymmetry in one analysis is
stronger evidence for the decision than two separate studies.

## 3. Research question and conceptual rationale

**Research question.** Among Steam titles, which title-level characteristics are associated with
the share of positive reviews a title receives?

**Three channels are proposed.** *Business-model composition:* free-to-play titles are evaluated as
an ongoing service and premium titles as a finished object, so the two are different measurement
instruments and free-to-play should show the lower rate. *Ageing of the reviewing population:* the
marginal reviewer changes over a title's life, predicting a non-monotonic relationship with time
since release. *Expectation breach:* a title judged against an established benchmark is held to a
higher reference point. This third channel was operationalised as `has_predecessor`, which the
frozen specification dropped on 12 October 2026 because sequel status is not measurable from the
permitted fields without unbounded false positives; it is recorded as withdrawn.

Each predictor below carries one of those mechanisms. Data availability is not a rationale, and the
full mechanism text is in [`docs/working-plan-appendix.md`](working-plan-appendix.md) §A1.

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

Titles absent from the index are unobserved, not a zero, and no conclusion extends outside the
frame. Quarters are stratified on top of genre so that release date does not become an accidental
proxy for position in the index: without them a depth walk fills with the newest titles and leaves
`age_years` with almost no variance. The mechanism is in §9a below. Titles are deliberately not
drawn from top-seller or trending lists, which would describe successful titles rather than the
population. Fuller notes, including the coverage caveat for very recent releases, are in
[`docs/working-plan-appendix.md`](working-plan-appendix.md) §A2.

## 5. Outcome and predictors

**Outcome.** Positive review rate: `total_positive / (total_positive + total_negative)`. It measures
the share of reviewers who recommend the title, not sales, revenue, player counts, unique players or
audience demographics; and because reviewers are a self-selected subset of players it describes the
reviewing population rather than the player base. Review volume is analysed separately.

| Variable | Role | Proposed mechanism |
|---|---|---|
| `is_free` | Focal | Business-model composition of the reviewing population |
| `age_years`, squared | Focal | Ageing of the reviewing population; tested for non-linearity |
| `assigned_tag` | Control | Genre-level differences in reviewing behaviour |
| `log_reviews` | Control | Exposure, and the precision of a rate |
| `multiplayer_emphasis` | Feature | Derived from the retrieved category list; the brief's required gameplay feature |

**Unmeasured factors**, named rather than claimed as controlled: developer reputation, marketing
spend, launch build quality, regional pricing, and external events affecting reception. Coding
values, units, missing-data rules and model roles are in [`docs/codebook.md`](codebook.md); the
circularity check and the control list this table replaced are in
[`docs/working-plan-appendix.md`](working-plan-appendix.md) §A3.

## 6. Provisional model

$$\text{logit}(\mathbb{E}[p_i]) = \beta_0 + \beta_1 \text{IsFree}_i + \beta_2 \text{Age}_i + \beta_3 \text{Age}_i^2 + \beta_4 \log(1 + \text{Reviews}_i) + \sum_k \gamma_k \text{Tag}_{ik}$$

**Why this method.** The outcome is a proportion, which rules out an untransformed linear
specification as a default, and a log-odds transform of the raw proportion is undefined at the
boundaries. The estimator was fixed after the pilot in
[`docs/statistical-spec.md`](statistical-spec.md) as a fractional logit, with the unweighted fit
primary and the review-weighted fit carried as a pre-declared sensitivity analysis rather than as
the default. The equation above is that frozen form; the earlier provisional version in the
appendix carried `has_predecessor` and a wider control vector.

## 7. Prototype boundary and success criteria

**Provisional boundary.** A browser application in which a user enters an expected positive review
rate and receives its position in the distribution of comparable titles, with the uncertainty of
that position displayed.

**Success criteria for the plan itself:** the pilot yields usable variation in the outcome; the
genre stratification produces non-trivial group sizes; and the missing-data rules do not remove a
large share of records. If the pilot falsifies any of these, the plan is amended and the amendment
logged before the model is frozen.

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

**Status of the pilot artifact.** The 40-title feasibility check above informed the design, but its
file was not retained: the two collections dated 9 October 2026 were collector smoke tests written
to temporary directories, and the feasibility file itself is gone. A saved pilot of 18 records was
therefore collected through the same documented endpoints and the same approved sampling rule on
13 October 2026, and lives in `data/raw/pilot/`. The gap is recorded here rather than presented as
though the original had been kept.

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

1. Collect 10–20 pilot records through the documented endpoint. **Completed 9 October 2026**, and a
   saved 18-record pilot was collected on 13 October 2026 after the original artifact was found not
   to have been retained (see the note in §9).
2. Inspect the saved pilot personally. Record defects found. **Completed 13 October 2026**;
   recorded in `records/approvals.md`, Approval 1.
3. Freeze a dated analysis plan before substantive hypothesis testing. **Completed 12 October
   2026**; the frozen specification is `docs/statistical-spec.md`.
4. Label any later outcome-informed change as exploratory and log the amendment. **In force.** The
   amendment log in `docs/statistical-spec.md` carries two entries, both made before the model was
   first executed on real data.
