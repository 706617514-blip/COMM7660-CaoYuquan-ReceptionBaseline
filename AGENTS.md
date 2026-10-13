# AGENTS.md

Project instruction file for agent-assisted work on this repository.
Required by the COMM7660 assignment brief (see `docs/assignment-compliance-notes.md`).

## Approved scope

**Phase 1 (5–19 October 2026)** — Media analytics and product justification.

- Population: Steam titles released within 24 months before the declared data cutoff.
- Unit of analysis: one title. Each row is a distinct game. Repeated observations of the same
  title are not independent titles and must not be entered as separate rows.
- Outcome: title-level positive review rate (`total_positive / (total_positive + total_negative)`).
- Sampling target: 100–200 distinct titles, stratified across genres.
- Deliverable: executed analysis, conceptual and statistical model, decision memo, proposed PRD.

**Phase 2 (20 October – 19 November 2026)** — Prototype delivery and evaluation.

- Bounded MVP justified by the Phase 1 decision.
- Two numbered releases, executed CI/CD, a small user pilot, a tested revision.

**Out of scope for Phase 1:** any product implementation beyond what is needed to describe the
prototype boundary. Phase 1 requires executed analysis, not a proposal and not a prototype.

## Data restrictions

| Rule | Detail |
|---|---|
| Permitted primary source | Steam Web API `appreviews` and `appdetails` endpoints (documented, public, no key required) |
| Prohibited | Scraping SteamDB; collecting personal account cookies; bypassing any rate limit, paywall, or bot control |
| Prohibited | Committing reviewer usernames, Steam IDs, avatar hashes, or raw review text to the public record |
| Permitted index navigation | Steam store `search/results` endpoint, used to enumerate candidate titles and their release dates. Not a source of outcome data. |
| Raw data | Read-only after collection. Cleaning happens in code and writes to `data/clean/`. |
| Synthetic data | Allowed only for testing software. Paths must carry a `synthetic_` prefix. Never used as evidence for analysis conclusions. |
| Source acknowledgement | Steam/Valve attribution recorded in `data/source-access-manifest.md` |

## Analytical specification

The frozen specification lives in `docs/statistical-spec.md`. Do not change the outcome,
predictors, or estimator without a recorded amendment and a PM approval entry.

## Test commands

```bash
# Collection (writes data/raw/steam_titles_<stamp>.csv and a collection audit)
python analysis/collect_titles.py

# Exclusion-rule fixture test: one injected defect per rule, asserts attribution
python analysis/test_validate_rules.py

# Data integrity checks (newest raw file -> data/clean/ + records/extraction-audit.md)
python analysis/validate_data.py

# Analysis reproduction (regenerates analysis/results/ and the figures)
python analysis/analyze_and_report.py

# Feature-coding sheet: 20% subsample with the outcome column withheld
python analysis/make_coding_sheet.py

# Phase 2 product: regenerate the frozen reference distribution from the dataset
python analysis/build_product_data.py

# Phase 2 product: functional test of product/index.html (DOM shim, no browser needed)
node tests/test_product_app.js

# Phase 2 product: bundle into ONE self-contained .html for distribution by email
python3 analysis/build_standalone_html.py

# Compliance check on the produced .docx files (word count, table/figure limit, access block,
# APA formatting). Run before submitting; exit code 0 = compliant.
python3 analysis/check_report_compliance.py

# Independent verification: a hand-calculation worksheet the PM completes.
# There is deliberately no script for this step. See records/independent-verification.md
```

The verification step has no command on purpose. Re-running the analysis script cannot verify the
analysis script — a bug in it would be reproduced in its own output. Verification must recompute a
few quantities from the raw counts by a different method. `records/independent-verification.md` is
the worksheet for that, and an agent must not fill it in.

All scripts accept `--input` / `--out` so a run can be pointed at a fixture without touching
the real dataset. `validate_data.py` refuses to write a file whose name starts with
`synthetic_` to any output that does not also start with `synthetic_`, so test fixtures cannot
overwrite `data/clean/analysis_dataset.csv`.

Synthetic fixtures live outside the repository or under a `synthetic_` prefix. They are never
evidence for a conclusion.

## Approval points

Four approval checkpoints are mandatory. They are recorded in `records/approvals.md` and each
one must be authored by the student, not by an agent.

1. After source selection and pilot collection
2. Before freezing the final model specification
3. Before starting implementation
4. Before each release

## Agent boundaries

Agents working in this repository must not:

- Change the statistical model, product scope, acceptance criteria, spending limits, or
  publication destination without explicit PM approval.
- Generate, alter, or infer user feedback, pilot records, or execution claims. Fabricating
  records is a direct violation of the assignment terms.
- Act as the second coder while having access to the first coding pass. The two passes must be
  isolated.
- Use model memory to code title-level features. Coding must be grounded in the retrieved source
  description.
- Bypass any access control, rate limit, or login restriction.
- Sign, write, or imply a PM approval decision.
- Treat its own completion claim as evidence. A task is complete only when the PM has inspected
  the output.

## Attribution policy

Skills adapted from third-party sources retain their original attribution and version in the
skill's own `SKILL.md` and in `records/skill-log.md`.
