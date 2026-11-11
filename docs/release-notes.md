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
| Phase 2, release 1 | `v0.2-mvp` | 2026-11-10 | `55e0447` | Playable core loop: run → loot → farm → upgrade | https://706617514-blip.github.io/COMM7660-CaoYuquan-ReceptionBaseline/ | [run 42746488696](https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/actions/runs/42746488696) |
| Phase 2, release 2 | `v0.2-equipment` | 2026-11-11 | `4f6e916` | Equipment system (35 items, 5 slots), the farm freeze fix, plus earlier untagged work now included | https://706617514-blip.github.io/COMM7660-CaoYuquan-ReceptionBaseline/ | [run 43045532080](https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/actions/runs/43045532080) |
| Phase 2, release 2 (earlier tag, now out of date) | `v0.2-submission` | 2026-11-10 | `727e39b` | Revision driven by evidence collected after release 1. **Does not include the equipment system** — see the note under Release 2 | _same URL_ | [run 42792958880](https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/actions/runs/42792958880) |
| Phase 2, current batch (unreleased) | _(no tag)_ | 2026-11-12 | `8c63b84` | Backpack panel (35 cells per page, six pages, paid expansion), batch sell, runtime-generated audio with a volume/music settings page, ESC menu, attack reach +5% | _(未部署 — 仅本地分支 `feat/backpack-audio-settings`)_ | _(未运行 — 分支未 push，Actions 里没有对应运行)_ |

> The Phase 1 tag is **immutable**. Do not retag it, amend its commits, or move it to a later
> commit. Phase 2 work happens in commits after it.
>
> The cells above were filled in from the repository and the Actions log rather than from
> memory. A tag, a CI run and a deployment URL are execution facts; each one was read back
> from the system that produced it before being written down here.
>
> The last row is the working branch at the time of writing, not a release. It has no tag, it
> was never pushed, so it has no CI run and no deployment URL — the two cells say so rather
> than carrying a plausible-looking number. Its local evidence (seven suites, 1,348
> assertions, six screenshots, one old-save import) is recorded in
> `docs/browser-test-evidence.md`.

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

## Release 2 — `v0.2-equipment`

**Purpose:** the build that adds the equipment system, and that fixes one fault which made a
core part of the game unplayable.

> **Note on the tag name.** An earlier plan was to call this release `v0.2-submission`. That
> name now belongs to an earlier commit (`727e39b`, 2026-11-10 11:14), which no longer
> contains everything that is deployed. Reusing the name would have made two different builds
> share one release name, so this release is tagged separately. The older tag is left in place
> and is not moved.

### Included

- **An equipment system with 35 items across five slots** — head, torso, back, weapon and feet.
  Each slot holds one item at a time, and every position has basic items available, so a player
  is never left with an empty slot that nothing can fill.
- **Levelling.** Basic items go to level 3 and special items to level 5. Levelling makes an
  item stronger; it never turns it into a different item. The mechanic stays the same, and only
  the numbers change.
- **Fourteen special effects**, such as damage reflection, chain lightning, a shield that
  triggers at low health, and a burning patch left on the ground. Two special weapons grant a
  skill instead of a stat, so the weapon slot can change what the player is able to do.
- **Drops.** Ordinary enemies drop an item 5% of the time. A duplicate is not thrown away; it
  is refunded at 30% of the price. Bosses are deliberately excluded, because a boss that can be
  farmed would make repeating one fight the best way to play.
- **A new hub building, the weapon rack (兵器架)**, which opens a panel listing all 35 items
  with their price, level and description. Buying, equipping and upgrading all happen in this
  one panel.
- **The player character is now drawn in layers.** Each equipped item is a separate layer on
  top of the body, so putting on a helmet visibly changes the character. The left-facing view
  mirrors every layer together, which avoids the fault where the character faces one way and
  the weapon faces the other.
- **Potion system** (回春, 力量, 坚壁 on keys 1, 2 and 3) with a potion shop in the hub.
- **A weapon skill on the V key**, which only appears in the skill bar when a weapon that
  grants it is equipped.
- **Visible ground zones.** Burning and frost patches are now drawn on the ground, so the
  player can see why they are losing health or moving slowly.
- **A drop notification.** Because a 5% drop is easy to miss, picking one up now shows a
  message, and a duplicate drop states the refund amount.

### What the evidence changed and why

Each change below names what was observed, what was changed, and how the change was checked.
**The evidence is developer self-testing, not a user pilot.** No participants have played this
build, so nothing here is a claim about how another person experiences the game.

1. **Equipping an item while the shop panel was open had no visible effect.**
   *Observed:* in the weapon rack panel, buying and equipping a helmet left the character
   unchanged. The change only appeared after the panel was closed.
   *Cause:* the hub's update loop begins by returning early while a panel is open, and the code
   that updates the character's equipment layers was inside that loop. Since all buying and
   equipping happens while the panel is open, that code never ran at the moment it mattered.
   *Change:* the character is now refreshed immediately after a panel action succeeds.
   *Checked:* a browser test drives the real panel — opens the weapon rack, clicks the buy
   button, clicks the equip button — and asserts that the helmet layer is showing while the
   panel is still open. Removing the one-line fix makes exactly this test fail.

2. **Pressing J at the field made the game freeze on a black screen.**
   *Observed:* reported during use — "pressing J to enter the field, it fades to black and then
   seizes up; nothing works".
   *Cause:* the farm scene's update loop read a property that was never set anywhere in the
   codebase, so it threw an error on its first frame. Because that same loop also handles the
   ESC key, the scene could not be left either. This fault was not introduced by the equipment
   work; it dates from an earlier commit and had simply never been triggered, because no test
   had ever walked to the field and pressed J.
   *Change:* the unusable line was deleted. The keyboard is still handled by the input layer
   that already worked.
   *Checked:* a browser test walks to the field, presses J, waits for the fade to finish, and
   then asserts that the farm is running, that no error was thrown, and that ESC returns to the
   base. Putting the line back makes those assertions fail again.

3. **Burning and frost zones affected the player but were invisible.**
   *Observed:* the damage and slowdown were calculated correctly, but nothing was drawn on the
   ground, so health loss had no visible cause.
   *Change:* both zones are drawn as flat ellipses on the ground, using the same projection as
   the character. The frost zone also shows ice cracks, so the two zones differ by shape and
   not only by colour.
   *Checked:* a screenshot taken from a running game shows one frost zone and two burning
   zones, and the drawn radius shrinks as the zone's remaining time runs out.

4. **The weapon skill, the potion keys and the drops existed in the rules but were not
   connected to the screen.**
   *Observed:* the rules layer could grant a skill and record a drop, but no key called the
   skill and nothing displayed the drop.
   *Change:* the V key now casts the weapon skill, the skill bar shows a slot for it only when
   a suitable weapon is equipped, and a drop shows a message.
   *Checked:* a browser test confirms the bar has five slots without such a weapon and six with
   one, and that pressing V starts the cooldown and the effect.

### Known limitations at this release

- **Balance figures still come from a scripted agent, not from people.** With no upgrades the
  four tiers are cleared about 100 / 94 / 54 / 1 percent of the time; with everything bought
  they reach about 100 / 96 / 97 / 73 percent. These are lower bounds. They say the difficulty
  ladder is still intact, not that the game is enjoyable.
- **Reception is still unmeasured.** No pilot session has taken place at the time of writing.
- **Visual checks are manual.** The Node tests cover rules and page wiring. The layered
  character, the ground zones and the farm screen have been checked by reading screenshots,
  which is not part of CI.
- **The older `v0.2-submission` tag is out of date.** It points at a commit that does not
  include the equipment system. Anyone comparing that tag with the deployed site will see a
  difference, and this note is the record of that difference.

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
| 1 | 2026-11-10 | `main` with an injected fault → `v0.2-mvp`'s `game/config.js` | `f7dd104` (fault injected in `0d55bfc`) | not retrievable via the API — see note below | mechanism verified locally, not re-deployed |

> **Why the CI-run cell is not a link.** Both rehearsal commits are on `main` and both were
> pushed, and the fault and the restore are in the history (`0d55bfc`, `f7dd104`). The Actions
> runs for those two commits could not be retrieved through the API when this table was filled
> in, and a plausible-looking run URL would be an invented one. The row therefore records what
> was actually checked and marks the rest as unverified, rather than presenting a guess as
> evidence.
>
> The rehearsal tested the **mechanism**: restore one file from the tag, confirm the assertions
> pass again. It did not re-trigger a deployment, so it does not show how long a real restore of
> the live site would take. That timing is unmeasured and is not claimed here.

### If the deploy workflow itself is broken

A failed deploy is not an outage: Pages keeps serving the previously published artifact. The
correct response is to fix the workflow, not to roll back the game. Note that the deploy
workflow triggers on `game/**`, so a workflow-only change still needs a manual
`workflow_dispatch` to verify.

---

## Version numbering

`v0.2.x` because Phase 1 already occupies `phase1-analytics` and the game is a second-phase
deliverable. The brief gives `v0.2-submission` as an example name, and that name was used for the
release tagged on 2026-11-10.

It was then used up. Work continued after that tag — boss artwork and behaviour, potions, the
swaying grass, a crop fix, and finally the equipment system — so the build that is deployed now
is no longer the build that `v0.2-submission` names. Rather than move an existing tag or give two
different builds the same name, the equipment release is tagged `v0.2-equipment`. The
`v0.2-submission` tag stays where it is and remains an honest record of what was submitted on
that date.

If the assessed submission must be a single tag, tag the final commit at the deadline with a
name of your choosing and record it here. Do not reuse a name that already points somewhere
else.

## Tagging order (the order matters)

Phase 1 recorded a real ambiguity: the report attached to the release must be identical to the
tagged source. Do these in order.

1. Commit everything you intend to submit. `git status` must be clean.
2. `git tag -a v0.2-mvp -m "..."` then `git push origin v0.2-mvp`.
3. Create the GitHub Release on that tag and attach the report.
4. Only then treat the tag as frozen.

---

## Rollback rehearsal — executed 2026-11-10

The procedure above was run against the real repository rather than described. The fault was
simulated, because a real production fault cannot be scheduled; the mechanics of the rollback
are the real ones.

| Step | Action | Result |
|---|---|---|
| 1 | Confirm the rollback target | `v0.2-mvp` exists, points at `55e0447` |
| 2 | Inject a fault | `SPRINT_MULT` 1.62 → 0.30 in `game/config.js` (commit `0d55bfc`) |
| 3 | Confirm the fault is visible | `SPRINT_MULT` reads 0.30, so sprinting is slower than walking |
| 4 | Roll back by restoring the file | `git checkout v0.2-mvp -- game/config.js` (commit `f7dd104`) |
| 5 | Confirm recovery | all 302 assertions pass: 131 + 60 + 41 + 70 |
| 6 | Confirm code matches the release | `git diff v0.2-mvp HEAD` shows only the demo record and the improved test |

### Why this rollback rather than a tag revert

The release is a **static site**, so "rolling back" means "make the deployed content match the
previous release". Two mechanisms were available and the simpler one was chosen:

- **`git revert` of the bad commit, then a normal push** — the preferred route. It keeps history
  linear and lets the required checks run on the result. It is what was rehearsed.
- **`git reset --hard` and force-push** — rejected. Branch protection has
  `allow_force_pushes: false`, so it would fail anyway, and it would also rewrite history on a
  branch that has already been deployed.

The rehearsal did not need a force-push because the fault was a single-file change, so
restoring that file from the tag is a normal forward commit.

### What the rehearsal does not prove

The rehearsal shows the **mechanism** works. It does not show that the deployed Pages site
would be restored within a known time, because the deployment was not re-triggered during the
rehearsal — the GitHub Pages workflow takes about a minute to publish. Timing that is not
measured should not be claimed as a number.
