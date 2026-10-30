# Pilot plan

Phase 2 requires "genuine user evidence" and "a meaningful tested revision". This file
specifies what to run, what to record, and what result would count — **before** any
session happens, so the measures cannot be chosen after seeing the data.

> **Nothing in this folder may be written by an AI agent.** Participants, their behaviour,
> their words and their errors are real events. `AGENTS.md` prohibits an agent from
> generating or inferring user feedback. An agent may prepare the materials in this
> folder; only the student may produce the records.

---

## What this pilot tests, and what it does not

**Tests:** whether a developer can complete the tool's core task, understand what the
answer means, and actually use the discovery list.

**Does not test:** whether the product is wanted in the market. Five to eight participants
in a convenience sample cannot establish demand, and the brief explicitly warns against
presenting a small uncontrolled pilot as proof of it. Any claim in the Phase 2 report must
stay at the level of *usability under observed conditions*.

---

## Participants

| Item | Specification |
|---|---|
| Number | 5–8. Fewer than 5 cannot separate a one-off confusion from a systematic one; more than 8 exceeds what the remaining time allows while still leaving room to act on the findings. |
| Who | People who plausibly match the intended user: game developers, students who ship projects, people who have launched or are preparing to launch something on Steam. Some familiarity with Steam store pages is required — otherwise the task measures Steam literacy rather than the tool. |
| Who is excluded | Anyone who has already seen the product, given feedback on it, or discussed this project with you. Prior exposure invalidates the first-impression evidence. |
| Recording of identity | Do not record names. Assign P1, P2, … in the observation sheet. Identity is not needed and adds a data-protection obligation for no analytical gain. |

---

## Measures and thresholds

Fixed in advance; taken from `docs/prd.md`.

| Measure | Definition | Threshold | How it is observed |
|---|---|---|---|
| **Primary:** completion | Sessions reaching a displayed percentile ÷ sessions begun | ≥ 70% | Facilitator records whether a percentile appeared |
| **Secondary:** comprehension | Participants correctly stating that the answer does **not** depend on genre or business model | ≥ 60% | Asked as a task question, not a preference rating. See script step 6. |
| **Secondary:** discovery use | Participants opening at least one Steam store link during the session | ≥ 50% | Observed via screen share or browser history, not self-report |
| **Guardrail:** error | Sessions producing an error, an unsupported-input response, or an out-of-range value | ≤ 5% | Facilitator records every error text shown |

Report **counts alongside percentages** (e.g. "5 of 7", not just "71%"). With n this small
a percentage alone implies a precision that does not exist.

---

## Session shape

About 15 minutes per participant, one at a time.

| Step | What happens | Duration |
|---|---|---|
| 1 | Read the information sheet; participant confirms consent | 2 min |
| 2 | Participant opens the URL themselves (do not open it for them) | 1 min |
| 3 | Think-aloud task: state what you expect from your own project, get a percentile | 4 min |
| 4 | Open at least one listed title; say what you learn from it | 3 min |
| 5 | Change the display count and the review floor; say what happened | 2 min |
| 6 | Comprehension question (see script) | 1 min |
| 7 | Two open questions: what would you have done without this, what is missing | 2 min |

**Facilitator stance:** do not explain the interface, do not correct mistakes, do not
answer questions about what a control does. If the participant asks, reply "what do you
expect it to do?" and note the question. The questions people ask are data.

---

## What to record per participant

Use `observation-sheet.csv`. One row per participant. Record what happened, not what you
think it means — interpretation belongs in the analysis, not the observation.

Fields marked **required** must have a value for every participant, including "not
reached" where a step was never attempted. A blank that means "did not get there" is
indistinguishable from a blank that means "forgot to write it down".

---

## Analysis and the revision decision

1. **Count the four measures.** Compare against the thresholds above. Report as n of N.
2. **Group the errors and the questions asked.** A confusion that appears in 1 of 7
   sessions is a participant problem; the same confusion in 5 of 7 is a design problem.
   State which you judged each to be, and why.
3. **Decide the revision from the observed pattern, not from the loudest quote.** The
   revision must be traceable to a specific observation, and the Phase 2 report must name
   that observation.
4. **Record what you decided *not* to change.** A pilot that produces five changes
   usually produces five shallow ones. Say which findings you consciously left alone and
   what would have justified acting on them.

### What would count as failure

If completion is below 70%, or comprehension below 60%, the honest response is not to
tweak the copy until the number passes — it is to report that the product's central
assumption was not met by the evidence, and either narrow the claim further or state that
the Phase 2 decision is to stop or pivot. `docs/decision-memo.md` already lists what would
change the decision; use that list rather than inventing a new standard after the fact.

---

## Freeze

Once the first session has run, the measures, thresholds and task script in this file are
**frozen**. Changing them afterwards makes the thresholds unfalsifiable. If a change is
genuinely necessary, record it as an amendment below with the date and reason, and report
both the original and the amended threshold.

### Amendment log

| Date | Change | Reason |
|---|---|---|
| | _(none yet)_ | |
