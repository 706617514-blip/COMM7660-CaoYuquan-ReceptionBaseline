# Approval log

Each approval in this file must be written by the student. An agent must not author, draft, or
imply an approval entry. This file records the four checkpoints the assignment requires.

---

## Approval 1 — Source and pilot

**Date:** _(to be completed)_

**What was approved:** source = ______________ ; pilot size = ______ records

**What I personally inspected:**

- [ ] Opened the saved pilot file and verified the fields are present and plausible
- [ ] Confirmed the access conditions (basis: ______________)
- [ ] Defects found: ______________________________________________
- [ ] Human corrections made: ______________________________________

**Student signature:** ______________

---

## Approval 2 — Final model, before freeze

**Date:** _(to be completed)_

**What was approved:** outcome = ______________ ; focal predictors = ______________ ;
estimator = ______________

**Why I approved this specification** (written by me, at least three sentences):

> ______________________________________________
> ______________________________________________
> ______________________________________________

**Circularity risks I confirmed are excluded:**

- [ ] No provider input variable is used to explain that provider's own output
- [ ] No aggregate of the same outcome family appears among the predictors
- [ ] Predictors are measured at a time that precedes the outcome

**Student signature:** ______________

---

## Approval 3 — Before implementation

**Date:** _(to be completed)_

**What was approved:** MVP scope = ______________

**Must-have capabilities (maximum three):**

1. ______________
2. ______________
3. ______________

**Explicitly excluded:** ______________________________________________

**Student signature:** ______________

---

## Approval 4 — Before each release

Copy this block once per release.

**Release number:** v______ **Date:** ______________

- [ ] I personally ran the core user journey on the candidate build
- [ ] I inspected the test results (run link: ______________)
- [ ] The deployed version matches the release under assessment
- [ ] I confirmed no credentials or personal data entered the repository
- [ ] The rollback procedure was tested (evidence: ______________)

**Student signature:** ______________
