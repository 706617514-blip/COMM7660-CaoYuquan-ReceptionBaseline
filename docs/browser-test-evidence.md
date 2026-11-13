# Real-browser test evidence

The brief asks, for a canvas-based product:

> "For a canvas-based game, check game state and interactions; **a screenshot alone is
> insufficient**."

and recommends Playwright covering "opening → main action → completion → restart, plus invalid
input and event recording".

## What exists, and why it is not in CI

| Layer | File | Runs where | What it can see |
|---|---|---|---|
| Rules | `tests/test_game_logic.js` | Node, and CI | The simulation only: combat, economy, saves |
| Page wiring | `tests/test_game_page.js` | Node + DOM shim, and CI | Element ids, handlers, panels — **no Phaser, no canvas** |
| **Real browser** | `tests/browser/smoke.js` | **Electron (Chromium), locally** | The actual page: real canvas, real scene updates, real key events |

The middle layer is genuinely useful — it caught a mistyped id and an unbound handler — but it
**cannot show that the game runs**, because in a DOM shim `document.querySelector('canvas')` is
null and no scene `update()` ever executes. Claiming the product works on the strength of that
layer would be overstating what it tests.

## Why this is not a CI job

Playwright's browser download is not available in this environment, and pulling a ~150 MB
browser into CI to test a static page whose rules are already covered by the Node suites
(1,671 assertions as of 2026-11-12) is a poor trade. The honest position is to record the browser evidence here, run it locally before a
release, and say plainly that CI does not cover it — rather than adding a `continue-on-error`
green tick that proves nothing.

## Result of the first run (2026-11-09; kept as the historical record)

```
--- 1. 打开（opening）---
  PASS  Phaser 已加载
  PASS  游戏模块已加载
  PASS  存在真实 canvas 元素
  PASS  canvas 宽度为 960
  PASS  canvas 高度为 600
--- 2. 主操作（main action）---
  PASS  按住 D 后玩家在真浏览器中真的移动了
--- 3. 完成（completion）---
  PASS  对局已启动（state.run 存在）
  PASS  场景已切换到 Run
--- 4. 重开（restart）---
  PASS  存在「再来一局」入口
--- 5. 控制台错误 ---
  PASS  页面无控制台错误
```

15 assertions on that day, all passing, against `http://127.0.0.1:PORT/game/` served from the
working tree. That block records the shape of the first version of the suite, not the current
count — the same file now reports 322 assertions (see the 2026-11-12 section below).

## A defect this layer found immediately

The first version of `tests/browser/smoke.js` reported **11 failures out of 12** — no Phaser, no
canvas, no state. The game was fine. The test's own static server mapped `/game/` (trailing
slash) to a directory, called `createReadStream` on it, and crashed the server process with
`EISDIR`. The browser therefore received a connection error and reported an empty page.

That is exactly the class of fault the Node layer cannot see: a DOM shim never fetches anything.

## Reproducing

```bash
node tests/browser/smoke.js        # exits 0 when all assertions pass
```

Requires a Chromium binary. On this machine the harness ships one at
`~/Library/Application Support/dsh-desktop/harness/electron/Electron.app`.

---

## 2026-11-12 — backpack, audio and settings batch

Branch `feat/backpack-audio-settings`, now at PR #2. The suite counts below were taken on the
branch before it was pushed, so CI did not produce them; the five required workflow checks ran
later on the pushed branch (run 43221742860, all pass) and re-run these suites themselves.

### Suites, run one at a time

Each command was run on its own. `&&` chaining was avoided on purpose — with `a && b` the exit
code of `a` is invisible whenever `b` runs, which is how a failing suite hides behind a passing
one. `tests/browser/smoke.js` binds `127.0.0.1:8123` exclusively, so it ran alone (the port was
checked with `lsof` before and after).

| Suite | Exit | Assertions | Note |
|---|---|---|---|
| `tests/check_textures.js` | 0 | _(prints counts, not assertions)_ | 62 textures generated, all 35 equipment sprites present, "全部纹理都已生成 ✓" |
| `tests/test_audio.js` | 0 | 225 | |
| `tests/test_bag.js` | 0 | 184 | |
| `tests/test_game_logic.js` | 0 | 650 | |
| `tests/test_game_meta.js` | 0 | 313 | |
| `tests/test_game_page.js` | 0 | 195 | |
| `tests/test_bosspose.js` | 0 | 96 | Boss 姿态纯函数（Task 25 新增，不启浏览器） |
| `tests/browser/smoke.js` | 0 | 609 | Electron, ~90 s, real canvas |
| `tests/test_product_app.js` | 0 | 70 | Phase 1 app; `analysis/build_report2.py` re-counts it live |

225 + 184 + 650 + 313 + 195 + 96 + 609 = **2,272** assertions across the seven game suites, all exit 0

(Two later passes grew them again. 2026-11-13: `test_game_logic` 619 -> 650 and
`smoke` 538 -> 609, covering the boss hurtbox and the four "再来一局" defects —
see the section below.)
(Tasks 22-25 grew them again: `test_audio` 103 -> 225, `test_game_logic` 521 -> 611,
`test_game_meta` 280 -> 313, `test_game_page` 162 -> 195, `smoke` 429 -> 538,
plus the new `test_bosspose` at 96).

(1,529 before Tasks 20–21 added the potion-shop bag-page entry, rarity-tier sorting
and the forgewear slot tabs; see the notes below. 1,362 before Tasks 17–19 added
panel item art, the anvil category tabs and the tight-cropped sprite pipeline.
The last 8 are the panel tab-fit checks added in the review pass described below.)

The smoke run's own readout, verbatim:

```
state=running currentTime=0.000->0.267 sampleRate=48000 gain=0.30000001192092896->0->0.5
节流=[true,false,false] 局内计数={"slash":3,"hurt":1,"potion":2,"bagOpen":4,"upgrade":2,"sell":2,"coin":2,"seed":1}
```

### Screenshots, and what each one shows

Captured from an offscreen Electron window at 1100×800 (canvas 980×613, so the 960×600
playfield renders at scale 1.0208). The pixel claims below were read from the DOM at the same
moment, not inferred from the image.

| File | What is actually on screen |
|---|---|
| `/tmp/t15-hub.png` | Hub with all six facilities. The name capsules sit at six different heights (y = 307…366, a 59 px spread) and each one is exactly 6 px above its own art's bounding-box top — the gap is 6 px for all six, so the staggering follows the art, not a hand-written table. No "按 J" text object exists in the scene. The grey J keycap is already visible next to the anvil, because the spawn point is inside that zone's reach. |
| `/tmp/t15-bag-panel.png` | Bag panel 470×500 px = **40.799 %** of the 960×600 playfield (26.7 % of the window). Header "背包 10 / 35", seven filter tabs (全部/头部/躯干/背部/武器/脚部/特殊), paper-doll column with five slot pills per side and a stats block (生命上限 70 / 伤害 12 / 移速 250 / 受伤 ×1.00), 35 cells of which 10 hold icons with Lv badges, footer "第 1 / 1 页" with ◀ ▶ and +扩容. |
| `/tmp/t15-bag-batch.png` | Batch mode, nothing selected. The 整理 / 批量出售 buttons are gone from the header, every filled cell has an empty checkbox, the footer bar reads "未勾选可卖的装备" and 确认 is disabled. |
| `/tmp/t15-bag-batch-selected.png` | Batch mode after "重复件": two cells ticked with an orange frame, sum reads "出售 2 件 · 共 328 铜币", 确认 now enabled — **and the bar is clipped**: see the defect below. |
| `/tmp/t15-keycap.png` + `/tmp/t15-keycap-zoom.png` | Hero standing at the field (x=100, z=88). A grey rounded key with a black J sits above-right of the head, alpha 1.0, readable, no text prompt anywhere. The zoom shows it overlapping the right end of the "田地" capsule. |
| `/tmp/t15-esc-hub.png` | ESC in the hub: one row, 设置. Title "菜　单", subtitle "ESC 关闭 · 游戏已暂停", scene reports `isPaused() === true`, background dimmed. |
| `/tmp/t15-esc-run.png` | ESC during a run: two rows — 设置 (dark) and 退出战斗 (red-tinted, `rgb(255,180,168)`), run scene paused, HUD dimmed behind the overlay. |
| `/tmp/t15-settings.png` | Settings page: 音乐 and 音量 rows, each a 208×22 px track with an 8 px green fill to 30 % and a 16 px white round thumb, value 30 in gold to the right, the note "暂无 BGM · 音乐通道未接入（滑块只保存设置，不发声）" under the music row, 返回 bottom-right. Dragging 音量 to 70 moves value, label, fill and the real gain together (0.300 → 0.700); dragging 音乐 to 10 leaves the gain at 0.700. |
| `/tmp/t15-v2-import.png` | A version-2 save imported through the code box, then entered. The hub renders with the three mature plots from that save, the player name is the imported one, no white screen, no console error. |

### A defect this pass found: the shop panels had no item art at all

Recorded because it is the same failure shape as the batch-bar bug — 1,529 green
assertions, and the feature was simply not there.

The design (§5.1) requires every weapon-rack row to show that item's sprite. Measured
in the real browser: `{"title":"兵器架","rows":35,"tabs":5,"imgs":0}` — the tabs shipped,
the rows were plain text. The anvil panel (`铁匠铺`) was worse: `{"rows":3,"tabs":0,"imgs":0}`,
three text rows with no categories. The acceptance table had no clause saying an image
must exist, so nothing could fail.

Fixed in three passes, each one found by looking at the previous one's screenshot:

| Task | What | Commit |
|---|---|---|
| 17 | `game/sprites.js` + `SpriteLib.url`; 28×28 upgrade icons baked in `app.js`; anvil tabs 全部/攻击/生存/机动; `<img>` in every shop row | `a8c48b4` |
| 18 | `SpriteLib.fitUrl(key, boxW, boxH)` — crop to the non-transparent bounding box, then integer-scale (nearest neighbour). Panel icon content coverage went 0.043–0.28 → **1.000** | `3e48645` |
| 19 | Same pipeline in the bag grid (32×46) and the ten worn slots (20×28). Hero doll deliberately left on the full 40×60 sheet | `893fce0` |

New acceptance rows V31 / V32 pin the images (count, distinctness, `naturalWidth`,
decoded-pixel coverage) so this cannot silently regress again.

### Old save: version 2 → 6

Logic layer (`node`, `L.deserialize` on the fixture shape used by `tests/test_game_logic.js`):

```
version: 6 | STATE_VERSION: 6
coins: 999 | seeds: 4 | upgrades.damage: 5
runsCompleted: 42 | bestWave: 4 | maturePlots: 3
bag: array len 0 | bagPages: 1 | uidSeq: 0
settings: {"volume":0.3,"muted":false} | skills.whirl: 1
old fields dropped: true true
round-trip stable: true | version after re-read: 6
startRun after migrate -> phase: run | difficultyId: wood
```

Browser layer: the same JSON was base64-encoded into a save code, pasted into `#codeBox`, and
entered from the profile list. Reading the state afterwards gave `version 6`, `coins 999`,
`seeds 4`, `runsCompleted 42`, `bestWave 4`, `bag` an empty array, `bagPages 1`, `uidSeq 0`,
`settings {volume 0.3, muted false}`, 9 farm plots, and the retired `inventory` /
`inventoryLevels` fields gone from `meta`. The canvas had a non-zero rect and the hub scene was
active.

That check matters more than it looks: `enterAs` falls back to `createState()` when
`deserialize` throws, so "the page did not crash" is not evidence of a migration — the coins
and the run record surviving is.

### A defect this pass found

**The batch-sell bar is clipped, so 确认 and 取消 cannot be reached with a mouse.**

`#bag-batchbar` lives in the right column, which is 267 px wide inside the 470 px panel, and
its content needs more than that. Measured in the browser:

| State | Box width | Content width | Overflow | 确认 button | 取消 button |
|---|---|---|---|---|---|
| Nothing selected | 267 px | 334 px | 67 px | right edge 14 px past the panel | right edge 57 px past the panel |
| "重复件" (2 items, "出售 2 件 · 共 328 铜币") | 267 px | 362 px | 95 px | fully outside the panel | fully outside the panel |

`#bag{overflow:hidden}`, so the overflow is not scrolled, it is cut. `document.elementFromPoint`
at the centre of 确认 and at the centre of 取消 returns `BODY` in both cases: the buttons are not
painted where a user would click. In the screenshot the sum text itself is cut mid-character
("共 328 铜" then the panel edge).

`tests/browser/smoke.js` clicks these buttons with `.click()`, which ignores geometry, so the
suite was green while the feature was unusable by hand. That is the general lesson: `.click()`
proves the handler is wired, not that a player can reach the control.

**Fixed in `bad1940`.** The bar was moved out of the right column and made a direct child of
`#bag`, spanning the full panel width (454 px of usable space). Panel height and grid height are
unchanged — the page bar and the batch bar are mutually exclusive and shared one 24 px slot, so
the right column loses exactly what the panel level gains. Re-measured after the fix:

```
selected 2: bar client 470 / scroll 470 | okRight 973 | cancelRight 1016 | bagRight 1024
            okHit "b ok confirm-ok" | cancelHit "b" | gridH 394
```

Two earlier drafts of the acceptance test were useless and were replaced: asserting that the
sum's `textContent` contains "铜币" passes even when the element is clipped (`textContent` is
unaffected by `overflow`), and `sum.scrollWidth <= clientWidth` passes too, because the sum box
itself was never the thing being cut. The assertion that actually fails on the broken build is
"the sum's right edge is inside the bar's right edge", plus `elementFromPoint` on both buttons.
14 geometry assertions were added; the suite went 308 → 322.

Not a defect, but worth recording: standing at the left end of the field makes the J keycap
cover the last character of the "田地" capsule. Both are legible in sequence, and the keycap is
drawn above the label by design.

### Tasks 22-25: four more checks that had to be proved able to fail

The same discipline was applied to the second requirement batch (fade-in/out, seed spoilage,
footstep/victory/defeat/cricket audio, the shop's farm-plot purchase and farm paging, and the
boss's procedural arms). Each task's report had to quote the red-phase `FAIL ... -> got X, want Y`
lines, and each one was re-verified by deliberately breaking the implementation:

| Break | Result |
|---|---|
| Set `AUDIO.ambient.fade` to 0 | 4 assertions red: `默认淡入淡出 0.25 秒`, `起播时先把增益压到 0（不硬起）`, `再用 linearRamp 升上去`, `stop 带了时间点（硬切实现会是不带参数的 stop()）` |
| Delete the `#panel.on ~ #toast` CSS rule | `FAIL 提示条整个在卡片下面（不压住刚变化的那一行） -> 卡片底边 594 / 提示条顶边 535` (one failure, 515 pass) |
| Force the farm's right arrow to `alpha 1` on every page | 2 red: `末页右箭头是灰的（到边了，点不动） -> 1` |
| Point `BossPose.compute` at always-zero displacement | 2 red: `走动时姿态进入 walk -> seen=idle`, `走路时手臂是垂着的（0 < armRaise < 0.4） -> null` |
| Drop both `bossArmGfx.clear()` calls | `FAIL 没有 Boss 时手臂层是空的 -> got 94412, want 0` |

Two findings worth keeping from this batch:

- **A "reset" assertion that could not fail, again.** The smoke section that borrows
  `state.meta.bagPages` asserted "the value at the end equals the value on entry". But the
  section entered with `bagPages === 2` (an earlier section had already bought a page) and
  bought it from 1 to 2 again, so "entry value == exit value" held even with no reset code at
  all. Deleting the whole reset block only turned the `coins` assertion red; deleting just the
  page-count line left the page assertion green. Fixed by restoring to an explicit different
  value (`C.BAG.maxPages` = 6) and asserting that the restore target differs from the
  post-purchase value. This is the same failure shape as the `L.sellItem(s, wornUid).ok === false`
  case earlier: the assertion is true for a reason unrelated to the rule it names.
- **A geometric check that lived only in a throwaway probe.** The farm arrow positions, the
  boss arm layer depth and the toast/Card overlap were first measured by one-off Electron
  scripts. The panel-tab clipping incident (7 tabs in the DOM, 6 on screen, every assertion
  green because it counted nodes instead of measuring geometry) is exactly what happens when a
  geometry check is not promoted into the permanent suite. All three are now permanent
  assertions in `tests/browser/smoke.js`.

## A claim that did not survive checking: a verification that could not fail

Recorded because the assertion *looked* like the strongest one in the batch and was, in fact,
the only one that could never fail.

Task 21's brief asked for the state borrowed by its potion-shop section to be handed back, and
for one assertion proving the hand-back happened. The implementer reported, in a code comment,
"删掉复位代码这两条就会变红（已实测，见报告）" — deleting the restore code makes these two
assertions turn red, measured, see the report.

There is no report, and the claim is false. The assertions compared the value read back at the
end of the section against the value read at the start:

```
entry bagPages = 2      (some earlier section had already bought a page)
including this section's purchase   -> too
read back at the end = 2
```

The section is a **no-op with respect to `bagPages`** — it buys a page and it started from an
already-bought page, so entering and leaving both observe 2. "Read back == entry value" holds
whether or not the restore code exists. Deleting the whole restore block turned the `coins`
assertion red (`got 800, want 99812`) and left the `bagPages` assertion green; deleting only
the page-count line left it green too.

The fix is to restore to a value that **cannot** equal the borrowed one, and to say why:

* `out.t20PagesRestoreTo = C.BAG.maxPages` (6) — restore to 6, and 1 → 2 can never equal 6.
* a new assertion that the restore target differs from the value the section produces.

Verified by re-breaking it: `FAIL 段末把 bagPages 复位成指定值（有借有还） -> got 2, want 6`.

Lesson, and the reason this is in the evidence file rather than a commit message: an assertion
built from "the value I saw before" is only as strong as the chance that before and after
differ. When the borrowed state is a small integer that other sections also move, write the
target explicitly and assert the two are distinguishable. This is the second time in this batch
that a green assertion proved nothing (the first: `L.sellItem(s, wornUid).ok === false`, true
because the item is no longer in the bag, not because of the rule it was written to test).

A second, smaller falsehood from the same report: it listed a brief defect that does not exist
(an enumeration said "只有这五个" and then listed six items; the item was simply wrapped across
a line). The other five items it raised were real and were fixed.

### A check that lived only in a throwaway probe, and now does not

Task 21's review measured the facility panel's tab strip in a scratch Electron probe, found
nothing wrong, and reported it — then deleted the probe. That is the wrong place for a check
whose whole purpose is to catch a regression later. The failure mode it guards is specific and
has already happened once in this batch: the bag panel was narrowed to 470 px, seven tabs
stopped fitting, the seventh was clipped by `overflow: hidden`, and **the assertion suite stayed
green** because it counted DOM nodes rather than measuring geometry.

Eight assertions now measure it, on both facility panels, every run:

| Reading | Why it is needed |
|---|---|
| `scrollWidth <= clientWidth + 1` | the container itself overflows |
| last tab's right edge inside the container's right edge | the strip is not clipped, but is drawn past the panel edge |
| last tab width >= 24 px | the tabs were squeezed rather than dropped |

Both quantities are required: `scrollWidth` can equal `clientWidth` when nothing sets
`overflow`, and the tab can be inside a container that is itself drawn outside the panel.

Broken on purpose, twice, and each time only the intended assertions failed:

```
# last tab pushed 500 px right of the container
FAIL  铁匠铺最后一个页签的右缘在容器内（不是画到面板外面）  -> 最后右缘 1292 vs 容器右缘 792，宽 48
FAIL  兵器架最后一个页签的右缘在容器内（不是画到面板外面）  -> 最后右缘 1292 vs 容器右缘 792，宽 48

# scrollWidth forced to clientWidth + 500
FAIL  铁匠铺页签一行放得下（没被 overflow 裁掉）  -> scroll 984 vs client 484
FAIL  兵器架页签一行放得下（没被 overflow 裁掉）  -> scroll 984 vs client 484
```

Neither break touched the bag panel's own tab assertions, which stayed green in both runs —
the new checks are additive.

### Reproducing this section

```bash
node tests/check_textures.js && echo ok        # run each separately; no && between suites
node tests/test_audio.js
node tests/test_bag.js
node tests/test_game_logic.js
node tests/test_game_meta.js
node tests/test_game_page.js
node tests/test_bosspose.js
node tests/browser/smoke.js                    # alone; owns 127.0.0.1:8123
node tests/test_product_app.js
```

The screenshot and import drivers are one-off scripts (they live in `/tmp`, not in the
repository): an Electron `BrowserWindow` with `offscreen: true`, `capturePage()` to PNG, and
`executeJavaScript` for the DOM reads. `tests/browser/_driver.js` is such a generated file and
is git-ignored.

## 2026-11-13 — boss hurtbox, and four defects in "再来一局"

The PM played the deployed build and reported four things. Three of them were real defects in
the restart path that **no test in this repository could have caught**, because every existing
test started a run from scratch and never restarted one. That is the interesting part of this
section; the fix list is short.

### What was reported, and what the code actually did

1. *"第一二段普攻确实打到了，但是要完全贴住 boss 才能打到"* — the boss is pushed apart from the
   player by `minGap = C.BOSS.radius + C.PLAYER_W/2 + 6 = 69px`, and the hit test was
   `dx < range` against the boss **centre**. Combo ranges were 73/78/90, so segment 1 only had
   4px of margin. Small enemies (`radius` 16–18, `minGap` 39–41) cleared all three segments
   comfortably, which is exactly why the defect survived every prior test: the tests fight
   small enemies.
2. *"不管在什么关卡死了点再来一局都回到了林地难度"* — `startBossRun` called
   `L.startRun(this.state, 'wood')`, hard-coded. `endRun` recorded only `difficultyId`, so a
   boss run recorded `wood`, and the restart handler read that value back. Compounding it,
   `C.difficultyById` **silently falls back to wood** for an unknown id (`'hard'`, `'hell'`,
   `''` all return wood), so passing a boss tier as a difficulty id does not throw — it just
   quietly becomes 林地.
3. *"显示的是人物走到了关卡地图的最左边，按 J 却进入了农场"* — after the restart handler ran
   `L.returnToFarm(state)` (which sets `phase = 'farm'`) it called `this.scene.restart()`. But
   `RunScene.update` bails on `state.phase !== 'run'`, so the battle never ran; the frozen
   battlefield then read `J` through the Hub-style interaction path, matched `zone.id === 'field'`,
   and went to the farm.
4. *"进入第二个 boss 关卡在了渐黑"* — `startRun`/`startBossRun` waited for
   `camerafadeoutcomplete` and nothing else. If the camera was not stepping, the event never
   arrived and the screen stayed black forever.

### The two checks that were added, and both were proved able to fail

`test_game_logic.js` grew `V18c` (the restart must remember *which* run it was) and `V18d` (the
phase state machine must return to `run`, or the battle does not run). 619 -> 650.

Removing the two fields from `endRun` makes **10** of them go red:

```
FAIL  档 normal 结算后记住这是 Boss 局  -> got undefined
FAIL  结算后记住档位                  -> got undefined
FAIL  读档后 isBossRun 还在            -> got undefined
失败 10 项，通过 640 项
```

`tests/browser/smoke.js` grew a `3f` section that, for each of the three boss tiers, starts the
run, kills the player, clicks `#btn-again`, and then presses Tab twice and ESC once. 538 -> 609.
Restoring the hard-coded `'wood'` makes **6** of them go red:

```
FAIL  档 hard 开局难度是 deep                            -> got "wood", want "deep"
FAIL  档 hard 重开后难度仍是 deep（PM 报的"回到林地"就是这条）  -> got "wood", want "deep"
FAIL  档 hell 重开后难度仍是 forge（PM 报的"回到林地"就是这条） -> got "wood", want "forge"
失败 6 项，通过 603 项
```

### A false lead worth recording

The first version of the smoke section failed on `hard` and `hell` with `got "wood"`, and my
first explanation was that `startBossRun`'s `if (this.transitioning) return;` guard had not been
reset. A separate probe disproved it: `transitioning` was `false` before every call, and all
three tiers set their difficulty correctly when driven in isolation.

The real cause was in **my own test**, not the product. The loop did not reset the previous
iteration's scene state: after one restart the Run scene was already live and `phase` was `run`,
so the next `startBossRun` took the `hubLive === false` short-circuit
(`this.scene.start('Run')`) while `Run` was already running — the call was swallowed and the
readings belonged to the previous tier. Fixed by explicitly stopping `Run`, restarting `Hub`
and clearing `st.run`/`st.phase` at the top of each iteration.

The lesson is the same one this file keeps recording from the other direction: a reading that
looks like a product defect is worth one probe to attribute before it is written up as one.

### Timing, and why the assertions read `sys.settings.status`

`scene.pause()` / `scene.resume()` are **deferred** — reading `scene.isPaused()` immediately
after the call returns the old value. The first version of these assertions did that and reported
"the bag opened but the scene did not pause", which is a false red. They now read
`scene.sys.settings.status` (5 = RUNNING, 6 = PAUSED) after a 350 ms settle. Instrumenting
`pause`/`resume` on the scene confirmed the real sequence is correct:

```
pause@9120 status=5  ->  resume@9377 status=6
```

and the character moves 285 -> 435 after the bag is closed, which is the outcome that actually
matters.

### The engine error that took the longest

After the restart, the console carried:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'sys')
    at initialize.setTexture (phaser.min.js:1:199027)
    at app.js:2897
    at Array.forEach
    at RunScene.update (app.js:2882)
```

Phaser reuses scene instances across `stop()`/`start()`, but destroys their GameObjects. The boss
sprite is lazily created and cached on `this`, so after a restart `this.bossSprite` was still the
**previous run's corpse** — truthy, so the lazy-create branch was skipped, and `setTexture` was
called on a destroyed object. Two plausible-looking fixes (`scene.sys.isActive()` in the input
guard, `this.sys.isActive()` in `startRun`) changed nothing; capturing the real stack via a
`window.addEventListener('error', ...)` hook is what located it. Fixed by nulling
`this.bossSprite` / `this.bossShadow` in `RunScene.create()`.

### Final counts

```
check_textures ok
test_audio 225 | test_bag 184 | test_game_logic 650 | test_game_meta 313
test_game_page 195 | test_bosspose 96 | smoke 609
```

2,272 assertions, all exit 0.
