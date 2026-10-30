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
