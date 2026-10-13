# Skill execution log

Required format: skill invoked | command run | output produced | defect found | human correction.

An empty correction column is a signal that no human review occurred. Recording a real defect is
more consistent with the assessment criteria than recording none.

> **Status of this table.** Everything except the final column was recorded by the agent that ran
> the step, and every defect listed was actually observed rather than constructed for the log. The
> **Human correction** column is deliberately blank: it records a person's inspection, and an agent
> filling it in would be fabricating the very evidence this log exists to provide. The student
> completes it after inspecting each output, per `AGENTS.md`.

| Date | Skill | Command run | Output produced | Defect found | Human correction |
|---|---|---|---|---|---|
| 2026-10-09 | `collect-media-data` | `python analysis/collect_titles.py` | `data/raw/steam_titles_<stamp>.csv`, `data/raw/collection_audit_<stamp>.json` | Two full runs died after 2 h 20 min and after minutes, having written nothing: the collector buffered results in memory and wrote only at the end, and a detached `nohup` process did not survive. Fixed by checkpointing after every accepted title, adding resume, and supervising the run as a managed job. | |
| 2026-10-12 | `collect-media-data` | `python analysis/collect_titles.py` (screening redesign) | Same artifacts, with the depth/date map recorded per tag in the audit | The original sampler called `appdetails` once per candidate to learn its release date — about 50 requests to screen 50 candidates, most discarded. The search response already carries the release date per row, so one request screens the whole page. Rewriting the screen cut the run from an unfinished 2.5 h to about 30 min. | |
| 2026-10-12 | `validate-media-data` | `python analysis/test_validate_rules.py` | `PASS: 7 rule attributions verified, 1 row survived` | Rule R4 was unreachable as first written: the only fixture injected for it also had `total_reviews = 0`, so R3 excluded it first and R4 never fired. R4 was rewritten as a count-consistency check and the fixture now proves it fires. | |
| 2026-10-12 | `validate-media-data` | `python analysis/validate_data.py --input synthetic_steam_titles_EDGETEST.csv ...` | `data/clean/analysis_dataset.csv`, `records/extraction-audit.md` | A synthetic fixture was initially written under the plain name `steam_titles_EDGETEST.csv`, which the validator's `steam_titles_*.csv` glob would have picked up as real data. Quarantined out of the repository and a guard added: a `synthetic_` input may only be written to a `synthetic_` output. | |
| 2026-10-12 | `analyze-and-report` | `python analysis/analyze_and_report.py` | `analysis/results/model_summary.txt`, `coefficients.csv`, `marginal_effects.csv`, three figures | Two real defects. (1) `desc.index = ["paid", "free-to-play"]` assumed both groups were present; with a single-group sample it raised a length mismatch. Now reindexed with the missing group handled. (2) `table1_descriptives.csv` was written with an unnamed index column, so the report rendered blank group labels. The index is now named and the report reads it defensively. | |
| | `build-media-mvp` | | | | |
| | `test-and-release` | | | | |

## Notes on entries

- "Skill invoked" means the skill was actually executed, not merely available. Installation and
  availability are not evidence of execution.
- Record the human correction even when it is small. It is the evidence that a person inspected
  the output rather than accepting it.
- Two further defects were found during the feasibility pilot on 9 October 2026 and are recorded in
  `docs/working-plan.md` §9 rather than here, because they changed the research design rather than
  the software: the per-review helpfulness score was rejected as an outcome, and the unit of
  analysis moved from the review to the title.
