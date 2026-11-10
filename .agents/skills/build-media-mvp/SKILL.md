---
name: build-media-mvp
description: Build the approved Phase 2 core experience from the Phase 1 decision, keeping game rules free of rendering so they stay testable, and record every implementation change against the evidence that justified it. Use after the Phase 1 decision memo and PRD are approved and the scope is frozen.
version: 1.0.0
adapted_from: original
---

# build-media-mvp

## Purpose

Turn an approved evidence-based decision into a bounded, functioning media experience. This
skill builds; it does not choose what to build. The Phase 1 decision memo and PRD decide that.

## When to use

After the Phase 1 decision is approved and the scope is frozen. Not before: building on an
unapproved scope wastes the prototype and breaks the evidence chain the brief grades.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `docs/decision-memo.md` | yes | The approved decision and its rejected alternative |
| `docs/prd.md` | yes | Must-haves, acceptance criteria, declared non-goals |
| `analysis/market/*` | yes | The market evidence the product choice rests on |
| `game/config.js` or equivalent | yes | Single place for balance/behaviour numbers |

## Outputs

- the product source, runnable from a static deployment with no server
- `docs/evidence-to-feature.md` — each shipped feature traced to the evidence that justified it
- an appended row in `records/skill-log.md`

## Procedure

1. **Restate the decision before writing code.** Name the users, the rejected alternative, and
   the one sentence from the Phase 1 analysis that supports the choice. If that sentence does
   not exist, stop: the product is not justified yet.
2. **Separate rules from presentation.** Put the simulation in a module that imports no DOM, no
   engine and no storage. The renderer reads that state and never writes it. This is what makes
   the product testable at all: an engine cannot run in CI, but the rules can.
3. **Put every number in one config file.** Balance values scattered through logic cannot be
   tuned, reviewed or diffed.
4. **Implement one core loop, not a small version of a large game.** A bounded prototype needs a
   complete loop that a stranger can finish, not a fragment of a bigger design.
5. **Record each feature against its justification.** If a feature has no evidence behind it,
   either drop it or record it as an assumption with the condition that would falsify it.
6. **Keep the Phase 1 evidence frozen.** Do not retag or amend it.

## Checks before declaring the build complete

- the rules module imports nothing from the engine or the DOM
- every balance value lives in the config file
- the product opens from a clean checkout with no network
- the Phase 1 tag and dataset hash are untouched

## Failure modes this skill exists to prevent

- **Building before the decision is approved**, which produces a prototype with no evidence
  chain and nothing to revise on.
- **Rules entangled with rendering**, which makes the product untestable and turns every
  balance change into a code change.
- **Scope creep disguised as polish.** The brief is explicit that complexity, tool count,
  dataset size and visual polish alone earn no marks.
