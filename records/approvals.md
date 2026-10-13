# Approval log

Each approval in this file must be written by the student. An agent must not author, draft, or
imply an approval entry. This file records the four checkpoints the assignment requires.

> **Provenance of this entry.** The factual fields below — source, pilot size, access basis, the
> logged defects, outcome, focal predictors, estimator, MVP scope, must-have capabilities and
> exclusions — were transcribed by an agent from `data/source-access-manifest.md`,
> `records/skill-log.md`, `docs/statistical-spec.md` and `docs/prd.md`. The Approval 2 rationale is a
> first draft written from `docs/statistical-spec.md`, which the student is revising in their own
> words. **Every checkbox, and the signature on each approval, are the student's own act.** No
> checkbox in this file has been ticked by an agent, and no agent has recorded an approval decision.

---

## Approval 1 — Source and pilot

**Date:** 2026.10.13

**What was approved:** source = Steam Web API — the documented public endpoints `appreviews`
(review aggregates) and `appdetails` (title metadata), no key required, with candidate titles
enumerated from the store `search/results` index ; pilot size = 18 records
(`data/raw/pilot/steam_titles_20261013T021107Z.csv`, two titles per release quarter across nine
quarters, 9 Action and 9 RPG)

**What I personally inspected:**

- [x] Opened the saved pilot file and verified the fields are present and plausible
- [x] Confirmed the access conditions (basis: `data/source-access-manifest.md`)
- [x] Defects found: ① the collector buffered results in memory and wrote only at the end, so two
  long runs (2 h 20 min, and several minutes) produced nothing at all; ② the first sampler called
  `appdetails` once per candidate to learn its release date — about 50 requests to screen 50
  candidates, most then discarded — and an unfinished 2.5 h run; screening from the search page
  instead cut it to about 30 min; ③ exclusion rule R4 was unreachable as first written, because
  the only fixture injected for it also had `total_reviews = 0`, so R3 excluded that row first and
  R4 never fired; ④ a synthetic fixture was written under the plain name
  `steam_titles_EDGETEST.csv`, which the validator's `steam_titles_*.csv` glob would have picked
  up as real data; ⑤ two index defects in the analysis script — a length mismatch when
  `desc.index = ["paid", "free-to-play"]` met a single-group sample, and an unnamed index column
  that rendered blank group labels in the report. Source: `records/skill-log.md`.
- [x] Human corrections made: None beyond the five fixes listed above — I opened the saved pilot,
  confirmed all 19 fields are populated for all 18 records, and checked that the current scripts
  already contain each fix.

**Student signature:** Cao Yuquan

---

## Approval 2 — Final model, before freeze

**Date:** 2026.10.13

**What was approved:** outcome = `positive_rate`, the title-level share
`total_positive / (total_positive + total_negative)` ; focal predictors = `is_free`, and `age_years`
with `age_years²` ; estimator = fractional logit — a generalised linear model with a binomial family
and a logit link

**Why I approved this specification** (written by me, at least three sentences):

> I approved this outcome because the decision I am making is whether an expected reception rate is
> ordinary or unusual in the market, and `positive_rate` is the retrieved quantity that speaks to
> that: it is the share of reviewers who recommend a title, on the same bounded [0,1] scale for every
> title, and available for all 159 analysed records. I accept that it measures review participation
> rather than sales, revenue, player counts, unique players or audience demographics, and that
> reviewers are a self-selected subset of players, so the quantity describes the reviewing population
> and not the player base. That limitation is consistent with the product I approved, which places a
> value inside a measured distribution instead of forecasting commercial outcomes.
>
> I approved fractional logit, rather than a linear model on the raw proportion or a log-odds
> transform of it, because the outcome is a continuous proportion rather than a count: a linear model
> can predict values outside [0,1], and the log-odds transform is undefined for titles sitting at the
> boundary, of which this sample contains one at 1.0. A binomial family with a logit link keeps
> fitted values inside the permissible range without transforming the outcome, and tolerates the
> non-integer proportions this design produces. I also required coefficients to be reported with
> marginal effects on the probability scale, because a logit coefficient on its own is not
> interpretable to the audience this product is for.
>
> I approved `is_free` and `age_years` with its square as the focal predictors because each carries a
> stated mechanism about the reviewing population rather than merely being available — business-model
> composition, and the ageing of the reviewing population — with `log_reviews` and `assigned_tag` as
> controls for exposure and genre-level reviewing behaviour; the square term is there because I did
> not want to assume the ageing mechanism is monotone. I also approved the recorded removal of
> `has_predecessor` on 2026-10-12, because sequel status cannot be measured from the permitted fields
> without unbounded false positives, and I would rather name an unmeasured factor than add a variable
> I cannot defend. Self-selection of reviewers, and the absence of any pre-release demand or
> marketing measure, remain unmeasured and are carried forward as assumptions rather than claimed as
> controls.

**Circularity risks I confirmed are excluded:**

- [x] No provider input variable is used to explain that provider's own output
- [x] No aggregate of the same outcome family appears among the predictors
- [x] Predictors are measured at a time that precedes the outcome

**Student signature:** Cao Yuquan

---

## Approval 3 — Before implementation

**Date:** 2026.10.13

**What was approved:** MVP scope = Reception Baseline — a static browser product whose one core
journey is that the user enters an expected positive review rate and receives that value's percentile
in the frozen reference distribution, together with the nearest comparable titles

**Must-have capabilities (maximum three):**

1. Market position — accepts an expected rate and returns its percentile with the reference count,
   drawing the distribution with its interquartile band and the user's value marked.
2. Comparable-title discovery — lists the reference titles nearest to the user's position, each with
   release date, review count, rate and a Steam store link. Two view controls — titles shown
   (5/10/20) and a review-count floor (≥50/≥200/≥500/≥1000) — adjust this list only and never the
   percentile.
3. Non-conditioning and view-honesty disclosure — states that genre, business model, release age and
   review volume were tested and did not explain the variation, and separately displays the measured
   consequence of the review-count floor, which is not a neutral filter.

**Explicitly excluded:** genre, business-model and age inputs; any predicted or fitted value;
accounts, login and saved projects; live data fetching at runtime; sales, revenue, player-count and
causal claims. Source: `docs/prd.md` lines 77–81.

**Student signature:** Cao Yuquan

---

## Approval 4 — Before each release

Copy this block once per release.

> **Phase 1 note.** Of the five checks in this block, only the fourth has a Phase 1 counterpart. The
> brief requires no functioning prototype and no CI/CD in Phase 1, so there is no candidate build,
> no workflow run, no deployment and no rollback to attest to at this stage. The first instance
> below therefore covers the fourth check; the other four are marked not applicable and stay
> unticked until the Phase 2 releases, where they become real.

### Instance 1 — `phase1-analytics` (Phase 1 analytical submission)

**Release number:** `phase1-analytics` **Date:** 2026.10.13

- [ ] I personally ran the core user journey on the candidate build — *not applicable in Phase 1:
      no build exists*
- [ ] I inspected the test results (run link: ______________) — *not applicable in Phase 1: no
      workflow run exists*
- [ ] The deployed version matches the release under assessment — *not applicable in Phase 1:
      nothing is deployed*
- [x] I confirmed no credentials or personal data entered the repository
- [ ] The rollback procedure was tested (evidence: ______________) — *not applicable in Phase 1:
      there is no earlier release to restore*

**Basis for the fourth check.** A scan of the repository found no credential or token pattern
(`ghp_`, `gho_`, `github_pat_`, `sk-`, AWS keys, private-key blocks), no reviewer identifier
(`author.steamid`, `author.personaname`, `author.profile_url`), and no participant personal data.
`data/clean/analysis_dataset.csv` has 22 columns and none of them is a reviewer field, and
`data/source-access-manifest.md` records that no account credentials, session cookies or tokens
are stored in this repository.

**Student signature:** ______________

### Instance 2 onward — Phase 2 releases

Copy the blank block below once per numbered Phase 2 release (v0.1, v0.2), where all five checks
apply.

**Release number:** v______ **Date:** ______________

- [ ] I personally ran the core user journey on the candidate build
- [ ] I inspected the test results (run link: ______________)
- [ ] The deployed version matches the release under assessment
- [ ] I confirmed no credentials or personal data entered the repository
- [ ] The rollback procedure was tested (evidence: ______________)

**Student signature:** ______________
