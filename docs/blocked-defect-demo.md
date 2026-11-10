# Blocked-defect demonstration

The brief requires evidence of a **blocked failure**: a check that actually stopped a bad
change from being released. A green CI badge does not show this. What shows it is a
deliberately broken branch whose checks go red, and a merge that is therefore refused.

**This file is a procedure, not a result.** It contains no run links or screenshots,
because producing those requires actually pushing the branch. Fabricating them would be
exactly the kind of "execution claim" the brief prohibits.

---

## Why this matters for the assessment

"Executed CI/CD" is only proven by a pipeline that can fail. A configuration that has
never rejected anything is indistinguishable from one that checks nothing. The blocked
demo is the evidence that the checks are load-bearing.

---

## The defect to introduce

Pick a defect that the existing checks genuinely catch, so the demonstration is real
rather than a workflow that just runs `exit 1`.

Good candidates, in order of how clearly they map to a user-visible problem:

| Defect | Which CI job fails | Why it is a fair test |
|---|---|---|
| Make `percentileOf` non-monotone, e.g. return a fixed value for one input | `product` → `tests/test_product_app.js` ("percentile strictly monotone") | The tool's central claim breaks; a user could see a higher expectation ranked worse |
| Remove the review floor from the comparable list, so the list ignores `minrev` | `product` → "列表里每款作品都满足所选评论数下界" | Silently ships titles that violate the stated filter |
| Let the filter change the percentile | `product` → "改评论数下界：百分位保持不变" | Breaks the promise that view controls do not change the answer |
| Append a row to `data/clean/analysis_dataset.csv` by hand | `data` → "Dataset must be byte-identical" | Editing cleaned data by hand instead of in code is the failure the raw-data rule exists to prevent |
| Widen the report past 1,200 words | `compliance` → word count | The brief's limit is enforced rather than trusted |

**Recommended:** the first one. It is a one-line change, it fails fast, and the failure
message names the user-visible consequence.

---

## Procedure

Run this from a clean `main`.

```bash
cd /Users/f1gment/Documents/7660
git switch -c defect/percentile-not-monotone main
```

**1. Introduce the defect.** In `product/index.html`, inside `percentileOf`, make the
function return a constant when the input is in a plausible range:

```javascript
// defect: pretend the percentile stops responding above the midpoint
if (v > 0.5 && v < 0.9) return 50;
```

**2. Run the checks locally first**, so you know CI will fail for the intended reason
rather than a typo:

```bash
NODE="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
"$NODE" tests/test_product_app.js
# expected: FAIL 百分位对输入严格单调 / 百分位随输入单调不减, exit code 1
```

**3. Push the branch and open a pull request.**

```bash
git add product/index.html
git commit -m "defect: percentile stops responding above the midpoint"
git push -u origin defect/percentile-not-monotone
```

Then open a pull request against `main`.

**4. Capture the blocked evidence** — three things, all from GitHub, not from a
description:

- the failing check on the PR (screenshot or the PR URL, which stays live),
- the CI run URL,
- the PR's merge state showing it cannot be merged.

**5. Record it here:**

| Field | Value |
|---|---|
| PR URL | _(paste)_ |
| Failing check name | _(paste the job/step that failed)_ |
| CI run URL | _(paste)_ |
| Merge state | _(blocked / required check failed)_ |
| Date | _(date)_ |

**6. Abandon the branch.** Do not merge it, and do not delete the PR before recording the
URL — the PR is the evidence.

```bash
git switch main
git branch -D defect/percentile-not-monotone   # after recording; the remote PR can stay closed
```

---

## What "blocked" must actually mean

GitHub will let a red PR merge unless branch protection is on. Without protection, a red
check is a warning, not a block — and calling it "blocked" would be a false claim.

So enable protection before running the demo:

1. Repository → **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. Enable **Require status checks to pass before merging**
4. Select the CI jobs (`Data rules and dataset fingerprint`, `Model reproduces and
   estimates match`, `Product data and page logic`, `Report complies with the brief`)
5. Save

Then the PR in step 3 shows a merge button that is disabled, which is the actual evidence
of a blocked defect rather than a failed run that someone could have ignored.

> **Note on team size.** If the repository has a single maintainer, branch protection with
> "require a pull request before merging" can lock you out of your own `main`. Enabling
> only the status-check requirement avoids that; you can still push directly, but a PR
> with red checks cannot be merged. That is sufficient for this demonstration.

---

## Record of the executed demonstration — 2026-11-10

This section records the actual run, not the procedure. Everything below is verifiable from
the repository and the GitHub API.

| Field | Value |
|---|---|
| Pull request | [#1](https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/pull/1) |
| Branch | `defect/percentile-not-monotone` |
| Defect commit | `51acccd` — `percentileOf()` returns a constant 50 for inputs in (0.5, 0.9) |
| Failing check | **Product data and page logic** (job [129603748389](https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/actions/runs/42747676680/job/129603748389)) |
| Other four checks | pass (Data rules, Model reproduces, Game logic, Report complies) |
| Merge state at first observation | **`BLOCKED`** |
| Merge state later | **`BEHIND`** — see the note below |
| Merge state now | **not mergeable, for two independent reasons** |
| Date | 2026-11-10 |

### Branch protection actually enabled

A red check is only a warning unless something refuses the merge. Protection was applied to
`main` before the demonstration and read back to confirm:

- required status checks: all five CI jobs, `strict: true`
- `allow_force_pushes: false`, `allow_deletions: false`
- `enforce_admins: false` — deliberately, so the single maintainer is not locked out

With that in place `gh pr view 1` reported `mergeable: MERGEABLE` but
`mergeStateStatus: BLOCKED`. The two together are the evidence: GitHub considered the branch
mergeable in principle and refused it because a required check failed.

**The status label changed within the hour, and the record has to say so.** Once `main`
advanced, `mergeStateStatus` became `BEHIND` — because `strict: true` also requires the branch
to be up to date before merging. Two facts hold simultaneously and both independently prevent
the merge:

- `Product data and page logic` is **failing** on the branch, which does not change when the
  branch is updated, because the defect is in the code;
- the branch is **behind** `main`, which would resolve by merging `main` in — and would then
  immediately return to `BLOCKED` on the same failing check.

Quoting `BLOCKED` alone as the permanent state would be inaccurate. The durable claim is
narrower and better: **this pull request cannot be merged while the required check fails, and
the check does fail.**

### The failure message names the defect, not a coincidence

```
  FAIL  数据范围内每前进 5 个百分点，百分位都有上升（抓得住恒定区间）
        -> 6 段未上升，首个在输入 60
```

The injected window is inputs 50–90, so "first at input 60" falls inside it.

### What this demonstration actually caught: the check was useless

**The first attempt at this demonstration failed.** The existing assertion was
`百分位随输入单调不减` — *monotonic non-decreasing* — and a function that returns a constant
satisfies it. Injected as written, the suite stayed green. The guard protecting the tool's
central promise did not exist.

Three rewrites were needed before the assertion could catch the defect, and all three failures
are worth recording because they are a better account of the problem than any claim that the
test "works":

1. **Strict increase at 0..100 integers** — red on correct code. The percentile interpolates to
   0–100, and below the data minimum it is legitimately 0 for every input, so inputs 0..33 are
   equal by definition.
2. **0.1 steps inside the data range** — red on correct code again. At the low end the
   percentile is only 0.1–0.2 in magnitude while the page shows one decimal, producing 267
   samples that read as identical. That was measuring display rounding, not the rule.
3. **Sample every 5 percentage points** — green on `main`, and on the defect branch reports
   the failure above.

Red-green verified rather than asserted: 70 assertions green on `main` (`dd031e9`), 2 red on
the defect branch.

### Reproducing the current state

```bash
gh pr view 1 --json mergeStateStatus,mergeable       # not mergeable
gh pr checks 1                                       # Product data and page logic = fail
gh api repos/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/branches/main/protection \
  --jq '.required_status_checks | {strict, checks: [.checks[].context]}'
```

### The branch is left in place

`defect/percentile-not-monotone` and PR #1 are **not deleted and not merged**. They are the
evidence. Deleting the branch would delete the demonstration.
