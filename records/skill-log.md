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
| 2026-10-13 | `validate-media-data` | `python analysis/make_coding_sheet.py --score records/coding-sheet-round1.csv` | `records/coding-agreement.md`: 31 codeable rows, 26 agreeing (83.9%), Cohen's kappa 0.566, 1 row marked ambiguous | The generated report's own summary sentence had the direction of the disagreement wrong. It said the machine label was a false negative wherever the description supported the human reading, but the counts put that label *above* the human reading on 4 of the 5 disagreements and below it on 1 — the opposite emphasis. The template asserted a direction it never checked; `make_coding_sheet.py` now derives the sentence from the counts. | None made to the analysis output. I completed the 32-row coding pass myself, reading each retrieved store description with the outcome column withheld, and marked one title (`ANIWARS`) ambiguous rather than forcing a 0/1. The five disagreements are left reported rather than reconciled, which is what the check is for. |
| 2026-11-06 | `build-media-mvp` | `python analysis/analyze_market.py` → `game/` 实现 | `game/logic.js`（规则，不碰 DOM/引擎）、`game/config.js`（全部数值）、`game/hub.js`、`game/profile.js`、`game/app.js`（Phaser 表现层） | 两个真实缺陷。**(1)** 击退用 `e.vx *= 0.86` 按帧衰减，却配 `dt` 使用，60fps 下不到 5 帧归零，实际位移只有几像素——击退等于没做，玩家无法拉开距离只能被贴身磨死。改成 `Math.exp(-10*dt)` 按时间衰减后，最高难度胜率从 0% 升到 75%，**一行代码，肉眼完全看不出**。**(2)** 敌人精灵池按数组索引复用，而死亡淡出把同一池对象的 alpha 压到约 0.03；尸体移除后存活敌人顶入该槽位并继承透明——只剩血条、看不见怪。**这是看截图才发现的**：我在截图里见过它并误判为「杂散色块」。 | |
| 2026-11-07 | `build-media-mvp` | `node tests/balance_report.js` | `tests/bot.js`（可复现的代理）、`tests/balance_report.js`（难度曲线） | **向用户报告的胜率是错的。** 我声称零强化 100/95/40/5，用测试里自己的 bot 复测是 100/93/68/8——密林的 40% 难度根本不存在，四档退化成「除了熔炉都不难」。根因：bot 只活在测试文件里，而测试只量了草丛和熔炉两档、n=12，所以那组数字**仓库里无法复现**。现已抽出 `tests/bot.js`，并把测试改为逐档测量 + 断言阶梯单调。 | |

| 2026-11-10 | `test-and-release` | `gh` + `node tests/*.js` | CI 5 个 job 全绿、GitHub Pages 部署、`v0.2-mvp` 与 `v0.2-submission` 两个发布、阻断演示 PR #1、回滚演练记录 | **阻断演示第一次是失败的。** 注入缺陷后测试套件**仍然是绿的**——原断言是「百分位单调不减」，而返回常数正好满足它，工具的核心承诺**根本没有守卫**。改断言后又连续两次在**正确代码上变红**：整数步长失败（数据最小值以下百分位按定义恒为 0），更细步长也失败（显示只有 1 位小数，低端 0.1~0.2 量级分辨不出，产生 267 处假阳性）。第三次「每 5 个百分点采样」才同时做到：main 全绿、缺陷分支报出缺陷区间。另有部署缺陷：仓库未开 GitHub Pages，`configure-pages` 直接失败，用 API 开启后重新部署成功。 | |

## Notes on entries

- "Skill invoked" means the skill was actually executed, not merely available. Installation and
  availability are not evidence of execution.
- Record the human correction even when it is small. It is the evidence that a person inspected
  the output rather than accepting it.
- Two further defects were found during the feasibility pilot on 9 October 2026 and are recorded in
  `docs/working-plan.md` §9 rather than here, because they changed the research design rather than
  the software: the per-review helpfulness score was rejected as an outcome, and the unit of
  analysis moved from the review to the title.
