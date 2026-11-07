# COMM7660 Individual Project — Media Analytics and Product Prototype

**Student:** Cao Yuquan — student identifier 26366290
**Repository:** <https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline>
**Phase 2 media product:** 熔野耕作 / Emberfield — a 2.5D side-scrolling roguelite with a
farming economy layer, played in the browser (`game/`)
**Intended audience:** players of short-run action games; the product is a game, not a tool
**Phase 1 analytics artefact:** Reception Baseline — a Steam reception base-rate locator,
retained at `product/` and published beside the game at `/phase1/`. This is the analysis the
game decision was made with, not the Phase 2 product.
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
| Phase 1 | `phase1-analytics` tag and GitHub Release | `3e7f65e3b9bac55bc06e5e8641b2707836528891` | `reports/COMM7660_Phase1_report.docx`, attached to the release |
| Phase 2, release 1 | `v0.2-mvp` tag and GitHub Release | _(record at tagging)_ | _(attached to the release)_ |
| Phase 2, final | `v0.2-submission` tag and GitHub Release | _(record at tagging)_ | `reports/COMM7660_Phase2_report.docx`, attached to the release |

> The Phase 2 cells are blank on purpose. A tag and a commit identifier are execution facts;
> they can only be filled in by creating them. See [release notes](docs/release-notes.md) for
> the tagging order.

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
| Report 1,000–1,200 words, excluding access block, references, tables and figures | ✅ 1,178 as counted by `check_report_compliance.py` reading the finished `.docx` (22 words of headroom) |
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

**The product is a game.** `game/` is the Phase 2 deliverable: a browser roguelite with a
farming economy, built because the Phase 1 analysis could justify a *decision* (what to build)
but could not rescue the tool itself — a percentile with no attached decision is never used.

1. **Why this product, and not the tool** — the market analysis behind the choice is in
   `analysis/market/` (486 titles across 9 genres, plus a 108-title targeted sample of the two
   relevant Steam tags). Summary: `analysis/market/market_summary.txt`. The targeted sample is
   what reversed the earlier recommendation — see the commit message on the targeted analysis.
2. **Playable build** — `game/index.html`, served over HTTP (not `file://`). Instructions are
   on the page. Controls: A/D + W/S + Space, J to attack and to interact, Shift to sprint,
   U/I/O/K/L for skills, J at the field to enter the farm scene.
3. **Rules and where they live** — `game/logic.js` is the whole simulation and knows nothing
   about rendering; `docs/` carries the release record and the rollback procedure.
4. **Automated checks** — three suites, 212 assertions, all headless:
   ```bash
   NODE="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
   "$NODE" tests/test_game_logic.js     # rules: 111
   "$NODE" tests/test_game_page.js      # page wiring under a DOM shim: 41
   "$NODE" tests/test_game_meta.js      # profiles, hub, farm geometry: 60
   "$NODE" tests/balance_report.js      # the difficulty ladder, reproducible
   ```
5. **Balance** — `tests/balance_report.js` is the only source of truth for win rates. It uses
   a scripted agent (`tests/bot.js`) that kites and uses skills; treat its numbers as a lower
   bound, not as a claim about how the game feels.
6. **Releases and rollback** — [release notes](docs/release-notes.md) and
   [blocked-defect procedure](docs/blocked-defect-demo.md). The blank cells in the release
   index are execution facts that only a real tag/run can fill.
7. **Evidence state, stated plainly** — there is **no user pilot**. Testing so far is developer
   self-play plus the automated suites. The Phase 2 report must say that in those words.
8. **Screenshots** — `docs/screenshots/` (hub, run, farm), captured from a headless Electron
   render of the actual build.

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
| `game/` | **The Phase 2 product.** The game: `logic.js` (all rules, no rendering), `config.js` (all balance numbers), `hub.js` (base-scene rules), `profile.js` (per-player saves), `app.js` (Phaser presentation), `vendor/phaser.min.js` (vendored, MIT) |
| `analysis/market/` | The market analysis the game's genre and difficulty choice rests on |
| `docs/screenshots/` | Headless renders of the current build (hub, combat, farm) |
| `tests/` | Automated checks: the three game suites, the balance report, and the Phase 1 analysis checks |
| `product/` | The **Phase 1** analytics artefact: reference distribution, locator app, standalone build. Published at `/phase1/` beside the game |
| `.github/workflows/` | CI (`ci.yml`) and Pages deployment (`deploy-pages.yml`) |
| `evaluation/` | Pilot materials: plan, recruitment message, consent, facilitator script, observation sheet. **No records** — no pilot ran |

## Data and ethics notes

- Primary source: Steam Web API, documented public endpoints. Attribution recorded in
  `data/source-access-manifest.md`.
- No reviewer identifiers are committed to this repository.
- Synthetic fixtures, where present, are prefixed `synthetic_` and are used only to test software.
  They are never evidence for a research conclusion.
- Restricted or licensed material is excluded from the repository and covered by a manifest
  entry if an approved exception applies.
