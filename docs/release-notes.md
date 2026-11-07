# Release notes and rollback procedure

Release record for Phase 2. The brief requires **two numbered releases, executed CI/CD, a
blocked-defect demonstration, and tested restoration**. Each of those needs evidence in this
repository, not a description of intent.

> **What the Phase 2 product is.** The Phase 1 deliverable was an analytics tool: a Steam
> reception base-rate locator. It answered "where does my expected review rate sit", and the
> analysis behind it is sound, but as a *product* it drove no decision — a user reads a
> percentile and then does nothing differently. The Phase 2 product is therefore a game,
> chosen with that analysis: a 2.5D side-scrolling roguelite with a farming economy layer.
> The market evidence for the choice is in `analysis/market/`; the analysis tool is retained
> and published at `/phase1/` beside the game.
>
> See `docs/blocked-defect-demo.md` for the blocked-failure procedure.

---

## Release index

| Release | Tag | Date | Commit | What changed | Deployed URL | CI run |
|---|---|---|---|---|---|---|
| Phase 1 (frozen) | `phase1-analytics` | 2026-10-19 | `3e7f65e` | Executed analysis, decision memo, PRD, first product build (the locator) | _(not deployed at Phase 1)_ | _(Phase 1 predates CI)_ |
| Phase 2, release 1 | `v0.2-mvp` | _record at tagging_ | _record at tagging_ | Playable core loop: run → loot → farm → upgrade | _record after first successful deploy_ | _paste the Actions run URL_ |
| Phase 2, release 2 | `v0.2-submission` | _record at tagging_ | _record at tagging_ | Revision driven by evidence collected after release 1 | _same URL_ | _paste the Actions run URL_ |

> The Phase 1 tag is **immutable**. Do not retag it, amend its commits, or move it to a later
> commit. Phase 2 work happens in commits after it.
>
> The blank cells above are deliberately blank. A tag, a CI run and a deployment URL are
> execution facts; they can only be filled in by running the commands. Writing a plausible
> value there would be fabricating evidence.

---

## Release 1 — `v0.2-mvp`

**Purpose:** the first build complete enough that a player who has never seen it can finish a
run unaided.

### Included

- **The core loop**, which is the whole game: fight a wave-based run, collect dropped loot,
  spend it on the farm and on upgrades, run again against a harder tier.
- **Movement on three axes.** A/D horizontal, W/S along a depth band (W is up-screen, i.e.
  further away), Space to jump, Shift to sprint. Sprint returns to walking on the next frame
  with no residual momentum, so attacks can be lined up precisely.
- **Five skills** with cooldowns and coin-buyable levels: U forward slash (a long lane in
  front), I blink (dashes with i-frames and damages along the path), O slam (radial, heavy
  knockback plus a 0.6 s stagger), K war cry (heal and a temporary damage buff), L ultimate.
  Each key shows a cooldown on the skill bar.
- **Three enemy behaviours**, not three skins: crawler (chases on both axes), runner
  (telegraphs, then lunges), spitter (holds distance and fires a projectile that travels a
  straight line in x and z). The spitter is what makes the depth axis a dodge rather than
  decoration: a projectile hits only when x overlaps *and* the depth difference is under 26,
  so stepping in depth avoids it.
- **Four difficulty tiers replacing level count**: 草丛 / 林地 / 密林 / 熔炉, differing in
  enemy hp, damage, speed, wave count and loot multiplier (×1.0 → ×3.5). The higher tier pays
  more, which is the risk/reward decision.
- **The farming layer**: nine plots in a separate scene, reached by pressing J at the field
  with a fade through black. A crop matures after two runs and then pays every run; runs
  count win or lose, so a bad run still advances the economy.
- **Per-player profiles**: named saves with independent storage plus an exportable, importable
  save code. No server is involved.
- **CI on every push and pull request**: exclusion rules and the dataset fingerprint, model
  reproduction, the balance-value guard, the game's rules/page/profile suites, a
  played-to-an-ending check for every difficulty, and the Phase 1 report compliance check.
- Three suites totalling 212 assertions: rules (111), page wiring under a DOM shim (41),
  profiles and hub/farm interaction (60).

### Known limitations at this release

- **Reception balance is a bot's lower bound, not a human's measured experience.** The win
  rates printed by `tests/balance_report.js` come from a scripted agent that kites and uses
  skills. Zero-upgrade it clears roughly 100 / 95 / 45 / 0 percent across the four tiers.
  That is a floor, not a claim about how the game feels.
- **Every art asset is generated at runtime** from Phaser Graphics primitives. There are no
  images to 404, but the result is deliberately plain, and the brief states that visual
  polish alone earns no marks.
- **Rendering is not covered by the Node tests.** They exercise rules and DOM wiring only.
  Visual correctness has been checked by rendering the page in a headless Electron window and
  reading screenshots in `docs/screenshots/`; that check is manual and is not in CI.
- **No user evidence yet.** Nothing about comprehensibility or enjoyability is known at this
  point. Developer self-play is not a pilot.
- **Saves are per browser profile.** Clearing site data loses progress; the export code is the
  only way to move it between machines.
- **No audio.** Deliberate, to avoid autoplay restrictions and extra assets.

### Rollback target

The frozen Phase 1 tag `phase1-analytics` remains reachable, but it does not contain a
playable game — rolling the game back means returning to an earlier Phase 2 commit (below),
not to Phase 1.

---

## Release 2 — `v0.2-submission`

**Purpose:** the build carrying the revision justified by evidence gathered after release 1.

_(To be completed. This section must name, per change, the observed behaviour or error that
motivated it and link the record that shows it. A revision described without evidence is not a
tested revision. If the evidence is developer self-play rather than a user pilot, say so in
those words — the report must not present self-testing as user testing.)_

### Included

_(to be completed)_

### What the evidence changed and why

_(to be completed — per change: observation → change → how it was verified)_

---

## Rollback procedure

Restoring an earlier working version is a graded requirement, and it must be **tested**, not
merely documented. The rehearsal exists so that a real rollback is not the first attempt.

### Why rollback is cheap here

The game is a static site: no server, no database, no server-side user state. Rolling back
means republishing an earlier commit's `game/` directory. Player saves live in the browser, so
a rollback cannot corrupt them — but note the one case that can bite: `logic.js` refuses a save
from a *newer* `STATE_VERSION` than it knows, and migrates an older one forward. So rolling back
across a `STATE_VERSION` bump means players who saved on the newer build get a fresh state. That
is a reason to bump `STATE_VERSION` only when a field genuinely changes.

### Procedure

1. **Identify the target.**
   ```bash
   git tag -l 'v0.2*'
   git log --oneline --decorate -10
   ```

2. **Revert forward; do not force-push.** A force-push over `main` erases the evidence that a
   defect occurred, which is the opposite of what the assessment asks to see.
   ```bash
   git checkout <good-tag> -- game/
   git commit -m "rollback: restore game/ to <good-tag>"
   git push origin main
   ```

3. **Confirm CI is green** on the revert commit. A failed revert is worse than the original
   defect.

4. **Confirm the deployment** by playing the core loop at the published URL: pick a profile,
   walk to the gate, clear a wave, collect loot, return to the farm, plant, run again.

5. **Record the rehearsal** below with the run link and the date.

| Rollback rehearsal | Date | From → to | Revert commit | CI run | URL verified |
|---|---|---|---|---|---|
| 1 | _to be filled at rehearsal_ | | | | |

### If the deploy workflow itself is broken

A failed deploy is not an outage: Pages keeps serving the previously published artifact. The
correct response is to fix the workflow, not to roll back the game. Note that the deploy
workflow triggers on `game/**`, so a workflow-only change still needs a manual
`workflow_dispatch` to verify.

---

## Version numbering

`v0.2.x` because Phase 1 already occupies `phase1-analytics` and the game is a second-phase
deliverable. The brief suggests `v0.2-submission` as an example name, so the final release uses
exactly that.

## Tagging order (the order matters)

Phase 1 recorded a real ambiguity: the report attached to the release must be identical to the
tagged source. Do these in order.

1. Commit everything you intend to submit. `git status` must be clean.
2. `git tag -a v0.2-mvp -m "..."` then `git push origin v0.2-mvp`.
3. Create the GitHub Release on that tag and attach the report.
4. Only then treat the tag as frozen.
