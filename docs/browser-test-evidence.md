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
browser into CI to test a static page whose rules are already covered by 302 assertions is a
poor trade. The honest position is to record the browser evidence here, run it locally before a
release, and say plainly that CI does not cover it — rather than adding a `continue-on-error`
green tick that proves nothing.

## Result of the run

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

15 assertions, all passing, against `http://127.0.0.1:PORT/game/` served from the working tree.

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
