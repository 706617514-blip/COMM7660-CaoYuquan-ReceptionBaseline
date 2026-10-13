# Product requirements document

**Product:** Reception Baseline — a Steam game-discovery and audience-reception tool
**Status:** Revised after execution — pending PM approval before implementation
**Phase:** Phase 1 proposal; implemented in Phase 2

> **Revision note.** The first draft took genre, business model and release age as inputs and
> returned a range for "comparable" titles. That fails: the unconditional interquartile range is
> 0.755–0.920 (width 0.165) while the six genre medians span only 0.825–0.867 (width 0.042), so a
> user would select a genre and watch the answer stay still. Those inputs were removed rather than
> kept as decoration.

---

## Product type and why it qualifies

A **media app** addressing a **media-discovery and audience-engagement** need for games. Its
endpoint is content: the user is taken to specific real games they can open and evaluate. It is
narrower than the "generic dashboard" the brief excludes — it serves a media-specific user,
discovers titles, and encodes a domain finding. The model does **not** run in the interface; it
determined which outputs are honest to offer.

## Intended user and problem

A small studio or self-publishing developer preparing a Steam launch, without market-research
capacity. Two things are missing. They cannot tell whether expecting a 0.75 positive review rate is
ordinary caution or a warning sign, because Steam shows a score on every store page but never the
distribution behind it. And they have no fast route from "where I expect to land" to "the games that
landed there". No demographic claim is made about this user.

## Main benefit and differentiation

**Benefit.** Two connected answers in one task: *where your expectation sits* ("0.75 is the 14th
percentile of recent releases") and *who else is there* (the ten nearest titles, each linking to its
Steam store page).

**Differentiation.** The tool deliberately does **not** condition on genre, business model, release
age or review volume, and says so in the interface — those attributes explained under 1% of the
variation, so selecting them would perform a choice that changes nothing. It stops at discovery
rather than pretending to forecast. Refusing to fake conditioning, and handing the user real content
instead of a predicted score, is the product's claim.

## Core user journey

1. User opens the page and reads one sentence on what the tool does, followed by what it
   deliberately does not do.
2. User enters one number: the positive review rate they expect.
3. The product shows that value's percentile with the reference count, and draws the full
   distribution with the user's value marked.
4. The product lists the ten titles nearest that position, each with release date, review count,
   rate, and a link to its Steam store page.
5. User opens one or more of those stores to inspect them — the discovery step — then returns,
   adjusts the value, and both the percentile and the list update; or resets.

## Must-have capabilities (maximum three)

1. **Market position.** Accepts an expected positive review rate; returns its percentile in the
   frozen distribution with the reference count, and draws the distribution with its interquartile
   band and the user's value marked.
2. **Comparable-title discovery.** Lists the reference titles nearest to the user's position,
   each with release date, review count, rate, and a link to its Steam store page. This is the media
   content the tool delivers the user to. Two view controls adjust **this list only** — the number
   of titles shown (5 / 10 / 20) and a review-count floor (≥50 / ≥200 / ≥500 / ≥1000). Neither
   changes the percentile.
3. **Non-conditioning and view-honesty disclosure.** States that genre, business model, release age
   and review volume were tested and did not explain the variation, so no attribute-specific answer
   is offered. Separately, and because the review-count floor is **not** a neutral filter, it
   displays the measured consequence of that floor: the filtered set's mean rate and how far it sits
   above the full reference set's. Also states the reference set (recent Steam releases with at least
   50 reviews), that the rate is a share over self-selected reviewers, and that this is a benchmark,
   not a forecast.

## Exclusions and resource limits

| Excluded | Reason |
|---|---|
| Genre, business model, age inputs | Tested and found not to explain the variation; offering them would imply an effect the analysis does not support |
| Any predicted or fitted value | At this explanatory power a fitted value restates the sample mean, presented as title-specific |
| Accounts, login, saved projects | Not needed to test the core benefit |
| Live data fetching at runtime | The distribution and title list are frozen from the analysis dataset; runtime fetching adds failure modes without testing the benefit |
| Sales, revenue, player-count or causal claims | Not measured here, and the design does not identify causal effects |

**Resource limits.** Static browser application; no server-side component, no paid services, no
runtime dependency on any external API. Store links open in a new tab.

## Assumption to test

> A developer preparing a launch finds their expectation located in a population distribution, and
> the titles nearest to it, more useful than their existing intuition — **without** attribute
> conditioning.

Explicitly **untested**: Phase 1 observes existing titles, not developer behaviour. It is also the
riskiest part of the design, since a user may expect a genre to change the answer and read its
absence as a broken tool. The pilot tests whether the disclosure prevents that reading and whether
the discovery list is actually used.

## Success measures and thresholds

| Measure | Definition | Threshold |
|---|---|---|
| **Primary:** completion rate | Eligible attempts reaching a displayed percentile ÷ attempts begun, within one declared release and observation window | ≥ 70% |
| **Secondary:** comprehension | Participants who, when asked, correctly state that the answer does **not** depend on genre or business model (observed by task question, not self-reported) | ≥ 60% |
| **Secondary:** discovery use | Participants who open at least one store link from the comparable-title list during the task | ≥ 50% |
| **Guardrail:** error rate | Attempts producing an error, an unsupported-input response, or an out-of-range value | ≤ 5% |

The comprehension measure catches a user who finishes while misreading what they were told; the
discovery measure catches a tool whose list is never opened — a dashboard with extra markup. All
measures report counts and participant numbers alongside percentages.

## Evidence-to-feature links

| Evidence | Feature decision | Acceptance check |
|---|---|---|
| Pseudo-R² 0.007; no focal coefficient distinguishable from zero | No fitted or predicted value anywhere | No prediction appears in the interface or stored output |
| IQR width 0.165 vs genre-median span 0.042 | Genre, business model and age **removed** as inputs; disclosure is a must-have | Selecting a genre is impossible; disclosure is on the opening screen |
| 0.70 → 14th percentile; 0.90 → 67th; 159 real named titles; 50-review floor | Market position plus comparable-title discovery with store links | Any in-range value returns a percentile, the reference count, and ten linked titles |
| Review count correlates with the rate (r = +0.171); the ≥500 floor moves the mean from 0.823 to 0.864 | The review floor may not silently change the answer: it filters the list only, and its measured shift is displayed | Changing the floor leaves the percentile unchanged, and the shift notice appears whenever the floor exceeds 50 |
| **Untested:** a position plus its neighbours is useful | The whole interaction rests on this | Completion, comprehension and discovery measures met |

## Acceptance criteria

- [ ] Entering any rate from 0 to 1 returns a percentile and the reference count
- [ ] The percentile is strictly monotone in the entered value
- [ ] The distribution is drawn with the user's value marked whenever a percentile is drawn
- [ ] The comparable-title list shows the selected count (5 / 10 / 20) of titles, ordered by distance from the entered value
- [ ] Changing the display count or the review floor does **not** change the percentile
- [ ] Every listed title satisfies the selected review-count floor
- [ ] When the floor exceeds 50, the interface states the filtered set's mean and its gap from the full reference set
- [ ] Every listed title links to `store.steampowered.com/app/<id>/` in a new tab with `rel="noopener noreferrer"`
- [ ] Changing the entered value changes the list
- [ ] No genre, business model or age input exists in the interface
- [ ] The non-conditioning disclosure is visible on the opening screen without scrolling at 1280×800
- [ ] Out-of-range input produces a stated error, not a silent failure
- [ ] Reloading returns the product to its opening state
- [ ] Keyboard-only operation reaches the input, the reset control, and the store links

## Approval, review and rollback

**Approving PM:** the student. **Review location:** a pull request in the project repository, plus
the Phase 2 GitHub Release. **Rollback:** restore the previous numbered release, with the procedure
recorded in `docs/release-notes.md` during Phase 2.
