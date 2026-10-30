# Release notes and rollback procedure

Release record for Phase 2. The brief requires **two numbered releases, executed CI/CD,
a blocked-defect demonstration, and tested restoration**. Each of those needs evidence in
this repository, not a description of intent.

See `docs/blocked-defect-demo.md` for how the blocked-failure evidence is produced, and
the rollback section below for how restoration is tested.

---

## Release index

| Release | Tag | Date | Commit | What changed | Deployed URL | CI run |
|---|---|---|---|---|---|---|
| Phase 1 (frozen) | `phase1-analytics` | 2026-10-19 | `3e7f65e` | Executed analysis, decision memo, PRD, first product build | _(not deployed at Phase 1)_ | _(Phase 1 predates CI)_ |
| Phase 2, release 1 | `v0.2-mvp` | _(to be filled at release)_ | _(commit)_ | CI/CD, deployment, pilot-ready build | _(Pages URL)_ | _(run link)_ |
| Phase 2, release 2 | `v0.2-submission` | _(to be filled at release)_ | _(commit)_ | Revision driven by pilot evidence | _(Pages URL)_ | _(run link)_ |

> The Phase 1 tag is **immutable**. Do not retag it, amend its commits, or move it to a
> later commit. Phase 2 work happens in commits after it.

---

## Release 1 — `v0.2-mvp`

**Purpose:** the first build that can be put in front of a participant.

### Included

- The base-rate locator: expected rate in, percentile out, reference distribution drawn,
  comparable-title list with Steam links, non-conditioning disclosure.
- Two view controls on the discovery list only: number of titles (5 / 10 / 20) and a
  review-count floor (≥50 / ≥200 / ≥500 / ≥1000). The floor is disclosed as
  non-neutral: the interface states the filtered set's mean and its gap from the full
  reference set.
- A **data-freshness badge** on the opening screen: the collection cutoff date and the age
  of the snapshot in days, computed at render time so it ages as real time passes rather
  than asserting a fixed age. The page makes no network request at runtime, so without
  this line a user has nothing telling them the figures are a snapshot rather than live.
- Static deployment at the Pages URL above.
- CI on every push and pull request: exclusion rules, dataset fingerprint, model
  reproduction, product logic, and report compliance.

### Known limitations at this release

- The comparable list is ordered by **distance in positive rate**, not by similarity of
  the games. A developer sees titles that scored the same, not titles that resemble
  theirs. This is the main candidate for revision.
- Single reference snapshot (cutoff 2026-10-09). Reception drift is unobserved, and the
  reference distribution is therefore **not live** — the freshness badge states the cutoff
  and the age rather than leaving that to inference. Re-running
  `analysis/collect_titles.py` then `analysis/build_product_data.py` is the only way the
  figures move; deployment alone does not refresh them from Steam.
- No participant data yet. Nothing about usability is known at this point.

### Rollback target

The frozen Phase 1 tag `phase1-analytics` remains the fallback if this release proves
unusable.

---

## Release 2 — `v0.2-submission`

**Purpose:** the build carrying the revision justified by pilot evidence.

_(Fill in after the pilot. This section must state which observed behaviour or error
motivated each change, and link the pilot record that shows it. A revision described
without evidence is not a tested revision.)_

### Included

_(to be completed)_

### What the pilot changed and why

_(to be completed — per change: observed behaviour → change → how the change was checked)_

---

## Rollback procedure

Restoring an earlier working version is a graded requirement, and it must be **tested**,
not merely documented. The test is a rehearsal so that a real rollback is not the first
attempt.

### Why rollback is cheap here

The product is a static site with no server, no database and no user state. Rolling back
means republishing an earlier commit's `product/` directory. Nothing has to be migrated
and no data is lost.

### Procedure

1. **Identify the target.** Pick the release to restore:
   ```bash
   git tag -l 'v0.2*'
   git log --oneline --decorate -10
   ```

2. **Revert forward, do not force-push.** Create an ordinary commit that restores the
   earlier `product/` content:
   ```bash
   git revert --no-commit <bad-commit>..HEAD   # or checkout the tag's files:
   git checkout <good-tag> -- product/
   git commit -m "rollback: restore product/ to <good-tag>"
   git push origin main
   ```
   Force-pushing over `main` would erase the evidence that a defect occurred, which is
   the opposite of what the assessment asks to see.

3. **Confirm CI is green** on the revert commit. A failed revert is worse than the
   original defect.

4. **Confirm the deployment.** The Pages workflow redeploys on push to `main`. Open the
   published URL and verify the core journey: enter a rate, get a percentile, get the
   title list.

5. **Record the rehearsal** in the table below, with the run link and the date.

| Rollback rehearsal | Date | From → to | Revert commit | CI run | URL verified |
|---|---|---|---|---|---|
| 1 | _(to be filled)_ | | | | |

### If Pages deployment itself is broken

Deployment failure is a separate failure mode from a bad product build. If the deploy job
fails, the previously published artifact keeps serving — Pages does not take a site down
on a failed deploy. So a broken deploy is not an outage, and the correct action is to fix
the workflow rather than to roll back the product.

---

## Version numbering

`v0.2.x` because Phase 1 already occupied the `phase1-analytics` label and the product is
a second-phase deliverable. The brief suggests `v0.2-submission` as an example name, so
the final release uses exactly that.
