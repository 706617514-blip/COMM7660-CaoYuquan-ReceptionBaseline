# COMM7660 Individual Project — Media Analytics and Product Prototype

**Student:** Cao Yuquan — student identifier 26366290
**Repository:** <https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline>
**Media product:** Reception Baseline — a base-rate locator for expected Steam reception
**Intended audience:** small studios and self-publishers preparing a Steam launch
**Collaborator:** `fffchaobu` (Professor Charles Feng) — invited 2026-10-13 — status **accepted**
(invitation id 337417458, write permission, confirmed on 2026-10-13 via the repository's
collaborator list). Access is retained through both phases and the review period.

## Submission deadlines

| Phase | Period | Deadline | Weight |
|---|---|---|---|
| Phase 1 — Media analytics and product justification | 5–19 October 2026 | Monday, 19 October 2026 | 70 |
| Phase 2 — Prototype delivery and evaluation | 20 October – 19 November 2026 | Thursday, 19 November 2026 | 30 |

## Submitted phase versions

| Phase | Tag / release | Full commit identifier | Moodle report |
|---|---|---|---|
| Phase 1 | `phase1-analytics` tag and GitHub Release | `43e2dbde3962e458397211133fc2f0fd05b061dd` | `reports/COMM7660_Phase1_report.docx`, attached to the release |
| Phase 2 | `v0.2-submission` | _(to be recorded at tag time)_ | _(attached to the release)_ |

## Phase 1 review route

1. [Working plan](docs/working-plan.md) — scope, concepts, sampling frame, provisional model
2. Data and codebook — `data/`, [codebook](docs/codebook.md), [access manifest](data/source-access-manifest.md)
3. Model and rationale — [statistical specification](docs/statistical-spec.md)
4. Principal findings — [results](docs/results.md)
5. Development decision — [decision memo](docs/decision-memo.md), [proposed PRD](docs/prd.md),
   evidence-to-feature record
6. References — [APA list](docs/references.md), [BibTeX](docs/references.bib)

**Moodle report:** `reports/COMM7660_Phase1_report.docx`. APA 7 (Times New Roman 12 pt, double
spaced, 1-inch margins, 0.5-inch first-line indent, three-line tables), with the required access
block. A Chinese reading copy is in `reports/COMM7660_Phase1_report_ZH.docx` — **not** a submission
file.

## Submission compliance

The Phase 1 report is held to word and structure limits that the brief states precisely. Verify the
produced file before submitting:

```bash
python3 analysis/check_report_compliance.py     # exit code 0 = compliant
```

| Brief requirement | Status |
|---|---|
| Report 1,000–1,200 words, excluding access block, references, tables and figures | ✅ ~1,024–1,064 (builder vs independent checker) |
| At most two main tables/figures | ✅ 1 table + 1 figure |
| Full outputs and appendices belong in GitHub, not the report | ✅ no appendix in the report |
| Access block: title, name, identifier, phase, repository, collaborator `fffchaobu` + status, release/tag, commit identifier | ✅ all fields present (4 need the student's values) |
| Decision memo ~1 page | ✅ ~0.95 page |
| PRD 1–2 pages | ✅ ~1.9 pages |
| Double-code 20% of titles, minimum 20 | ✅ 32 titles coded from descriptions with the outcome withheld; 26 of 31 codeable rows agree with the derived label, Cohen's kappa 0.566 ([agreement report](records/coding-agreement.md)) |
| Verify key fields in a random 10%, minimum 20 | ✅ 20 titles re-read from the same documented endpoints, 11 fields each, 206 of 220 values identical and 0 mismatches ([field verification](records/field-verification.md)) |
| 100–200 distinct titles, title-level unit | ✅ 159 titles, one row per title |

The checker reads the finished `.docx` from disk rather than trusting the builder's internal count,
so it catches disagreement between what the builder intended and what the file contains.

## Phase 1 outcome in one line

159 titles were collected across 6 genre strata and 9 release quarters. The declared attributes —
business model, age, review volume, genre, and a derived multiplayer feature — were found to
explain under 1% of the variation in positive review rate (pseudo-R² 0.007), and no focal
coefficient is distinguishable from zero. This is a negative result, and it is reported as one.

The product was narrowed **twice** as a result. Predicted values were ruled out by the model. A
conditional range was then ruled out by checking it: the unconditional interquartile range is
0.755–0.920 (width 0.165) while the six genre medians span only 0.825–0.867 (width 0.042), so a user
who selected a genre would watch the answer stay still. `docs/prd.md` therefore specifies a
**base-rate locator**: the user enters an expected reception rate and learns its percentile in the
population, with the interface stating explicitly that the tested attributes did not explain the
variation.

## Phase 2 review route

_(populated during Phase 2)_

Working prototype, changes from Phase 1, tests, workflow runs, pilot findings, final
recommendation.

## Reproducing the analysis

```bash
pip install -r requirements.txt

# 0. Re-collect the raw records from the documented endpoints (optional; takes ~30 min)
python analysis/collect_titles.py

# 1. Exclusion-rule fixture test: one injected defect per rule
python analysis/test_validate_rules.py

# 2. Validate the frozen dataset -> data/clean/ + records/extraction-audit.md
python analysis/validate_data.py

# 3. Reproduce the analysis -> analysis/results/ (model_summary, coefficients, figures)
python analysis/analyze_and_report.py

# 4. Feature-coding sheet (20% subsample, outcome withheld), then score it
python analysis/make_coding_sheet.py
python analysis/make_coding_sheet.py --score records/coding-sheet-round1-filled.csv

# 5. Independent verification: no command. Complete the hand-calculation
#    worksheet in records/independent-verification.md personally.
```

The verification step intentionally has no script: re-running the analysis cannot verify the
analysis, because a bug in it would be reproduced in its own output. It is recomputed from the raw
counts by a different method, and the student fills it in.

Software versions and the random seed are recorded in `docs/results.md`.

Every script accepts `--input` and `--out`, so any step can be pointed at a fixture without
touching the real dataset. The validator additionally refuses to write a `synthetic_` input to a
non-`synthetic_` output path.

## Repository layout

| Location | Contents |
|---|---|
| `docs/` | Plan, model rationale, codebook, results, decision memo, PRD, and a personal GitHub operations guide (not a graded deliverable) |
| `data/` | Permitted raw records, the saved pilot, and the derived clean dataset |
| `analysis/` | Executable collection, validation, and analysis code |
| `.agents/skills/` | Reusable project skills |
| `records/` | Approval, verification, coding, skill-execution and extraction-audit logs |
| `reports/` | The phase reports |
| `tests/` | Automated checks |
| `product/` | Product source. Held at the Phase 1 boundary: the reference distribution, the app, and a standalone build |
| `media/` | Media assets (Phase 2). Git does not track empty directories, so this appears once the first asset is committed |
| `.github/workflows/` | CI/CD workflows (Phase 2). Appears once the first workflow is committed |
| `evaluation/` | Event dictionary and privacy-protected pilot records (Phase 2). Appears once the first record is committed |

## Data and ethics notes

- Primary source: Steam Web API, documented public endpoints. Attribution recorded in
  `data/source-access-manifest.md`.
- No reviewer identifiers are committed to this repository.
- Synthetic fixtures, where present, are prefixed `synthetic_` and are used only to test software.
  They are never evidence for a research conclusion.
- Restricted or licensed material is excluded from the repository and covered by a manifest
  entry if an approved exception applies.
