---
name: test-and-release
description: Save runnable tests, execute CI/CD, produce numbered releases with release records, demonstrate a blocked failure, and rehearse restoring a previously working version. Use when the product builds and the loop is complete, and again before every release.
version: 1.0.0
adapted_from: original
---

# test-and-release

## Purpose

Prove the product works, that the checks would stop it if it did not, and that a bad release can
be undone. This skill does not decide what "working" means — the PRD's acceptance criteria do.

## When to use

Once the core loop is complete, and again before every numbered release.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `docs/prd.md` | yes | Acceptance criteria define what the tests assert |
| the rules module | yes | Must be runnable outside the engine, or CI cannot test it |
| a deployment target | yes | A reachable URL reviewers can open |

## Outputs

- test suites that run headlessly, with the command recorded in `AGENTS.md`
- CI workflow executing those suites on every push
- a deployment workflow publishing the built artifact
- `docs/release-notes.md` — release index, blocked-failure record, rollback procedure
- `docs/blocked-defect-demo.md` — the executed demonstration, not the intention

## Procedure

1. **Test the rules first, then the wiring.** Two layers catch different faults. Rules tests
   catch wrong behaviour; a page test that executes the real entry script catches a mistyped id
   or an unbound handler, which rules tests never see.
2. **Make tests deterministic.** Any assertion that depends on a random outcome will fail
   intermittently, and an intermittent test gets ignored — which is worse than no test.
3. **Assert the properties you advertise.** If the product claims a value is strictly
   monotonic, a test that only checks "never decreases" does not guard it. A constant satisfies
   "never decreases".
4. **Prove the check can fail.** Enable required status checks on the protected branch *first*,
   then inject a real defect and open a pull request. Without branch protection a red check is a
   warning, not a block, and calling it "blocked" is false. Record the PR number, the failing
   check name, and the merge state **read back from the API** — that label changes as the base
   branch advances, so quoting one observation as permanent is inaccurate.
5. **Rehearse the rollback.** Inject a fault, restore from the tag, and verify the suites pass
   afterwards. Record what the rehearsal does *not* prove — timing, for instance, unless measured.
6. **Tag in order.** Clean tree, then tag, then push the tag, then create the Release and attach
   the report, then treat the tag as frozen. Do not move a published tag; a follow-up commit,
   documented, is better.

## Checks before declaring a release done

- every required check green on the release commit
- the deployed URL loads, with no console errors, verified rather than assumed
- the report attached to the Release is byte-identical to the submitted file
- the rollback rehearsal is recorded with a date and a result

## Failure modes this skill exists to prevent

- **A check that has never failed**, which is indistinguishable from a check that tests nothing.
- **Recording a blocked failure that was not blocked**, because branch protection was off.
- **Claiming tests pass without running them** in the message that makes the claim.
