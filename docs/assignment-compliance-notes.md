# Assignment compliance notes

Working notes on the assignment terms that constrain this project. Not a submission document.

## Terms that shaped the design

| Term | Where it applies | How this project responds |
|---|---|---|
| Prefer permitted downloads and documented APIs to webpage scraping | Source selection | Primary source is a documented public endpoint requiring no credential |
| Do not assume permission to scrape every recommended website | Source selection | Excluded sources and their reasons are recorded in the access manifest |
| An absent chart entry is not zero viewing | Sampling | Sample is stratified by genre, not drawn from trending lists |
| Repeated weekly records are not independent titles | Unit of analysis | Unit is the title; one row per distinct game, no repeated observations |
| Do not infer demographics from genre labels or review language | Audience claims | Audience fit is stated as an untested assumption |
| Include at least one genre variable and one plot, narrative, or gameplay feature | Feature coding | Genre enters as the sampling tag; `multiplayer_emphasis` is the gameplay feature, derived in code from the provider's category list and carried by Model 2 |
| AI coding must use actual source descriptions, not model memory | Feature coding | Two safeguards: the gameplay feature is derived mechanically from the retrieved record, and the human validity pass reads only the retrieved description |
| Hide outcome values during feature coding where feasible | Feature coding | The sheet omits every outcome column. It also omits `categories`, because the derived label is computed from that field and showing it would make the human pass a copy of the machine label rather than a check on it |
| Independently double-code a random 20 per cent, minimum 20 | Coding agreement | A deterministic 20% subsample coded by the student from the description alone; agreement reported in `records/coding-agreement.md` |
| Report the comparison as human–AI or human–human | Coding agreement | Recorded as human–AI agreement |
| Independently verify one descriptive quantity and one model estimate | Verification | Must use a separate calculation. A second AI pass does not satisfy this. |
| Another AI assurance is not verification | Verification | `records/independent-verification.md` is a hand-calculation worksheet completed by the student. It has no script on purpose: re-running the analysis cannot verify the analysis, because a bug in it is reproduced in its own output. |
| Use only the instructor-designated hosted platform | Media generation | Phase 2 only; recorded if used |
| Record tasks, completion, errors, and feedback | User pilot | Behavioural records, not opinion alone |
| Fabricated records, sources, user feedback, or execution claims are unacceptable | Whole project | No agent may generate pilot or execution evidence |
| Installation is not evidence of execution | Tooling | Skill log records invoked skills, not installed ones |
| Complexity, tool count, dataset size, and visual polish earn no marks | Tooling | One agent, one documented source, a defensible model |
| Do not rewrite the Phase 1 evidence | Versioning | Phase 1 tag is frozen; later changes are recorded separately |

## Known measurement caveats to state in the report

1. The outcome is a proportion over reviewers. Reviewers are a self-selected subset of players, so
   the rate describes the reviewing population, not all players.
2. Review counts accumulate over time and titles differ in exposure, so review volume is a
   control and not a substantive predictor of the rate's direction.
3. The positive rate is computed within each language community's own voting pool, which makes a
   direct cross-language comparison of the rate questionable. This is a reason Concept B is
   rejected.
4. Titles under early access, or released very recently, may differ systematically. Release
   timing is available as a control and as a sensitivity dimension.
5. A title absent from the frame is unobserved, not a zero.

## Pilot outcome and the design change it forced

Run 9 October 2026, before the specification was frozen.

**Candidate outcome 1 — per-review helpfulness score (`weighted_vote_score`). Rejected.**

| Check | Result | Verdict |
|---|---|---|
| Usable variance | sd 0.072 across 900 reviews; range 0.68–0.99 | Fails |
| Within-title variance | sd 0.038, range 0.86–0.99 on one title | Fails |
| Independence from upvotes | corr with log(votes_up) = 0.896 | Circular |
| Alignment with required unit | Per-review, but the brief specifies title-level | Misaligned |

The score is close to a monotone transform of the raw upvote count, so modelling it would have
largely reconstructed an existing platform quantity rather than estimating a relationship.

**Candidate outcome 2 — title-level positive review rate. Accepted.**

| Check | Result | Verdict |
|---|---|---|
| Usable variance | sd 0.098 across 40 titles; range 0.605–0.987 | Passes |
| Interpretability | Direct share of reviewers recommending | Passes |
| Alignment with required unit | One row per title | Aligned |
| Circularity | Not an input to any predictor | Clean |

Group separation is visible in the pilot: premium single-player titles cluster high, while
free-to-play and live-service titles occupy the lower range.

**Actions taken.** The unit of analysis moved from review to title; the outcome was replaced; the
collection skill was rewritten to aggregate per title; and this record was created. The change
precedes hypothesis testing, so it is a feasibility correction rather than an outcome-informed
revision.

## What the pilot must establish before the model is frozen

- The outcome has usable variance in the retrieved sample. **Established.**
- Genre coverage supports at least a descriptive contrast. **Established, subject to the full run.**
- The declared missing-data rules do not remove a large share of records. **Pending.**
- The retrieved-versus-available ratio is defensible. **Pending.**
- Feature coding can be completed from retrieved descriptions without the outcome visible. **Pending.**
