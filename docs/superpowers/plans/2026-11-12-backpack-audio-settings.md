# 背包 · 音效 · ESC 菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Emberfield 加上可见的收藏背包（含分页、出售、批量出售、整理）、十七个合成音效、ESC 菜单与音量设置，并把基地六个点位改成错落布局、攻击连段加长 5%。

**Architecture:** 规则全部落在纯模拟层 `logic.js`（不碰 DOM/Phaser/storage），数值全部落在 `config.js`；背包界面用**已存在的 DOM `#panel` 浮层**承载，不用 Phaser 场景也不用 rexUI；音频走**自建 `AudioContext` 薄封装**（`game/audio.js`），因为 `app.js` 的 `noAudio: true` 已让 Phaser 的 sound manager 失效；暂停统一用 `this.scene.pause()`。

**Tech Stack:** 原生 JS（无构建步骤）、Phaser 3.80.1（**Canvas 渲染器**，已 vendored）、Node 内置 `assert` 跑测试、DOM 浮层 + 自建 WebAudio。

**Spec:** `docs/superpowers/specs/2026-11-12-backpack-audio-settings-design.md`（设计文档，本计划逐条实现它；执行者应同时读两份）

---

## Global Constraints

- **规则与渲染分离**：`logic.js` 内**禁止**出现 `document` / `window` / `Phaser` / `localStorage`。CI 有测试盯着这条。
- **数值只在 `config.js`**：`logic.js` / `app.js` 里出现裸魔数视为缺陷。
- **不引入图片或音频文件**：美术全部 `Graphics.generateTexture`，音效全部 WebAudio 合成。唯一例外是已有的六个 Boss PNG。
- **渲染器是 Canvas**（实测 `renderer.type === 1`）：不能用任何依赖 WebGL 的 API。
- **不装新依赖**：rexUI 已评估并明确否决。
- **存档向后兼容**：`STATE_VERSION` 由 **5 改为 6**，且必须新增 `if (s.version === 5) {...}` 顺序迁移段。
- **药水只改显示名，不改 id**（`heal` / `strength` / `wall`），否则存档失效。
- **页签判据是 `kind === 'special'`**，不是 `ultimate`（`config.js` 里 `ultimate` 出现 0 次）。
- **`Digit1-3` / `Numpad1-3` 已被药水占用**，页签不能用数字键。
- **测试基线（改动前必须全绿）**：`check_textures` ✓、`test_game_logic` **389**、`test_game_meta` **110**、`test_game_page` **44**、`tests/browser/smoke.js` **45**。合计 **588**。
- **胜率基线（改动前冻结）**：零强化 `100/94/54/1`、半满 `100/97/89/26`、全满 `100/96/97/73`。
- **测试命令**（本机 `npm` 不存在，用下面这个 node）：
  ```bash
  N="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
  "$N" tests/test_game_logic.js
  ```
- **`timeout` 命令在 macOS 上不存在**，需要限时用后台任务。

---

## File Structure

| 文件 | 现状 | 本批职责 |
|---|---|---|
| `game/config.js` | ~700 行 | 加 `BAG`（格数/页价/列行）、改 `POTIONS` 三个显示名、改 `COMBO.steps` 与三个 `ATTACK_*`、加 `AUDIO` 参数表、`ZONES` 的 `z` 值、删 `EQUIP_DROP.refundRatio` |
| `game/logic.js` | ~1700 行 | **主要改动**：`meta.bag` 条目数组、`meta.bagPages`、`STATE_VERSION` 6 + 迁移、`bagAdd`/`bagRemove`/`bagAt`/`bagCapacity`/`sellValue`/`sellItem`/`sellBatch`/`sortBag`/`rollBagPage`、装备函数改按条目、删退款路径 |
| `game/audio.js` | **新建** | 自建 `AudioContext` 单例、17 个音效的合成函数、`play(name)`、`setMasterVolume`、`setMuted`、25ms 节流 |
| `game/baghud.js` | **新建** | 背包 DOM 浮层的构建与刷新（从 `app.js` 里分出来，避免 `app.js` 继续膨胀） |
| `game/app.js` | ~2617 行 | `CODES` 加 `Tab`、`preventDefault` 加 `Tab`、`scene.pause()` 暂停、键帽绘制、点位按 `toScreen` 画、音效触发点接线、ESC 菜单、攻击范围接线 |
| `game/hub.js` | ~200 行 | `ZONES` 加 `z`、`zoneAt` 改按屏幕距离判定 |
| `game/index.html` | ~636 行 | `#panel` 增加背包/ESC 菜单的容器与样式、页脚药水图例改名、音量按钮 |
| `tests/test_bag.js` | **新建** | 背包规则的全部断言（库存/分页/出售/批量/排序） |
| `tests/test_audio.js` | **新建** | 音效合成层的参数与节流断言（用 stub AudioContext） |
| `tests/test_game_logic.js` | 389 断言 | 改写退款断言、药水名断言、加迁移断言 |
| `tests/browser/smoke.js` | 45 断言 | 改药水名断言、加背包/ESC/暂停断言 |

---

## Review Focus

以下五类是设计文档暗示、但没有哪条测试天然覆盖的输入或情形。每条都已指派到某个任务的测试里。

1. **背包正好在满的边界上再加一件** —— 第 35 格放入后应停在页 1；再放一件必须去页 2 而不是静默丢弃。玩家最可能在这个数字上发现「东西不见了」。
2. **把所有页都买满后继续掉落** —— 6 页 210 格全满时不能再有第 211 格。设计规定「不丢装备」，所以要么明确拒绝并提示，要么有确定的溢出行为；绝不能出现 `bag[210]` 这种越界写入。
3. **穿戴中的装备与背包里的同一 id 同时存在** —— 玩家穿了一件、背包里还有一件同 id（掉落重复品）。此时「已拥有」的判定、升级目标、出售目标三处都可能选错那一件。出售必须卖背包里的、升级必须能分清升的是哪一件。
4. **暂停中卖出装备后的英雄图层** —— `scene.pause()` 期间 `update` 不跑，换装/出售后必须显式 `refreshHeroEquip`，否则玩家看到的是卖出前的样子。这条之前真实踩过一次。
5. **老存档（`version: 2`）直接升级到 6** —— `migrate` 是顺序 `if` 链，缺任何一环都会在 `deserialize` 的版本校验处硬抛异常，玩家打开游戏就是白屏。必须能 2→3→4→5→6 一路走通。

---

## Task 1: 删掉 30% 自动退款，掉落全部进背包

**Files:**
- Modify: `game/config.js:416`（删 `refundRatio`）
- Modify: `game/logic.js:548-568`（`rollEquipDrop`）、`game/logic.js:1281-1291`（`killEnemy` 掉落块）
- Modify: `game/app.js:1661-1671`（掉落提示文案；`d.refund` 的引用在 **1667** 行）
- Test: `tests/test_game_logic.js:1360-1390`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `rollEquipDrop(state) -> { id: string, duplicate: boolean } | null` —— **不再有 `refund` 字段**。`tryEquipDrop(state)` 签名不变。

- [ ] **Step 1: 改写失败测试**

在 `tests/test_game_logic.js` 里替换退款相关的三条断言（约 1360-1390 行），改为：

```js
// 重复品不再折算，而是进背包
const dupState = L.createState(7);
let dupDrop = null;
for (let i = 0; i < 5000 && !dupDrop; i++) {
  const d = L.rollEquipDrop(dupState);
  if (d && d.duplicate) dupDrop = d;
}
ok(dupDrop && dupDrop.refund === undefined, '重复掉落不再带 refund 字段');
ok(C.EQUIP_DROP.refundRatio === undefined, '折算比例已从配置里删除');
const before = dupState.meta.bag.length;
L.rollEquipDrop(dupState);   // 已知存在的 id，必然重复
ok(dupState.meta.bag.length === before + 1, '重复品也进背包（不会撑爆背包）');
// 注：meta.bag 由 Task 2 引入。本任务先只断言 refund 已删除，
// 上面这条 bag 断言在 Task 2 完成后才可能通过 —— Step 2 的失败是预期的。
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— `meta.bag` 是 `undefined`，`TypeError`。**这是预期的**：本任务先删退款，`meta.bag` 由 Task 2 引入。

- [ ] **Step 3: 删除退款路径**

`config.js`：删掉 `EQUIP_DROP` 里的 `refundRatio: 0.30,` 整行。

`logic.js` 的 `rollEquipDrop` 改为（注意：`push` 只留**一处**）：

```js
function rollEquipDrop(state) {
  const pool = Object.keys(C.ALL_EQUIPMENT).filter(function (id) {
    return C.ALL_EQUIPMENT[id].kind === 'base';
  });
  if (pool.length === 0) return null;
  const id = pool[Math.floor(nextRandom(state) * pool.length)];
  const duplicate = !!equipOwned(state, id);
  state.meta.inventory.push(id);
  return { id: id, duplicate: duplicate };
}
```

`logic.js` 的 `killEnemy` 掉落块改为（**删掉 `run.loot.coins += drop.refund` 与重复的 `push`**，后者是既有缺陷）：

```js
if (!e.isBoss) {
  const drop = tryEquipDrop(state);
  if (drop) {
    run.equipDrops = run.equipDrops || [];
    run.equipDrops.push({ id: drop.id, duplicate: drop.duplicate });
  }
}
```

`app.js:1667` 的提示文案：删掉 `d.refund` 相关分支，改为重复品也提示「拾得 <名>（重复）」但**不显示折算金额**。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js`
Expected: 断言数由 **389** 变为新的数字（约 387–389），**全部通过**。

- [ ] **Step 5: 提交**

```bash
git add game/config.js game/logic.js game/app.js tests/test_game_logic.js
git commit -m "feat(bag): 删除重复件 30% 自动退款，掉落全部进背包"
```

---

## Task 2: `meta.bag` 条目数组 + `STATE_VERSION` 5→6 迁移

**Files:**
- Modify: `game/logic.js:17`（`STATE_VERSION`）、`game/logic.js:36`（`createState`）、`game/logic.js:1623-1649`（`migrate`）
- Test: `tests/test_game_logic.js`（迁移段）

**Interfaces:**
- Consumes: Task 1 的 `rollEquipDrop`
- Produces:
  - `meta.bag: Array<{ id: string, level: number }>`
  - `meta.bagPages: number`（默认 1）
  - `bagAdd(state, id, level) -> number`（返回落位下标）
  - `bagRemove(state, index) -> { ok: boolean, reason?: string }`
  - `bagAt(state, index) -> { id, level } | null`
  - `bagCount(state) -> number`
  - `bagCapacity(state) -> number`（= `bagPages × 35`）
  - `bagIndexOfUid(state, uid) -> number`
  - **`meta.inventory` / `meta.inventoryLevels` 本任务后不再存在**

> **为什么要 `uid`**：同一 id 可能有两件（重复掉落）。DOM 上用「第几格」做 key 会在排序后错位，所以每件给一个稳定 `uid`（`id + '#' + 自增数`），只存在于 `bag` 条目内、不进存档的语义层。

- [ ] **Step 1: 把 Task 1 的裸 push 接成容量感知**

`rollEquipDrop` 里 Task 1 留下的 `state.meta.inventory.push(id)` 必须改成落位逻辑，
否则第 211 件要么越界要么静默消失（设计 §4.7 明确要求"不丢装备"）：

```js
const idx = bagAdd(state, id, 1);            // 容量内：正常入格
if (idx === -1) {
  // 全满：不丢、也不越界 —— 落进最后已解锁页的末格，由 UI 提示"背包已满"
  const last = bagCapacity(state) - 1;
  state.meta.bag[last] = { id: id, level: 1, uid: nextUid(state) };
  return { id: id, duplicate: duplicate, bagFull: true };
}
return { id: id, duplicate: duplicate, bagFull: false };
```

- [ ] **Step 2: 写迁移测试**

```js
// v2 老档必须一路链到 6，否则 deserialize 会硬抛
const v2 = JSON.stringify({ version: 2, meta: { coins: 10 }, hub: null });
const mig = L.deserialize(v2);
ok(mig.version === L.STATE_VERSION, 'v2 老档能迁移到当前版本');
ok(mig.meta.bagPages === 1, '迁移补出 bagPages = 1');
ok(Array.isArray(mig.meta.bag), '迁移补出 bag 数组');

// v5 存档里的 inventory 要转成 bag 条目
const v5 = JSON.stringify({
  version: 5, meta: { coins: 5, inventory: ['longCloak', 'windBoots'],
                      inventoryLevels: { longCloak: 3 }, skills: {}, potions: {},
                      upgrades: {}, equipment: {} }, hub: null,
});
const m5 = L.deserialize(v5);
ok(m5.meta.bag.length === 2, 'v5 的两件库存转成两个条目');
const lc = m5.meta.bag.filter((e) => e.id === 'longCloak')[0];
ok(lc.level === 3, '条目保留原等级');
ok(m5.meta.bag.filter((e) => e.id === 'longCloak').length === 1, '按 id 去重，不凭空造件');
```

- [ ] **Step 3: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— `存档版本不匹配` 或 `meta.bagPages` 为 `undefined`。

- [ ] **Step 4: 实现条目数组与迁移**

迁移块里**同时补 `meta.settings`**（Task 12 的音量/静音要存这里，而 `createState` 今天没有该字段）：

```js
// createState 的 meta 里加：
settings: { volume: 0.30, muted: false },
// migrate 的 5 → 6 块里加：
if (!s.meta.settings) s.meta.settings = { volume: 0.30, muted: false };
```

测试要断言 `L.createState(1).meta.settings.volume === 0.30`，
以及老档迁移后 `settings` 存在（否则 Task 12 一读就 TypeError）。

`STATE_VERSION = 6`。`createState` 里 `meta.bag = []`、`meta.bagPages = 1`，删 `inventory`/`inventoryLevels`。

`migrate(s)` **追加一段**（在既有 `v4→v5` 块之后）：

```js
// v5 → v6：库存从「id 列表 + 按 id 的标量等级」改为「条目数组」。
// 旧结构装不下重复件（同一 id 只能记一个等级），而本批要求重复件也进背包。
// 迁移按 id 去重 —— 老档本来也只存得下一件，不凭空造件。
if (s.version === 5) {
  if (!s.meta) s.meta = {};
  const oldIds = s.meta.inventory || [];
  const oldLv = s.meta.inventoryLevels || {};
  const seen = {};
  s.meta.bag = [];
  oldIds.forEach(function (id) {
    if (seen[id]) return;
    seen[id] = true;
    s.meta.bag.push(bagEntry(id, oldLv[id] || 1));
  });
  delete s.meta.inventory;
  delete s.meta.inventoryLevels;
  s.meta.bagPages = 1;
  s.version = 6;
}
```

同时**删掉** `deserialize` 末尾兜底块里的 `if (!s.meta.inventory) s.meta.inventory = [];` 与 `inventoryLevels` 两行，改为兜 `bag`/`bagPages`（兜底仍然不能替代迁移，只是防止 v6 存档缺字段）。

`bagAdd` 必须**尊重页容量**，满了返回 `-1`：

```js
function bagAdd(state, id, level) {
  if (state.meta.bag.length >= bagCapacity(state)) return -1;
  state.meta.bag.push(bagEntry(id, level || 1));
  return state.meta.bag.length - 1;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add game/logic.js tests/test_game_logic.js
git commit -m "feat(bag): 库存改为条目数组，STATE_VERSION 5->6 顺序迁移"
```

---

## Task 3: 装备函数改按条目操作

**Files:**
- Modify: `game/logic.js:410-545`（`equipOwned`/`buyEquipment`/`equipItem`/`unequipSlot`/`equipUpgradeCost`/`upgradeEquipment`）
- Test: `tests/test_game_logic.js`

**Interfaces:**
- Consumes: Task 2 的 `bagAdd`/`bagRemove`/`bagAt`/`bagIndexOfUid`
- Produces: 上述六个函数**签名不变**（除新增可选 `uid` 参数），但内部按条目操作：
  - `equipItem(state, id, uid?)` —— 有 `uid` 时穿指定的那一件
  - `upgradeEquipment(state, id, uid?)` —— 有 `uid` 时升指定的那一件
  - `equipOwned(state, id) -> 'equipped' | 'owned' | null` **签名不变**

`rollEquipDrop` 里 Task 1 留下的 `state.meta.inventory.push(id)` 必须改成落位逻辑，
否则第 211 件要么越界要么静默消失（设计 §4.7 明确要求"不丢装备"）：

```js
const idx = bagAdd(state, id, 1);            // 容量内：正常入格
if (idx === -1) {
  // 全满：不丢、也不越界 —— 落进最后已解锁页的末格，由 UI 提示"背包已满"
  const last = bagCapacity(state) - 1;
  state.meta.bag[last] = { id: id, level: 1, uid: nextUid(state) };
  return { id: id, duplicate: duplicate, bagFull: true };
}
return { id: id, duplicate: duplicate, bagFull: false };
```

**并加一条断言**：连掉 `bagCapacity + 5` 次之后，
`state.meta.bag.length <= L.bagCapacity(state)`（没越界）且每次返回都非 null（没丢）。

- [ ] **Step 1: 写测试（覆盖 Review Focus #3）**

```js
// 穿一件 + 背包里还有一件同 id：三处判定都不能选错
const s = L.createState(11);
L.buyEquipment(s, 'longCloak');       // 背包 1 件
const uid1 = s.meta.bag[0].uid;
L.equipItem(s, 'longCloak');          // 穿上
L.bagAdd(s, 'longCloak', 5);          // 背包里再来一件 Lv5
ok(L.equipOwned(s, 'longCloak') === 'equipped', '已穿戴优先');
ok(s.meta.bag.length === 1 && s.meta.bag[0].level === 5, '背包里那件仍是 Lv5');

// 升级指定条目：必须升背包里那件（Lv5 -> 满级则换一件测）
const s2 = L.createState(12);
L.bagAdd(s2, 'longCloak', 1);
L.bagAdd(s2, 'longCloak', 1);
s2.meta.coins = 99999;
const uidB = s2.meta.bag[1].uid;
L.upgradeEquipment(s2, 'longCloak', uidB);
ok(s2.meta.bag[0].level === 1, '没有 uid 的那件没被动过');
ok(s2.meta.bag[1].level === 2, '指定 uid 的那件被升级');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— `buyEquipment` 仍写 `meta.inventory`，`meta.bag` 为空。

- [ ] **Step 3: 改这六个函数**

- `equipOwned`：`state.meta.inventory.indexOf(id)` → `state.meta.bag.some(e => e.id === id)`。
- `buyEquipment`：`push(id)` + 记等级 → `bagAdd(state, id, 1)`。
- `equipItem(state, id, uid)`：从 `bag` 删条目（有 `uid` 删那件，否则删第一件），换下的旧装备 `bagAdd(state, prev.id, prev.level)`，新装备的 `level` 取**被删条目的 level**。
- `unequipSlot`：`bagAdd(state, it.id, it.level)`。
- `equipUpgradeCost(state, id, uid)`：等级来源从 `inventoryLevels[id]` 改为「`uid` 指定条目，或 `bag` 里第一个同 id 条目」。
- `upgradeEquipment(state, id, uid)`：同上，写回**对应条目**的 `level`。

> **关键**：`equipUpgradeCost` 与 `upgradeEquipment` **必须一起改**，只改存储会让升级永远只作用于第一件同 id 装备。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/logic.js tests/test_game_logic.js
git commit -m "refactor(bag): 装备读写改按条目（支持同 id 多件）"
```

---

## Task 4: 分页、容量与扩容

**Files:**
- Modify: `game/config.js`（加 `BAG`）
- Modify: `game/logic.js`（`bagCapacity` 已存在于 Task 2；加 `buyBagPage`、`rollBagPage`）
- Test: `tests/test_bag.js`（**新建**）
- **Modify: `.github/workflows/ci.yml`（必须加一步，否则新测试在 CI 里永远不会跑）**

> **CI 集成缺口（预检发现）**：`.github/workflows/ci.yml:165/169/174` 是**逐个点名**
> 调用测试文件的（`node tests/test_game_logic.js` 等），没有"扫描 tests/ 目录"的聚合 runner，
> 也**没有 `package.json` 的 test script**。所以新建的 `tests/test_bag.js`
> 在本地能跑、**在 CI 里永远不会被执行** —— 而分支保护要求 5 个 check 通过，
> 一个从不运行的测试会让"绿"变成假象。
> 因此本任务必须同时改 workflow，加：
> ```yaml
>       - name: Backpack capacity, paging and selling rules
>         # 35 格分页、6 页上限、卖价公式、批量保留一件
>         run: node tests/test_bag.js
> ```
> **Task 7/8 若再新建 `tests/test_bag_ui.js` 之类，同样要加。**

**Interfaces:**
- Consumes: Task 2 的 `bagAdd`/`bagCapacity`
- Produces:
  - `C.BAG = { cols: 5, rows: 7, cellsPerPage: 35, maxPages: 6, pagePrices: [0, 200, 500, 1000, 2000, 5000] }`
  - `buyBagPage(state) -> { ok: boolean, reason?: string, cost?: number }`
  - `pageOf(state, index) -> number`（0 基）
  - `pageSlice(state, page) -> Array<{ id, level, uid }>`（不足 35 格补 `null`）

- [ ] **Step 1: 写测试（覆盖 Review Focus #1、#2）**

```js
// Review Focus #1：第 35 格放入后停在页 1，第 36 件必须去页 2
const s = L.createState(21);
for (let i = 0; i < 35; i++) L.bagAdd(s, 'longCloak', 1);
ok(L.bagCount(s) === 35, '页 1 正好 35 格');
ok(L.pageOf(s, 34) === 0, '第 35 格在页 1');
ok(L.bagAdd(s, 'longCloak', 1) === -1, '页 1 满时拒绝（未扩容）');
L.buyBagPage(s);
ok(L.bagAdd(s, 'longCloak', 1) === 35, '扩容后第 36 件落在页 2 首格');
ok(L.pageOf(s, 35) === 1, '下标 35 属于页 2');

// V24：页数与音量必须跨会话保留 —— 靠 serialize/deserialize 往返证明。
// 原稿完全没有这条（独立核验列为覆盖缺口）：买了页、调了音量，
// 关掉页面再回来却回到 1 页 / 默认音量，是玩家一定会遇到的丢数据 bug。
const sRt = L.createState(23);
L.buyBagPage(sRt);                                  // 页 2
L.buyBagPage(sRt);                                  // 页 3
L.bagAdd(sRt, 'longCloak', 2);
const beforePages = sRt.meta.bagPages;
const beforeBag = L.bagCount(sRt);
const json = L.serialize(sRt);
const back = L.deserialize(json);
ok(back.meta.bagPages === beforePages, '页数跨序列化保留（买了 3 页回来还是 3 页）');
ok(back.meta.bagPages === 3, '页数确实是 3，不是被默认值盖掉');
ok(L.bagCount(back) === beforeBag, '背包内容跨序列化保留');
ok(L.bagAt(back, 0).id === 'longCloak' && L.bagAt(back, 0).level === 2,
   '连件与等级一起保留');

// V5 原文：「塞 36 件，第 1 页 35、第 2 页 1」——必须真的数一遍两页各多少件，
// 只断言下标归属是证明不了这个划分的（原稿缺这一条）。
ok(L.pageSlice(s, 0).filter(Boolean).length === 35, '页 1 里正好 35 件');
ok(L.pageSlice(s, 1).filter(Boolean).length === 1, '页 2 里正好 1 件');
ok(L.pageSlice(s, 1)[0] !== null && L.pageSlice(s, 1)[1] === null, '页 2 只有首格有东西');

// Review Focus #2：买满 6 页后不能再有第 211 格
const s2 = L.createState(22);
ok(L.buyBagPage(s2).cost === 200, '页 2 价格 200');
ok(L.buyBagPage(s2).cost === 500, '页 3 价格 500');
ok(L.buyBagPage(s2).cost === 1000, '页 4 价格 1000');
ok(L.buyBagPage(s2).cost === 2000, '页 5 价格 2000');
ok(L.buyBagPage(s2).cost === 5000, '页 6 价格 5000');
const over = L.buyBagPage(s2);
ok(over.ok === false, '第 7 页被拒绝');
ok(s2.meta.bagPages === 6, '页数封顶 6');
ok(L.bagCapacity(s2) === 210, '总容量 210');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_bag.js`
Expected: FAIL —— `Cannot find module` 或 `L.buyBagPage is not a function`。

- [ ] **Step 3: 实现**

`config.js` 加 `BAG`（值见 Interfaces）。`logic.js` 加 `buyBagPage`（校验 `bagPages < maxPages` 与铜币，按 `pagePrices[bagPages]` 收费，成功后 `bagPages += 1`）与 `pageOf`/`pageSlice`。

> **页价索引**：`pagePrices = [0, 200, 500, 1000, 2000, 5000]` 对应「从第 N 页扩到第 N+1 页」的价格，所以买页 2 用 `pagePrices[1]`。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_bag.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/config.js game/logic.js tests/test_bag.js
git commit -m "feat(bag): 分页容量 5x7、最多 6 页、逐页涨价扩容"
```

---

## Task 5: 卖价、单件出售、批量出售

**Files:**
- Modify: `game/logic.js`（加 `sellValue`/`sellItem`/`sellBatch`/`equipInvested`）
- Test: `tests/test_bag.js`

**Interfaces:**
- Consumes: Task 3 的按条目装备函数、Task 4 的分页
- Produces:
  - `equipInvested(id, level) -> number`
  - `sellValue(id, level) -> number`（= `Math.floor(0.5 * (price + invested))`）
  - `sellItem(state, uid) -> { ok, value?, reason? }`
  - `sellBatch(state, uids) -> { ok, count, total, kept }` —— `kept` 是「因每 id 强制留一件而未被出售」的 uid 列表
  - `duplicateUids(state) -> string[]` —— 「勾选全部重复件」用，每 id 保留等级最高者
  - `sellableUids(state) -> string[]` —— 排除已穿戴

- [ ] **Step 1: 写测试（含 §6 的 V8/V26/V27/V28/V29）**

```js
// V8：卖出价实算值（已用脚本核验）
ok(L.sellValue('thornMail', 1) === 350, 'thornMail Lv1 = 350');
ok(L.sellValue('thornMail', 3) === 1593, 'thornMail Lv3 = 1593');
ok(L.sellValue('longCloak', 2) === 245, 'longCloak Lv2 = 245');

// V27 + V9：已穿戴不可卖
const s = L.createState(31);
L.buyEquipment(s, 'longCloak');
const uid = s.meta.bag[0].uid;
L.equipItem(s, 'longCloak', uid);
ok(L.sellItem(s, uid).ok === false, '已穿戴（不在背包）不可卖');

// V26：每 id 强制保留 1 件，全选也不清空
const s2 = L.createState(32);
L.bagAdd(s2, 'longCloak', 1);
L.bagAdd(s2, 'longCloak', 3);
s2.meta.coins = 0;
const r = L.sellBatch(s2, L.sellableUids(s2));
ok(r.count === 1, '两件同 id 只卖掉一件');
ok(s2.meta.bag.length === 1, '强制保留一件');
ok(s2.meta.bag[0].level === 3, '保留的是等级最高的那件');

// V28：总价 = 逐件求和
const s3 = L.createState(33);
L.bagAdd(s3, 'longCloak', 1);
L.bagAdd(s3, 'windBoots', 2);
const r3 = L.sellBatch(s3, L.sellableUids(s3));
ok(r3.total === L.sellValue('longCloak', 1) + L.sellValue('windBoots', 2), '总价逐件求和');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_bag.js`
Expected: FAIL —— `L.sellValue is not a function`。

- [ ] **Step 3: 实现**

```js
function equipInvested(id, level) {
  let sum = 0;
  for (let lv = 2; lv <= level; lv++) sum += C.equipPrice(id, lv);
  return sum;
}
function sellValue(id, level) {
  return Math.floor(0.5 * (C.equipDef(id).price + equipInvested(id, level)));
}
```

`sellBatch` 的实现顺序**很重要**：先按 id 分组 → 每组按 level 降序 → 每组除第一个外全部可卖 → 与传入 `uids` 取交集 → 求和扣款移除。

> **不要用 `equipUpgradeCost` 加总** —— 它返回的是「下一级」的价，不是历史累计。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_bag.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/logic.js tests/test_bag.js
git commit -m "feat(bag): 卖出价 50% 含升级投入，单件与批量出售"
```

---

## Task 6: 整理（排序）与页签过滤

**Files:**
- Modify: `game/logic.js`（加 `sortBag`、`bagFilter`）
- Test: `tests/test_bag.js`

**Interfaces:**
- Consumes: Task 2 的 `meta.bag`
- Produces:
  - `sortBag(state) -> void`（原地排序，稳定）
  - `bagFilter(bag, tab) -> Array<entry>`，`tab ∈ 'all' | 'head' | 'torso' | 'back' | 'weapon' | 'feet' | 'special'`
  - `SORT_KEY` 优先级：`kind === 'special'` 优先 → 槽位序 → 等级降 → id 字典序

- [ ] **Step 1: 写测试（V10、V11）**

```js
const s = L.createState(41);
L.bagAdd(s, 'longCloak', 1);      // base, back
L.bagAdd(s, 'thornMail', 1);      // special
L.bagAdd(s, 'longCloak', 3);
L.sortBag(s);
ok(s.meta.bag[0].id === 'thornMail', '特殊件排在基础件前');
ok(s.meta.bag[1].level === 3, '同 id 内等级高的在前');

// 连续填充：不同种类不独占一行（相同 id 必须相邻）
const ids = s.meta.bag.map((e) => e.id);
ok(ids.indexOf('longCloak') + 1 === ids.lastIndexOf('longCloak'), '同 id 相邻，不独占行');

// V11：页签过滤
ok(L.bagFilter(s.meta.bag, 'special').length === 1, '特殊页签只出特殊件');
ok(L.bagFilter(s.meta.bag, 'all').length === 3, '全部页签出所有件');
ok(L.bagFilter(s.meta.bag, 'weapon').length === 0, '空分类返回空数组而不是报错');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_bag.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

排序用 `Array.prototype.sort` 加明确的比较链；**由于 `sort` 在 V8 上已稳定**，四段比较写完即可保证「同 input 同 output」。`bagFilter` 的 `'special'` 分支判据是 `C.equipDef(e.id).kind === 'special'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_bag.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/logic.js tests/test_bag.js
git commit -m "feat(bag): 整理排序与分类页签过滤"
```

---

## Task 7: 背包 DOM 浮层（布局 / 网格 / 页签 / 拖动夹边）

**Files:**
- Create: `game/baghud.js`
- Modify: `game/index.html`（容器与样式）、`tests/browser/smoke.js`
- Test: `tests/browser/smoke.js`

**Interfaces:**
- Consumes: Task 2–6 的全部 `L.bag*` / `L.pageOf` / `L.bagFilter` / `L.sortBag`
- Produces:
  - `global.BagHud = { open(state, opts), close(), refresh(), isOpen() }`
  - `opts.onChange` —— 每次背包内容变化后由 `BagHud` 调用，宿主负责 `refreshHeroEquip`

- [ ] **Step 1: 写浏览器测试（V1、V2、V4）**

在 `tests/browser/smoke.js` 追加：

```js
// V1：Tab 打开背包
await page.keyboard.press('Tab');
const bagOn = await page.evaluate(() => document.getElementById('bag').className.indexOf('on') >= 0);
ok(bagOn, '按 Tab 打开背包');
// V2：拖动夹边（拖到极限后仍在画布内）
const clamped = await page.evaluate(() => {
  const el = document.getElementById('bag');
  el.style.left = '-9999px';
  window.BagHud.clamp();
  return parseFloat(el.style.left) >= 0;
});
ok(clamped, '面板被夹在画布内，拖不出去');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/browser/smoke.js`
Expected: FAIL —— `#bag` 不存在。

- [ ] **Step 3: 实现**

`index.html` 加 `#bag` 容器（标题栏 + 左右两栏），尺寸 **620×540**（960×600 的 ~40%），左栏 40% 宽、内部上 70% / 下 30%。`baghud.js` 负责：

- 网格：`cols = 5`、`rows = 7`，每格 **56×64**
- 贴图：从 Phaser 纹理取 `game.textures.get('eq-<slot>-<id>').source[0].image` → `toDataURL('image/png')`，**缓存进模块级 Map**，每件只转一次
- 拖动：`pointerdown/move/up` + `Math.max/Math.min` 夹边
- 页签 7 个，**只点击切换**（数字键被药水占用）

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/browser/smoke.js`
Expected: PASS（45 + 新增）。

- [ ] **Step 5: 提交**

```bash
git add game/baghud.js game/index.html tests/browser/smoke.js
git commit -m "feat(bag): 背包 DOM 浮层（网格/页签/拖动夹边/贴图缓存）"
```

---

## Task 8: 背包的穿戴、悬停、整理、出售、批量出售、分页 UI

**Files:**
- Modify: `game/baghud.js`、`game/app.js`（接线 `onChange`）
- Test: `tests/browser/smoke.js`

**Interfaces:**
- Consumes: Task 7 的 `BagHud`、Task 5 的 `sellItem`/`sellBatch`/`duplicateUids`/`sellableUids`、Task 6 的 `sortBag`/`bagFilter`、Task 4 的 `buyBagPage`
- Produces: 完整可用的背包界面

- [ ] **Step 1: 写测试（V3、V12、V13、V26–V29 的 UI 侧）**

```js
// V12/V13：暂停中卖出/换装后英雄图层必须更新（Review Focus #4）
// 先在页面里暴露一个计数器：app.js 的 refreshHeroEquip 每次调用 __refreshHeroCalls++
const before = await page.evaluate(() => window.__refreshHeroCalls);
await page.evaluate(() => window.BagHud.testSellFirst());   // 只用于测试的出口
const after = await page.evaluate(() => window.__refreshHeroCalls);
ok(after > before, '卖出后 refreshHeroEquip 被显式调用过（暂停时 update 不跑）');

// V12：换装后左栏数值立即变化。
// 注意不能用 >= —— 那对"数值根本没刷新""换装失败""读到同一个缓存值"全部成立。
// V12 原文要求的是"**上升**"，所以必须用一件**已知会提高攻击力**的武器，
// 并断言差额恰好等于该武器声明的伤害加成。
const atkBefore = await page.evaluate(() => window.BagHud.testReadStat('attack'));
const expectGain = await page.evaluate(() =>
  window.BagHud.testEquipStrongerWeapon());     // 返回该件声明的攻击加成
const atkAfter = await page.evaluate(() => window.BagHud.testReadStat('attack'));
ok(atkAfter > atkBefore, '换上更强武器后攻击数值严格上升（不是没刷新）');
ok(atkAfter - atkBefore === expectGain,
   '上升幅度等于该武器的攻击加成（不是巧合变绿）');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/browser/smoke.js`
Expected: FAIL —— `window.BagHud.testSellFirst` 不存在。

- [ ] **Step 3: 实现**

- **装备槽**：角色图左右各 5 个，顺序 `head/torso/back/weapon/feet`，用 `eq-<slot>-<id>` 贴图**缩小**显示
- **悬停**：显示名称/槽位/等级/效果/售价
- **右键出售**：确认条 → `L.sellItem` → toast；已穿戴的提示「先卸下才能卖」
- **批量出售**：选择态 + 三个快捷勾选 + 每 id 强制留一件 + 已穿戴灰掉 + 总价确认
- **分页**：`第 N/M 页` + `[◀][▶]` + `[+扩容]`
- **`onChange` 里必须显式调 `refreshHeroEquip`**（暂停时 `update` 不跑）

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/browser/smoke.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/baghud.js game/app.js tests/browser/smoke.js
git commit -m "feat(bag): 穿戴/悬停/出售/批量出售/分页交互"
```

---

## Task 9: 暂停（含 `Tab` 按键接入）

**Files:**
- Modify: `game/app.js:853-868`（`CODES`）、`game/app.js:874`（`preventDefault`）、`game/app.js:1530`（Hub）、`game/app.js:1627-1635`（Run）
- Test: `tests/browser/smoke.js`

**Interfaces:**
- Consumes: Task 8 的 `BagHud`
- Produces: `scene.pause()` / `scene.resume()` 成对封装；`CODES.Tab = 'bag'`

- [ ] **Step 1: 写测试（V1 的暂停侧、V21）**

```js
// 打开背包后角色坐标不再变化
await page.keyboard.press('Tab');
const p1 = await page.evaluate(() => window.__game.state.run.player.x);
await page.waitForTimeout(600);
const p2 = await page.evaluate(() => window.__game.state.run.player.x);
ok(p1 === p2, '背包打开时游戏暂停（模拟不推进）');
await page.keyboard.press('Tab');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/browser/smoke.js`
Expected: FAIL —— 坐标在变，说明仍每帧推进。

- [ ] **Step 3: 实现**

1. `CODES` 加 `Tab: 'bag'`
2. `onDown` 的 `preventDefault` 条件加 `ev.code === 'Tab'`（**不加会抢焦点，后续按键全失效**）
3. 两个场景都用 `this.scene.pause()` / `this.scene.resume()`，**成对**，关闭路径唯一化保证异常时也能恢复
4. `esc` 是**电平**不是边沿（`app.js:943`），菜单开关必须用 `justPressed('esc')`，否则长按会每帧重开

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/browser/smoke.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/app.js tests/browser/smoke.js
git commit -m "feat: Tab 打开背包并暂停（scene.pause 成对恢复）"
```

---

## Task 10: 兵器架改造 + 药水改名

**Files:**
- Modify: `game/config.js:220/227/234`（`POTIONS` 三个显示名）
- Modify: `game/index.html:238`（页脚图例）
- Modify: `game/hub.js:198` 一带（`zoneActions` 文案）、`game/app.js`（兵器架条目贴图）
- Test: `tests/test_game_logic.js`、`tests/browser/smoke.js:532-534`

**Interfaces:**
- Consumes: 无
- Produces: `POTIONS.heal.name === '治疗药水'`、`POTIONS.strength.name === '力量药水'`、`POTIONS.wall.name === '护盾药水'`；短名 `治疗`/`力量`/`护盾`。**id 保持 `heal`/`strength`/`wall` 不变。**

- [ ] **Step 1: 改写测试**

`tests/test_game_logic.js` 的断言全部改为新名；`tests/browser/smoke.js:534` 的 `indexOf('回春') >= 0` 改为 `indexOf('治疗') >= 0`（注释同步改）。

**完整的旧名残留清单（独立核验逐条实测，原稿严重漏列）**：

| 位置 | 内容 | 处理 |
|---|---|---|
| `config.js:210` / `:212` | 注释「回春 = 立刻回血」「坚壁 = 8 秒减伤」 | 改成新名 |
| `logic.js:156` | 注释「坚壁药有时管用有时不管用」 | 改成新名 |
| `hub.js:140` | 注释「坚壁药能减伤」 | 改成新名 |
| `app.js:907` | 注释「三瓶回春一次喝光」 | 改成新名 |
| `test_game_logic.js:986/1001/1005/1006/1012/1023/1027/1029/1046/1047/1122/1126/1157` | 断言消息里的旧名 | 改成新名 |
| `test_game_logic.js:1057` | `'按 3 喝坚壁药'` | **原稿漏列** |
| `test_game_logic.js:1135/1137` | `'坚壁药后…'` / `'坚壁药把 40 点伤害减半成 20'` | **原稿漏列** |
| `test_game_meta.js:219/220/227` | 三处含旧名 | **原稿完全漏列** |
| `smoke.js:236/526/528/532/534` | 五处（含 `药水栏有三个槽位（回春/力量/坚壁）`） | **原稿只列了 534** |

```js
ok(C.POTIONS.heal.name === '治疗药水', '治疗药水命名统一');
ok(C.POTIONS.heal.short === '治疗', '短名统一');
ok(C.POTION_ORDER.join(',') === 'heal,strength,wall', 'id 顺序不变（存档兼容）');
```

**V14：兵器架按钮文案三段变化（原稿没有这条断言，只在 Step 3 描述了口径）**

```js
// 逻辑层先给出"这个按钮现在该写什么"，UI 只负责渲染这个字符串。
// 这样文案变化可以在纯逻辑测试里断言，不必依赖浏览器。
const s = L.createState(31);
const rich = Object.assign({}, s, { meta: Object.assign({}, s.meta, { coins: 99999 }) });
H.ensureHub(rich);

const notOwned = H.zoneActions(rich, H.zoneById('forgewear'))
  .filter(function (a) { return a.payload && a.payload.id === 'hornHelm'; })[0];
ok(notOwned && notOwned.kind === 'equip-buy', '没买过时是"购买"');
ok(notOwned && notOwned.label && notOwned.label !== '卸掉', '没买过时不显示"卸掉"');

L.buyEquipment(rich, 'hornHelm');
const owned = H.zoneActions(rich, H.zoneById('forgewear'))
  .filter(function (a) { return a.payload && a.payload.id === 'hornHelm'; })[0];
ok(owned && owned.kind === 'equip-wear', '买过未穿时是"穿戴"');
ok(owned && owned.label === '穿戴', '按钮文案是"穿戴"（不再是"执行"）');

L.equipItem(rich, 'hornHelm');
const worn = H.zoneActions(rich, H.zoneById('forgewear'))
  .filter(function (a) { return a.payload && a.payload.id === 'hornHelm'; })[0];
ok(worn && worn.kind === 'equip-upgrade', '穿上后是"升级"这一档');
ok(worn && worn.label !== '穿戴', '穿上后不再显示"穿戴"');

// 卸掉：已穿戴的件必须有独立的"卸掉"入口，且穿上后按钮不再是"穿戴"
const actions = H.zoneActions(rich, H.zoneById('forgewear'));
const hasUnequip = actions.some(function (a) {
  return a.kind === 'equip-unequip' || (a.label || '') === '卸掉';
});
ok(hasUnequip, '已穿戴的件能看出怎么卸掉（文案"卸掉"或等价动作）');
```

> 若实现把「卸掉」放在背包面板而不是兵器架，**这条断言要跟着换成那个位置**——
> 但无论放哪，**"穿上之后存在一个可点到的卸下入口"必须有断言**，
> 否则 V14 描述的"执行→穿戴→卸掉"三段变化没有任何测试覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js && "$N" tests/browser/smoke.js`
Expected: FAIL —— 名字仍是旧的。

- [ ] **Step 3: 改配置与文案**

只改 `.name` / `.short`，**不碰 id**。同时改 `index.html:238` 的 `<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 喝药水（回春／力量／坚壁）` → `（治疗／力量／护盾）`。

兵器架：加页签 `全部/未拥有/已拥有/已穿戴/特殊`，每条显示贴图；按钮 `执行` → **`穿戴`**，已穿戴时变 **`卸掉`**。

> **全仓 grep 确认无旧名残留**：`grep -rn '回春\|坚壁' game/ tests/` 改完后必须**无输出**。
>
> 原稿把这条写成验收条件却不给完整清单，而实际残留有 **30+ 处**（见 Step 1 的表），
> 按原稿清单改完必然 FAIL。**上表就是这条验收条件的完整依据**：表里每一处都要改掉。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js && "$N" tests/browser/smoke.js`
Expected: PASS，且 `grep -rn '回春\|坚壁' game/ tests/` 无输出。把 grep 结果贴进 commit message 作为证据。

- [ ] **Step 5: 提交**

```bash
git add game/config.js game/hub.js game/app.js game/index.html tests/
git commit -m "feat: 药水统一为治疗/力量/护盾，兵器架加页签与穿戴/卸掉"
```

---

## Task 11: 基地错落布局 + 键帽提示

**Files:**
- Modify: `game/hub.js:32-45`（`ZONES` 加 `z`）、`game/hub.js:54-61`（`zoneAt` 改距离判定）
- Modify: `game/app.js:1340` 一带（按 `toScreen` 画）、`game/app.js:1550` 一带（**删提示文字**）、`game/app.js:1423`（删标签）
- **Modify: `tests/test_game_meta.js:103-127`（既有测试，必须同步改，否则本任务一定打红它）**
- Test: `tests/test_game_logic.js`（V16）、`tests/browser/smoke.js`（V17）

> **回归地雷（独立核验发现，最容易漏）**：`tests/test_game_meta.js:107-110`
> 现在是这样写的——
> ```js
> H.ZONES.forEach((z) => {
>   s.hub.x = z.x;                        // ← 只设了 x
>   eq(H.zoneAt(s).id, z.id, `站在「${z.name}」位置判定为该区域`);
> });
> ```
> 它**只设 `hub.x`，从不设 `hub.z`**，而 `hub.z` 保持默认 `HUB_D/2 ≈ 105`。
> `zoneAt` 一旦改成二维判定，`z = 34` 的那三个点位（anvil / shop / gate）
> 会算出 `|105 - 34| = 71` 的 z 向偏差，**永远命中不了**，这条既有测试直接变红。
> 同一节 `:115-127` 的"空隙检测"也把点位当一维处理，同样要改。
> Step 3 必须一并把这两处改成 `s.hub.x = z.x; s.hub.z = z.z;`，
> 并把空隙检测的 `leftEdge/rightEdge` 明确为**只在 x 轴上算**（x 轴仍留有间隙即可）。

**Interfaces:**
- Consumes: 无
- Produces: `ZONES` 每项新增 `z`；`zoneAt(state)` 改按屏幕距离判定。**`x` 值保持不变。**

> **先核实（原文写错了）**：`zoneAt` 在 **`game/hub.js:54`**，**不在 `logic.js`**，
> 导出名是 **`global.GameHub.zoneAt`**（`hub.js:294`）。
> 签名是 **`zoneAt(state)`——只收一个 `state`**，不是 `zoneAt(hub, x, z)`。
> 它内部先 `ensureHub(state)` 拿 `hub`，再读 `hub.x` / `hub.z`。
> 所以「改判定」改的是这个函数体，调用方一行都不用动。
> 目前的判定是 `Math.abs(hub.x - z.x) <= z.reach`——**一维对称容差**，
> 不是半径。改二维后 `reach` 的语义要重新定义（见 Step 3）。

| id | x | z |
|---|---|---|
| field | 100 | 0 |
| anvil | 265 | 34 |
| forgewear | 415 | 0 |
| shop | 565 | 34 |
| altar | 720 | 0 |
| gate | 880 | 17 |

- [ ] **Step 1: 写测试**

```js
// V16：错落后每个点位都还能走到并触发。
// 注意命名空间：zoneAt 属于 GameHub，不属于 GameLogic。
const H = require('../game/hub.js');
const s = L.createState(51);
const h = H.ensureHub(s);
[['field',100,0],['anvil',265,34],['forgewear',415,0],
 ['shop',565,34],['altar',720,0],['gate',880,17]].forEach(function (t) {
  h.x = t[1]; h.z = t[2];
  const z = H.zoneAt(s);
  ok(z && z.id === t[0], '站在 ' + t[0] + ' 的点位坐标上命中自己（实际 ' +
     (z ? z.id : 'null') + '）');
});

// 错落的关键回归：上排点位的 z 明显不同于下排，
// 且站在两个相邻点位中间时不能同时命中两个（zoneAt 只返回一个，
// 所以更该断言的是"没有误触发上排"）。
h.x = 265; h.z = 0;                    // 铁匠铺的 x，但用下排的 z
ok((H.zoneAt(s) || {}).id !== 'anvil', 'z 不对时不该命中上排点位');
h.x = 265; h.z = 34;                   // 正确 z
ok((H.zoneAt(s) || {}).id === 'anvil', 'z 正确时命中铁匠铺');
```

```js
// V17：提示文字已删除，键帽可见。
//
// ⚠️ 不能查 DOM：`this.prompt` 是 **Phaser 画布内的 Text 对象**（app.js:1436 创建），
// 不是 HTML 元素。`document.querySelector('#prompt')` 永远返回 null，
// 写成 `!el || ...` 就是**恒真空断言** —— 正好是上面注释里点名要防的写法。
// 必须用 Phaser 侧探针：
const promptState = await page.evaluate(() => {
  const hub = window.__game.scene.getScene('Hub');
  const p = hub && hub.prompt;
  return {
    exists: !!p,                       // 对象本身可以留着（省得删代码），但必须不可见
    visible: !!(p && p.visible),
    hasText: !!(p && p.text && p.text.length > 0),
    capVisible: !!hub.__keycapVisible, // 键帽此时应当可见
  };
});
ok(promptState.exists, '探针有效：改动前 prompt 对象确实存在（证明这条断言跑到了真东西）');
ok(!promptState.visible, '长提示文字已不再显示');
ok(!promptState.hasText || !promptState.visible, '不再向玩家展示「按 J · 点位名（提示）」长文案');
ok(promptState.capVisible, '同一时刻键帽是可见的（删提示不是把提示和键帽一起删了）');

// 键帽：靠近点位时必须出现，且是灰色底 + 黑色 J
const cap = await page.evaluate(() => {
  window.__game.hub.player.x = 265;      // 走到铁匠铺
  return new Promise((r) => setTimeout(() => r(window.__keycapVisible), 300));
});
ok(cap === true, '靠近点位时头顶右上方出现键帽');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL / 报 `zoneAt` 只有两个参数。

- [ ] **Step 3: 实现**

1. `ZONES` 加 `z`（表见上）
2. `zoneAt(state)`（`hub.js:54`）改成**屏幕距离**判定。注意 `hub.js` 是纯逻辑层，
   **不能调 `app.js` 的 `toScreen`**（那是渲染层函数）。两个选择，取前者：
   - **在 `hub.js` 里放一份等价的投影常量/小函数**（`Z_TO_Y` / `Z_SCALE` / `FIELD_D`
     本来就该是共享常量）；或
   - 把 `reach` 改成「x 与 z 各自一个容差」（`reachX` / `reachZ`）——
     最简单、无跨层依赖，**本计划采用这个**。
   判定写成 `Math.abs(hub.x - z.x) <= z.reachX && Math.abs(hub.z - z.z) <= z.reachZ`。
   `reachX` 沿用原 `reach` 值，`reachZ` 取约 40（够覆盖错落的 34 深度且不跨排误触）。
3. **绘制端必须同步改**：`app.js:1340` 目前把所有点位画在同一个固定 y 上，改为逐点 `toScreen(x, z, 0)`，并按 `sc` 缩放 —— **数据改了画面没改等于没做**
4. **既有测试同步改**（见上方"回归地雷"）：`tests/test_game_meta.js:107-110` 加 `s.hub.z = z.z;`；
   `:115-127` 的空隙检测确认只在 x 轴取中点，不受 `z` 影响。
4. **删掉**`app.js:1550` 一带的 `this.prompt.setText('按 J · ' + zone.name + '（' + zone.hint + '）')`
5. 画**灰色圆角键帽 + 黑色 `J`**（约 26×26）在角色**头顶右上方**，150ms 淡入淡出
6. 改完后**实测每个点位的 `reach`**：走到跟前能触发、隔一个人身位不误触发

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js && "$N" tests/browser/smoke.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/hub.js game/app.js tests/
git commit -m "feat(hub): 六点位上下错落（含判定与绘制同步），删提示文字改键帽"
```

---

## Task 12: 音效合成层（17 个）

**Files:**
- Create: `game/audio.js`
- Modify: `game/config.js`（加 `AUDIO` 参数）、`game/index.html`（音量按钮）、`game/app.js`（触发点接线）
- Test: `tests/test_audio.js`（**新建**）

**Interfaces:**
- Consumes: 无
- Produces:
  - `global.GameAudio = { play(name), setMasterVolume(v01), setMuted(bool), isMuted(), ensureStarted(), context }`
  - `AUDIO.volume` 默认 **0.30**
  - `context` **必须是自建 `AudioContext`**（**不是** `game.sound.context`，那是 `null`）
- **也必须在 `logic.js` 里建 `meta.settings`**（见下方警告）

> **会崩的缺口（独立核验发现）**：`createState` **今天没有 `meta.settings`**
> —— 全仓 `grep -n settings game/logic.js` 零命中（已实测）。
> 设计文档 §5.5 要求音量/静音持久化，而本任务与 Task 13 原本都没写"谁负责建这个字段"。
> 直接写 `state.meta.settings.volume = v` 会 **TypeError**。
> 补法（**放在 Task 2 的迁移块里一并做**，避免两个任务各改一次 `STATE_VERSION`）：
> - `createState`：`meta.settings = { volume: 0.30, muted: false }`
> - `migrate` 的 `s.version === 5 → 6` 块：`if (!s.meta.settings) s.meta.settings = { volume: 0.30, muted: false };`
> - 读写一律走 `state.meta.settings || (state.meta.settings = {...})` 兜底，别裸取。

- [ ] **Step 1: 写测试**

```js
global.AudioContext = function () {           // stub
  this.state = 'running'; this.currentTime = 0;
  this.destination = {}; this.created = [];
  this.createOscillator = () => { const o = { connect(){}, start(){ this.started = true; },
    stop(){}, frequency: { setValueAtTime(){}, exponentialRampToValueAtTime(){} },
    type: 'sine' }; this.created.push(o); return o; };
  this.createGain = () => ({ connect(){}, gain: { setValueAtTime(){},
    linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, value: 0 } });
  this.createBiquadFilter = () => ({ connect(){}, frequency:{setValueAtTime(){}}, Q:{} });
  this.createBufferSource = () => ({ connect(){}, start(){}, stop(){}, buffer: null });
  this.createBuffer = (c, l, r) => ({ getChannelData: () => new Float32Array(l) });
  this.resume = () => {};
};
const A = require('../game/audio.js');
const NAMES = ['slash','hit','crit','hurt','coin','seed','dropNew','dropDup',
  'potion','skill','special','upgrade','sell','bagOpen','wave','boss','death'];
// 注意：原稿写的是 `typeof A.play(n) === 'boolean' || true` —— `|| true` 让它恒真。
// 改成"捕获异常"，这样任何音效内部抛错都会被抓到。
NAMES.forEach(function (n) {
  let threw = null;
  try { A.play(n); } catch (e) { threw = e.message; }
  ok(threw === null, n + ' 可播放且不抛错' + (threw ? '（抛了：' + threw + '）' : ''));
});
// 断言"真的建了节点"，而不是断言"函数被调用过"。stub 的 AudioContext 里
// 记了每一次 createOscillator/createGain，数量为 0 说明 play() 是空函数。
ok(A.context && A.context.created && A.context.created.length > 0,
   '真的向 AudioContext 里建了音频节点（play 不是空函数）');
ok(A.context.state === 'running', '用的是自建 AudioContext 且已 resume');
// Phaser 的 game.sound.context 是 null（noAudio:true），
// 所以"没依赖它"表现为"我们的 ctx 不是那个 null"——直接断言非空即可，不必再写一条。
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_audio.js`
Expected: FAIL —— `Cannot find module '../game/audio.js'`。

- [ ] **Step 3: 实现**

- 模块级单例 `AudioContext`，**首次用户交互时创建/`resume()`**（自动播放策略要求在用户手势里启动）
- 17 个音效各一个合成函数（波形/频率/时长放 `config.js`，合成代码放 `audio.js`）
- 节点**用完即弃**（`stop()` 后交给 GC），不预建常驻音轨
- 静音 = `masterGain.gain = 0`，**不要** `ctx.close()`
- **25ms 节流**：同音效短时间重复触发要合并，否则连段攻击同帧堆三个音会爆音
- 音量/静音存入 `meta.settings`，跨会话保留

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_audio.js && "$N" tests/test_game_logic.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/audio.js game/config.js game/app.js game/index.html tests/test_audio.js
git commit -m "feat(audio): 自建 AudioContext 合成 17 个音效 + 音量控制"
```

---

## Task 13: ESC 菜单、设置滑块与退出战斗结算

**Files:**
- Modify: `game/index.html`（菜单 DOM）、`game/app.js`（开关逻辑）、`game/logic.js`（退出结算）、`game/config.js`
- Test: `tests/browser/smoke.js`（V20/V21/V23）、`tests/test_game_logic.js`（V22）

**Interfaces:**
- Consumes: Task 9 的暂停封装、Task 12 的 `GameAudio.setMasterVolume`
- Produces:
  - `exitRun(state) -> { ok, coins, hpRatio }` —— 按血量折扣结算
  - 菜单：战斗中两行 `设置` / `退出战斗`；基地只有 `设置`

- [ ] **Step 1: 写测试（V22）**

```js
const full = L.createState(61);
// 满血退出：保留 50%
const half = L.createState(62);
// 残血退出：保留 25%
ok(fullResult.coins > halfResult.coins, '满血退出拿到的铜币多于残血退出');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— `L.exitRun` 不存在。

- [ ] **Step 3: 实现**

- 菜单开关用 `justPressed('esc')`
- 打开菜单 `scene.pause()`
- 滑块：**圆形钮**，左端 0 右端 100，**左侧已扫过区域填充绿色**
- 音乐滑块先落地**但不接音源**（没有 BGM），**界面上必须写明**，否则玩家以为坏了
- 退出战斗 = **判定为失败**，保留当前铜币的一半（按血量折扣，满血 50% → 残血 25%）

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js && "$N" tests/browser/smoke.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/index.html game/app.js game/logic.js game/config.js tests/
git commit -m "feat: ESC 菜单（战斗中两行）、音量滑块、退出战斗按血量结算"
```

---

## Task 14: 攻击连段加长 5%

**Files:**
- Modify: `game/config.js:44-53`（`COMBO.steps`、`ATTACK_RANGE`、`ATTACK_DEPTH`、`ATTACK_BACK`）
- Test: `tests/test_game_logic.js`（V18）

**Interfaces:**
- Consumes: 无
- Produces: `COMBO.steps` 三段 `range` 由 `58/62/74` → **`61/66/78`**；`ATTACK_RANGE` 62 → **66**；`ATTACK_DEPTH` 52 → **55**；`ATTACK_BACK` 14 → **15**

> **数值必须先算一遍（原稿写错，会直接卡死 Step 4）**：
> `62 × 1.05 = 65.10`，所以第二段取 **65 不满足严格大于**，`测试` 永远绿不了。
> 正确的下界是「严格大于 ×1.05」：
>
> | 原值 | ×1.05 | 取整下界（严格大） | 本计划采用 |
> |---|---|---|---|
> | 58 | 60.90 | 61 | **61** ✓ |
> | 62 | 65.10 | **66** | **66** ✓ |
> | 74 | 77.70 | 78 | **78** ✓ |
>
> `ATTACK_RANGE` 与第二段同步取 **66**（它俩本是同一量纲的基准）。
> 若坚持用 65，就必须把断言从 `>` 降为 `>=` 并注明"取整后允许相等"——
> **本计划选择改数值、保留严格断言**，因为"每段都要比之前远"是需求原话。

- [ ] **Step 1: 写测试（V18，含 Review Focus 之外的自检）**

```js
const base = [58, 62, 74];
C.COMBO.steps.forEach(function (st, i) {
  ok(st.range > base[i] * 1.05, '第 ' + (i + 1) + ' 段 range 比原值大 5% 以上');
});
// 三段必须**单调递增**，否则"每段都更远"只是平均数上的假象。
for (let i = 1; i < C.COMBO.steps.length; i++) {
  ok(C.COMBO.steps[i].range > C.COMBO.steps[i - 1].range,
     '第 ' + (i + 1) + ' 段比第 ' + i + ' 段更远');
}
ok(C.ATTACK_RANGE > 62, '普攻基准射程也放大');
ok(C.ATTACK_DEPTH > 52 * 1.05, '纵深判定同比放大（否则侧面打不到）');
ok(C.ATTACK_BACK > 14 * 1.05, '身后判定同比放大');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— 三段都还是原值。

- [ ] **Step 3: 改配置**

**三段都要改**，不能只改 `ATTACK_RANGE`（那只影响第一段基准）。`ATTACK_DEPTH` 与 `ATTACK_BACK` 同比放大。

- [ ] **Step 4: 跑测试确认通过 + 经济漂移检查**

Run: `"$N" tests/test_game_logic.js && "$N" tests/test_game_logic.js && "$N" tests/bot.js 2>&1 | tail -20`
Expected: PASS。胜率阶梯与冻结基线对比，**任一档上升超过 8 个百分点视为经济变松**。

> **注意 1**：`tests/bot.js` 每局新建空背包存档、从不出售，所以它**测不出**本批的出售类经济变化。它的作用只是确认 +5% 没有把难度压垮。要做出售类护栏需先给 `play()` 加策略参数（设计文档 §6 已记录这条护栏被降级）。
>
> **注意 2（测量陷阱，已实测）**：难度 id 是 **`grass` / `wood` / `deep` / `forge`**，
> **没有 `hard`**。`C.difficultyById(id)` 用的是
> `DIFFICULTIES.find(...) || DIFFICULTIES[1]`（`config.js:571`）——
> 传错 id **不抛错，静默变成「林地」**。实测 `difficultyById('hard').id === 'wood'`。
> 后果：拿错 id 去跑 `winRate`，四档会返回**逐条种子完全一致**的结果，
> 看上去像"难度没生效"的引擎 bug，其实是调用方传错了名字。
> 写平衡脚本时先用 `console.log(C.difficultyById(d).id)` 回显一次。
>
> **基线形状（本轮实测，n=24，零强化）**：`grass 100% / wood 96% / deep 42% / forge 0%`，
> 与设计文档冻结的 `100/94/54/1`（n=100）在抽样误差内一致。

- [ ] **Step 5: 提交**

```bash
git add game/config.js tests/test_game_logic.js
git commit -m "feat: 攻击连段与判定范围整体加长 5%"
```

---

## Task 15: 全套回归与截图验证

**Files:**
- Test: 全部

**Interfaces:**
- Consumes: 前 14 个任务的全部产出
- Produces: 一份可提交的验证证据

- [ ] **Step 1: 跑全套测试**

```bash
N="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
"$N" tests/check_textures.js
"$N" tests/test_game_logic.js
"$N" tests/test_game_meta.js
"$N" tests/test_game_page.js
"$N" tests/test_bag.js
"$N" tests/test_audio.js
"$N" tests/browser/smoke.js
```
Expected: 全绿。断言总数应 ≥ **588 + 本批新增**。

- [ ] **Step 2: 截图验证**

**断言全绿 + 控制台干净仍然可能交付一个视觉上坏掉的页面** —— 这条在本项目真实发生过多次（Boss 尺寸、光环、漂浮、缺阴影、农场卡死都是截图才发现的）。

必须截图确认：
- 背包打开的样子（面板占比是否约 40%、网格是否是 5×7、格子里的贴图是否**看得出区别**）
- 每件装备的贴图不是同一个方块
- 基地六点位**画面上确有错落**（不是只有数据改了）
- 键帽出现在角色头顶右上方、灰色底 + 黑色 J
- ESC 菜单两行 / 一行
- 滑块：圆钮、左绿右空

- [ ] **Step 3: 检查存档兼容**

用 Task 2 的 v2 夹具手工确认：老存档导入不白屏。

- [ ] **Step 4: 提交验证证据**

```bash
git add -A
git commit -m "test: 全批回归（含截图验证与老存档兼容）"
```

---

## Self-Review

**1. Spec coverage** —— 逐节核对：

| 设计文档章节 | 对应任务 |
|---|---|
| §3.2 每件掉落都进背包 | Task 1 |
| §3.3 分页容量 plan A | Task 4 |
| §3.4 退出战斗结算 | Task 13 |
| §3.5 B1 条目数组 | Task 2 |
| §3.5 B2 退款记两次 | Task 1（两处都删） |
| §3.5 B3 战斗无暂停 | Task 9 |
| §3.5 B4 Tab 抢焦点 | Task 9 |
| §3.5 B5 贴图转 dataURL | Task 7 |
| §3.5 B6 卖价公式 | Task 5 |
| §3.5 B7 refundRatio 六处 | Task 1 |
| §3.5 B8 迁移 | Task 2 |
| §4.1 布局 | Task 7 |
| §4.2 拖动夹边 | Task 7 |
| §4.3 网格不堆叠 | Task 7 |
| §4.4 分类页签 | Task 6/7 |
| §4.5 整理 | Task 6 |
| §4.6 出售 | Task 5/8 |
| §4.6.1 批量出售 | Task 5/8 |
| §4.7 分页扩容 | Task 4/8 |
| §4.8 暂停（正确档） | Task 9 |
| §5.1 兵器架 | Task 10 |
| §5.2 药水改名 | Task 10 |
| §5.3 基地错落 | Task 11 |
| §5.4 键帽 | Task 11 |
| §5.5 音效 | Task 12 |
| §5.6 ESC 菜单 | Task 13 |
| §6 V18 攻击范围 | Task 14 |
| §6 V1–V29 | 分散在各任务（**V5/V14/V24 曾漏，已补，见下**） |
| §7 工作量 | 15 个任务，约 5.5 天 |

**首轮自称"无遗漏"，独立核验证明不成立。以下三条曾完全没有测试，现已补上：**

| 曾漏的验收项 | 原文要求 | 现在补在哪 |
|---|---|---|
| **V5** | 塞 36 件 → 第 1 页 35、第 2 页 1 | Task 4：断言两页各自的实际件数（原来只断言下标归属） |
| **V14** | 兵器架按钮：执行 → 穿戴 → 卸掉 | Task 10：`zoneActions` 三态文案断言 + 存在卸下入口 |
| **V24** | 音量/页数跨会话保留（序列化往返） | Task 4：`serialize`/`deserialize` 往返断言页数与背包内容 |

另有三条**恒真空断言**（写了但不可能失败，等于没测），已改为可失败：
`atkAfter >= atkBefore`（→ 严格上升 + 差额校验）、
`#prompt` 的 DOM 查询（Phaser 对象，恒 null → 改用 Phaser 侧探针）、
音频的 `|| true`（→ try/catch 捕获异常 + 断言真建了音频节点）。

**当前状态：V1–V29 每一项都有能真正失败的测试。**

**2. Step scan** —— 各步骤均为单一可验证动作。无「处理边界情况」这类空话；每个测试步骤都给了具体断言与数值。

**3. Type consistency** —— 已核对：`bagAdd` / `bagRemove` / `bagAt` / `bagCount` / `bagCapacity` / `bagIndexOfUid` / `sellValue` / `sellItem` / `sellBatch` / `sortBag` / `bagFilter` / `pageOf` / `pageSlice` / `buyBagPage` / `equipInvested` / `duplicateUids` / `sellableUids` 在定义任务与使用任务中**名称一致**。`rollEquipDrop` 的返回类型在 Task 1 定义（无 `refund`），后续任务未再引用该字段。

**4. Review Focus** —— 五条均已指派：

| Review Focus | 落在哪个测试 |
|---|---|
| #1 满格边界 | Task 4 Step 1（35 → 拒绝 → 扩容 → 36） |
| #2 六页全满 | Task 4 Step 1（第 7 页拒绝、容量 210） |
| #3 同 id 双份 | Task 3 Step 1（穿戴 + 背包同 id、指定 uid 升级） |
| #4 暂停中卖出后图层 | Task 8 Step 1（`__refreshHeroCalls > 0`） |
| #5 v2 老档链到 6 | Task 2 Step 1（`mig.meta.bagPages === 1`） |

**5. Proportion** —— 计划约 1090 行，设计文档约 785 行，比例约 **1.35:1**。偏长但在可接受范围：
多出的部分主要是**测试代码块**（74 个步骤里约一半是测试断言），而本项目
「先写失败测试」是硬纪律，测试必须写进计划。函数体只给了两处
（`rollEquipDrop` 与 `equipInvested`），这两处是**签名与测试都不足以确定实现**的。

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-11-12-backpack-audio-settings.md`。
