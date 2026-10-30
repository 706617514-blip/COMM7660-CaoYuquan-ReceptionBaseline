# Evaluation records

Phase 2 user-pilot materials and records.

**Hard rule:** participants, their behaviour, errors and words are real events. `AGENTS.md`
forbids an agent from generating or inferring user feedback. An agent may prepare these
materials; only the student may produce the records. A blank row is honest. A filled row
that no participant produced is a direct violation of the brief.

---

## Index

| File | Purpose | Status |
|---|---|---|
| `pilot-plan.md` | Design: participants, measures, thresholds, session shape, analysis rules | Ready |
| `recruitment-message.md` | Message to send to prospective participants | **Send this first** |
| `consent-and-information.md` | Participant-facing information and consent | Check against your institution's ethics rules before use |
| `facilitator-script.md` | What to say, task by task, and what invalidates a session | Ready |
| `observation-sheet.csv` | One row per participant, blank | Fill during sessions only |

---

## Order of operations

1. **Send recruitment messages today.** Everything else can be built while people reply.
2. Verify the deployed URL works and note it — the pilot must run against the deployed
   build, not a local file. A `file://` path is not a test of what a participant will see.
3. Book 5–8 sessions within 3 days.
4. Run sessions one at a time; write up each sheet immediately after.
5. Analyse against the fixed thresholds in `pilot-plan.md`.
6. Make the revision, and name the observation that caused each change in
   `docs/release-notes.md` under release 2.
7. Write the Phase 2 report (500–700 words).

---

## What the brief asks for, and where it lands

| Requirement | Where it is satisfied |
|---|---|
| "Report actual pilot behaviour, errors, feedback, and a meaningful tested revision" | `observation-sheet.csv` (behaviour and errors) + release notes release 2 (revision) |
| "Do not present an uncontrolled small pilot as proof of market demand" | Stated as a limit in `pilot-plan.md`; the report must keep claims at usability level |
| "Keep two evidence streams distinct" | Phase 1 analytics (does this product idea have support) vs pilot (does it work for a person) — never merged into one claim |
| "A pending collaborator invitation is not confirmed access" | Repo access is reported separately from pilot evidence |

---

## What is not here yet

Nothing in this folder contains a record. That is the current state, not an omission — the
sessions have not happened. If the Phase 2 deadline arrives in this state, the honest
report says the pilot did not run, and the decision is argued on Phase 1 evidence alone.
Inventing rows would be worse than reporting that.
