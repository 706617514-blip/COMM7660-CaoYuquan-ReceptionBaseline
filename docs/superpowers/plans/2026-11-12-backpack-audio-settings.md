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
- **`tests/browser/smoke.js` 不是 Playwright/Puppeteer。** 它没有 `page.evaluate` /
  `page.keyboard.press` / `page.waitForTimeout` —— 写了也只会 `ReferenceError`。真实结构是两段：
  - **页面内**（`tests/browser/smoke.js:108` 起的模板字符串 `SCRIPT`）：一个
    `(async function () { ... })()`，自带 `wait(ms)` 与 `key(t, code, kc)` 两个助手
    （`:111` / `:112`），所有观察结果写进 `out.xxx`，最后 `return out;`（`:438`）。
  - **Node 侧**（`:441` 起）：用 `ok(cond, label, detail)` 对 `r.xxx` 断言。
  - 读游戏状态用 `window.EmberfieldApp.__state`。**`window.__game` 是 `Phaser.Game`，
    `window.__game.state` 不存在**；场景用 `window.__game.scene.getScene('Hub')`。
  - 按键一律 `key('keydown', 'Tab', 9)` / `key('keyup', 'Tab', 9)`，不要用 `page.*`。

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
// 重复品仍然进库存，**不会**因为重复就被吞掉或折算。
//
// 注意两处顺序/命名陷阱（都踩过）：
//  1. 上面那个 5000 次的 warm-up 循环**每一次都在 push**，所以它结束时
//     inventory 已经被撑到 11 件。`invBefore` 必须在**重新播种之后**取，
//     否则拿到的是 11，`invBefore + 1` 就是 12，断言必挂。
//  2. 是 `meta.inventory.lastIndexOf`，**不是** `meta.lastIndexOf` ——
//     `meta` 是普通对象，写成后者会 `TypeError`，整个套件在汇总前就崩掉。
const seeded = Object.keys(C.ALL_EQUIPMENT)
  .filter(function (i) { return C.ALL_EQUIPMENT[i].kind === 'base'; });   // 全部已拥有
dupState.meta.inventory = seeded.slice();
const invBefore = dupState.meta.inventory.length;        // === 21，此刻才取
const dupProbe = L.rollEquipDrop(dupState);
ok(dupProbe && dupProbe.duplicate === true, '全拥有时掉落判定为重复');
// 重复品"没被吞掉"的唯一含义就是库存**增长**：
// 全 21 件已拥有 → 再掉一件 → 22。
// 原稿写 === 21 是退款时代的残留（那时重复分支不 push，21 才成立）。
ok(dupState.meta.inventory.length === invBefore + 1, '重复品进了库存（没被吞掉）');
ok(dupState.meta.inventory.length === 22, '正好多一件（21 件已拥有 + 1 件重复掉落）');
ok(dupState.meta.inventory.lastIndexOf(dupProbe.id) === dupState.meta.inventory.length - 1,
   '新增的那一件就是刚落下的 id（不是别处凭空多出来的）');
ok(dupState.meta.coins === 0, '重复品不再产生任何铜币');

// 注：`meta.inventory` 在 Task 2 会整体迁移成 `meta.bag` 条目数组。
// 本任务断言的是"refund 已消失、重复品不消失"，**不依赖 Task 2 的模型**；
// Task 2 完成后这三条会跟着迁移（Task 2 的测试负责覆盖 bag 版本）。
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— 仍是旧行为：`refundRatio` 存在、重复品折算铜币、`rollEquipDrop` 返回里带 `refund`。
（**不应出现 `TypeError`**：本任务的断言只用 `meta.inventory`/`meta.coins`，
不依赖 Task 2 才引入的 `meta.bag`。）

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
Expected: **全部通过**。断言数会变化（删掉 2 条退款断言、新增 3 条重复品断言），
实际数字记在 implementer 的报告里；Task 15 会核对总数。

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
- Modify: `tests/test_game_meta.js`（**实施时补记**：`tests/test_game_meta.js:349-350` 直接断言
  `s.meta.inventory.indexOf(...)` 与 `s.meta.inventoryLevels.leatherHelm`；
  删掉这两个字段后该文件必抛 `TypeError`，Meta 套件整份变红。
  原 Files 列表漏列，已补上，改读 `s.meta.bag` 条目数组，断言数仍为 110）

**Interfaces:**
- Consumes: Task 1 的 `rollEquipDrop`
- Produces:
  - `meta.bag: Array<{ id: string, level: number, uid: string }>`（`uid` 见下方说明）
  - `meta.bagPages: number`（默认 1）
  - `bagAdd(state, id, level) -> number`（返回落位下标）
  - `bagRemove(state, index) -> { ok: boolean, reason?: string }`
  - `bagAt(state, index) -> { id, level } | null`
  - `bagCount(state) -> number`
  - `bagCapacity(state) -> number`（= `bagPages × 35`）
  - `bagIndexOfUid(state, uid) -> number`
  - `bagEntry(state, id, level) -> { id, level, uid }`（**内部辅助**：生成一个带新 uid 的条目）
  - `nextUid(state) -> string`（**内部辅助**：`id + '#' + 自增数`；计数器挂在 `state.meta` 上，随存档走）

> **`uid` 怎么生成（原稿只用了没定义，必须补）**：`bagEntry(state, id, level)`
> 造条目并分配 uid；`nextUid(state)` 是它内部用的计数器。
> ```js
> function nextUid(state) {
>   const n = (state.meta.uidSeq || 0) + 1;
>   state.meta.uidSeq = n;
>   return 'u' + n;
> }
> ```
> 关键是：
> 1. **同一存档内绝不重复**；
> 2. **跨序列化保留**（计数器存 `meta.uidSeq`，否则读档后新条目会撞旧 uid）；
> 3. `bagEntry(state, id, level)` = `{ id: id, level: level || 1, uid: nextUid(state) }`
>    （**必须带 `state`**：uid 计数器存在 `state.meta` 上）
>
> `createState` 里加 `uidSeq: 0`。

- **也产出** `meta.settings = { volume: 0.30, muted: false }`（Task 12 的音效层要用；
  `createState` 今天没有这个字段，所以由本任务的迁移块一并创建）
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
  state.meta.bag[last] = bagEntry(state, id, 1);
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

> **实施时补记（两个必踩的坑）**：
> 1. brief 原样的红阶段代码会在 `eq(m5.meta.bag.length, 2, ...)` 抛
>    `TypeError: Cannot read properties of undefined (reading 'length')`，
>    套件在打印汇总**之前**就崩，看不到失败清单。必须加守卫：
>    `typeof L.bagAdd === 'function'` / `const bag = m5.meta.bag || []`。
>    brief 自己在 Step 3 要求"不能是 TypeError"，示例代码却没满足它。
> 2. brief 里的 `const v2` / `const v5` 与 `tests/test_game_logic.js:333` 起的
>    既有 fixture **同名**，原样粘贴直接 `SyntaxError: Identifier 'v2' has already been declared`。
>    改用 `v2s` / `v5s`。

测试要断言 `L.createState(1).meta.settings.volume === 0.30`，
以及老档迁移后 `settings` 存在（否则 Task 12 一读就 TypeError）。

`STATE_VERSION = 6`。`createState` 里 `meta.bag = []`、`meta.bagPages = 1`、`meta.uidSeq = 0`，删 `inventory`/`inventoryLevels`。

> **实施时补记**：只断言 `mig.version === L.STATE_VERSION` 是**空转断言**——
> 忘了递增版本号时它照样绿（两边都是 5）。必须再加一条把常量钉死：
> `eq(L.STATE_VERSION, 6, 'STATE_VERSION 升到 6')`。

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
    s.meta.bag.push(bagEntry(s, id, oldLv[id] || 1));
  });
  delete s.meta.inventory;
  delete s.meta.inventoryLevels;
  s.meta.bagPages = 1;
  s.version = 6;
}
```

同时**删掉** `deserialize` 末尾兜底块里的这两行（实测位置 **`game/logic.js:1653-1654`**）：

```js
if (!s.meta.inventory) s.meta.inventory = [];
if (!s.meta.inventoryLevels) s.meta.inventoryLevels = {};
```

改为：

```js
if (!s.meta.bag) s.meta.bag = [];
if (!s.meta.bagPages) s.meta.bagPages = 1;
```

（兜底仍然不能替代迁移，只是防止 v6 存档缺字段。**注意顺序**：兜底块在 `if (s.version !== STATE_VERSION) throw` **之后**，所以版本对不上时根本走不到这里 —— 迁移链必须自己把 v5 抬到 v6，光靠兜底是白屏。）

`bagAdd` 必须**尊重页容量**，满了返回 `-1`：

```js
function bagAdd(state, id, level) {
  if (state.meta.bag.length >= bagCapacity(state)) return -1;
  state.meta.bag.push(bagEntry(state, id, level || 1));
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

## Task 3: 装备函数接受可选 `uid`（同 id 多件时指哪一件）

> **本任务的范围已按 Task 2 的实测**收窄**。** 原稿让本任务把六个函数从
> `meta.inventory` 改到条目数组——**这部分 Task 2 已经做完了**（Task 2 的 diff 里
> `equipOwned:476`、`buyEquipment:492`、`equipItem:508`、`unequipSlot:538`、
> `equipUpgradeCost:555`、`upgradeEquipment:581` 全部已按 `bag` 条目读写，
> Task 2 的 435 项断言已覆盖）。
> 本任务**只剩一件事**：给 `equipItem`/`equipUpgradeCost`/`upgradeEquipment`
> 加上可选第三参 `uid`，修掉"同 id 多件时永远只作用第一件"的错位。

**Files:**
- Modify: `game/logic.js:508`（`equipItem`）、`game/logic.js:555`（`equipUpgradeCost`）、`game/logic.js:581`（`upgradeEquipment`）
- Test: `tests/test_game_logic.js`

**Interfaces:**
- Consumes: Task 2 的 `bagAdd`/`bagRemove`/`bagAt`/`bagIndexOfUid`/`bagIndexOfId`
- Produces:
  - `equipItem(state, id, uid?)` —— 有 `uid` 时穿指定的那一件，否则穿第一件同 id 条目
  - `equipUpgradeCost(state, id, uid?)` —— 有 `uid` 时按那条目报价，否则按第一条同 id 条目
  - `upgradeEquipment(state, id, uid?)` —— 同上，写回**对应条目**的 level
  - `equipOwned(state, id)` **签名不变**（Task 2 已改好，本任务不动）

> **实测的悬空缺陷（Task 2 交付后我复现）**：
> ```
> bag = [longCloak@1 (u1), longCloak@3 (u2)]
> equipUpgradeCost(s,'longCloak')      -> 290     // 按 @1 报价，不是 @3
> upgradeEquipment(s,'longCloak')      -> 升的是 u1，@3 那件纹丝不动
> upgradeEquipment(s2,'longCloak', uidB) -> [2,1]  // uid 被整个忽略，仍升第一件
> ```
> 玩家在 UI 上点的是 `u2`（3 级那件），却被升了 `u1`，且按 1 级报价——**白付钱、升错件**。
> `bagIndexOfUid`/`bagAt` 已在 Task 2 就位，本任务只做接线。

- [ ] **Step 1: 写测试（覆盖 Review Focus #3）**

```js
// 背包里两件同 id：不带 uid 作用于第一件，带 uid 作用于指定的那件
const s2 = L.createState(12);
L.bagAdd(s2, 'longCloak', 1);
L.bagAdd(s2, 'longCloak', 1);
s2.meta.coins = 99999;
const uidB = s2.meta.bag[1].uid;
ok(s2.meta.bag[0].level === 1 && s2.meta.bag[1].level === 1, '初始两件都是 Lv1');
L.upgradeEquipment(s2, 'longCloak', uidB);
ok(s2.meta.bag[0].level === 1, '没有 uid 的那件没被动过');
ok(s2.meta.bag[1].level === 2, '指定 uid 的那件被升级');

// 报价也要按 uid 指定的那件算，否则玩家会被按错件收费。
// **必须用满级 >=4 的装备**：longCloak 满级只有 3，Lv3 是满级，
// equipUpgradeCost 正确返回 null，拿它断言"4 级的价"永远不可能成立（实测）。
// bloodCharm 是背部特效件，满级 5（实测 equipMaxLevel=5、equipPrice(bloodCharm,4)=2439）。
const s3 = L.createState(13);
L.bagAdd(s3, 'bloodCharm', 1);
L.bagAdd(s3, 'bloodCharm', 3);
s3.meta.coins = 99999;
const uidHi = s3.meta.bag[1].uid;
const costHi = L.equipUpgradeCost(s3, 'bloodCharm', uidHi);
const costLo = L.equipUpgradeCost(s3, 'bloodCharm');
ok(costHi !== costLo, '按 uid 与不按 uid 的报价不同（等级不同，价就不同）');
ok(costHi === C.equipPrice('bloodCharm', 4), '按 Lv3 那件报价 = 下一级(4)的价');
ok(costLo === C.equipPrice('bloodCharm', 2), '不带 uid 按第一件(Lv1)报价 = 2 级的价');

// 穿戴也要能指定：穿背包里第 2 件，且穿走的是它的等级。
// **等级不能超过满级**（longCloak 满级 3），否则是在断言一个当时不可能存在的状态。
const s4 = L.createState(14);
L.bagAdd(s4, 'longCloak', 1);
L.bagAdd(s4, 'longCloak', 3);
const uidWear = s4.meta.bag[1].uid;
L.equipItem(s4, 'longCloak', uidWear);
eq(s4.meta.equipment.back.level, 3, '穿上的是 uid 指定那件（等级 3 = 满级）');
eq(s4.meta.bag[0].level, 1, '另一件留在背包里，等级没变');

// 三处判定都不能选错：已穿戴优先于背包（Review Focus #3）
// **必须给铜币**：createState 默认 coins = 0，而 longCloak 售价 200，
// 不给钱 buyEquipment 会返回 {ok:false, reason:'铜币不够'}，
// equipOwned 停在 'owned'，断言会因无关原因失败（实测）。
const s5 = L.createState(15);
s5.meta.coins = 99999;
L.buyEquipment(s5, 'longCloak');
L.equipItem(s5, 'longCloak');
L.bagAdd(s5, 'longCloak', 5);
ok(L.equipOwned(s5, 'longCloak') === 'equipped', '已穿戴优先');
ok(s5.meta.bag.length === 1 && s5.meta.bag[0].level === 5, '背包里那件仍是 Lv5');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js`
Expected: FAIL —— 实测当前 `L.upgradeEquipment(s2,'longCloak',uidB)` 得 `[2,1]`
（uid 被忽略，升的是第一件），故"没有 uid 的那件没被动过"必须失败。
`equipUpgradeCost` 的第三参目前也不存在，两件等级不同时报价必然相同。

> **注意**：Task 2 已完成存储层改造，所以**不要**再期待
> `meta.inventory`/`meta.bag` 相关的失败——那些断言现在就是绿的。

- [ ] **Step 3: 给三个函数接上 `uid`**

- `equipItem(state, id, uid)`：删条目时优先用 `bagIndexOfUid(state, uid)`，
  `uid` 缺省或找不到才退回 `bagIndexOfId(state, id)`；新装备的 `level` 取**被删条目的 level**。
- `equipUpgradeCost(state, id, uid)`：等级来源改为「`uid` 指定条目，否则 `bag` 里第一个同 id 条目」。
- `upgradeEquipment(state, id, uid)`：透传 `uid` 给 `equipUpgradeCost`，并写回**同一条目**的 level。

> **关键**：`equipUpgradeCost` 与 `upgradeEquipment` **必须一起改**，只改其中一个会让
> 报价与实收价对不上（玩家按 A 件的价付钱、B 件被升级）。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_game_logic.js`
Expected: PASS（断言数 ≥ 435 + 本任务新增）。

- [ ] **Step 5: 提交**

```bash
git add game/logic.js tests/test_game_logic.js
git commit -m "refactor(bag): 装备函数接受可选 uid（同 id 多件时指哪一件）"
```

---

## Task 4: 分页、容量与扩容

**Files:**
- Modify: `game/config.js`（加 `BAG`）
- Modify: `game/logic.js`（`bagCapacity` 已存在于 Task 2；加 `buyBagPage`、`rollBagPage`；
  **另修 `buyEquipment:497` / `unequipSlot:544` 的满包静默吞件**；
  **并把 `bagIndexOfId` 加进 `API` 导出**）
- Modify: `game/hub.js:190`（**仍读已删除的 `inventoryLevels`**，见下）
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
- Consumes: Task 2 的 `bagAdd`/`bagCapacity`；**实测 `bagIndexOfId` 尚未导出**（见下）
- Produces:
  - `C.BAG = { cols: 5, rows: 7, cellsPerPage: 35, maxPages: 6, pagePrices: [0, 200, 500, 1000, 2000, 5000] }`
  - `buyBagPage(state) -> { ok: boolean, reason?: string, cost?: number }`
  - `pageOf(state, index) -> number`（0 基）
  - `pageSlice(state, page) -> Array<{ id, level, uid }>`（不足 35 格补 `null`）
  - 修好后的 `buyEquipment(state,id)` / `unequipSlot(state,slot)` / `rollEquipDrop(state)`

**前置修复（Task 2 复审实测，我复现确认 —— 先做这些再做分页）**

**⓪ 预检（实测 2026-11-12，`require` 后逐项 `typeof`）**：本任务开始时
`bagAdd`/`bagRemove`/`bagAt`/`bagCount`/`bagCapacity`/`bagIndexOfUid`/`bagEntry`/`nextUid`
均为 `function`，但 **`bagIndexOfId` 是 `undefined`**（已定义在 `logic.js:465`，只是没进 `API` 导出块），
`buyBagPage`/`pageOf`/`pageSlice` 均不存在，`C.BAG` 为 `undefined` —— 全部由本任务补上。

**① `game/hub.js:190` 读已删除的字段。**
`const lv = (state.meta.inventoryLevels || {})[id] || 1;` 里的 `inventoryLevels` 已被
Task 2 删除，于是**任何背包里的装备在兵器架上都显示 Lv.1**。实测：背包里放一件
`leatherHelm` Lv.3，`H.zoneActions(s,'forgewear')` 返回
`equip-wear | 皮盔 | 头部 · Lv.1 · 生命上限 +12` —— 等级显示错，**且没有任何断言覆盖**。
改为从 `meta.bag` 里按 id 找条目读 `level`（`bagIndexOfId` 已在 Task 2 就位）。

**② `bagAdd` 满包返回 `-1`，但除 `rollEquipDrop` 外所有调用者都忽略返回值。**

| 路径 | 实测行为 | 危害 |
|---|---|---|
| `buyEquipment`（`logic.js:497`） | 满包时**照扣 190 铜币**、返回 `{ok:true}`、`equipOwned` 仍为 `null` | 可无限重复，纯铜币黑洞 |
| `unequipSlot`（`logic.js:544`） | 满包时返回 **`{ok:true}`**、部位清空、装备**消失** | **谎报成功 + 丢装备** |
| 最后一格覆盖（`bagFull` 路径） | 覆盖已有真实装备，且丢失**跨序列化仍存活** | 玩家白掉的装备找不回来 |

三者都违反设计 §4.7「不丢装备」。修法一致：**满包时拒绝动作，不要销毁**。
- `buyEquipment`：`bagAdd` 返回 `-1` → 不扣钱，返回 `{ok:false, reason:'背包已满'}`。
- `unequipSlot`：`bagAdd` 返回 `-1` → 不清空部位，返回 `{ok:false, reason:'背包已满'}`。
- `rollEquipDrop` 的 `bagFull` 覆盖路径**保留**（掉落不该阻塞战斗），但必须在
  `run.equipDrops` 里带上 `overwrote` 字段，让 UI 能提示"覆盖了哪一件"，
  并加断言证明被覆盖的那件确实是从"最后一格"里选出来的（不是随机删一件）。

> **✅ 本研究已完成（Task 4 + 追加修复 `9bd9a46`）** —— 保留此段作为"为什么会漏"的记录：
> `rollEquipDrop` 的返回值确实带上了 `overwrote`（实测满包返回
> `{"id":"broadSword","duplicate":false,"bagFull":true,"overwrote":{"id":"strawShoes","uid":"u35","level":1}}`，
> 且末格 uid 由 `u35` 变 `u36`，指向正确），**但传送通道没改**：
> `game/logic.js:1417` 仍然只推 `run.equipDrops.push({ id: drop.id, duplicate: drop.duplicate })`，
> 于是 `'overwrote' in run.equipDrops[0] === false`，UI（`game/app.js:1665-1669`）
> 只会印「已进背包」。玩家的一件装备被覆盖掉了，却没有任何提示能说出被覆盖的是哪一件 ——
> 正是本段要消除的那种"静默丢件"。
> **两处都要改**：`logic.js:1417` 的 push 形状带上 `overwrote: drop.overwrote || null`，
> 且必须有一条断言覆盖**通道**（不能只断言 `rollEquipDrop` 的返回值 ——
> 那样接线缺陷完全隐形，Task 4 就是这么漏过去的）。

> **✅ 已修（`9bd9a46`）** —— `buyBagPage` 与 `deserialize` 两处都已规整 `bagPages`。
> 保留记录如下：
> `game/logic.js:415-416` 只把 `cellsPerPage` 单点化，`maxPages`(:473) 与
> `pagePrices[bagPages]`(:475) 都不设防。实测 `bagPages = 1.5` → 容量 52.5、
> `buyBagPage` 返回 `{ok:true, pages:2.5}` 且 **`coins` 变 `NaN`**，序列化往返后仍是 2.5。
> **这比"需手改存档"更严重：存档码是玩家可达的注入入口。** 实测字符串
> `"bagPages":"abc"` 能原样往返（`deserialize` 不校验），随后 `pagePrices['abc']` → `undefined`。
> 修法：在 `buyBagPage` 与 `deserialize` 两处把 `bagPages` 规整为
> `Math.min(Math.max(1, Math.floor(Number(v) || 1)), C.BAG.maxPages)`，并加断言。

- [ ] **Step 1: 写测试（覆盖 Review Focus #1、#2）**

> **两条实测警示（Task 4 实施者测量、我复现确认）**
>
> **① `bagAdd` 不校验 id —— 写错 id 会静默造出无效条目。**
> 本步骤原稿用 `bagAdd(..., 'grassShoes', 1)` 填满 35 格，但实测
> `C.equipDef('grassShoes') === null`，35 件全是垃圾数据；测试照样"通过"，
> 因为它只数长度。**正确 id 是 `strawShoes`（草鞋，tier 0，价 80）。**
> 这类错误的可怕之处就在于长这样：套件全绿、什么都没验证。
> 任何时候用 `bagAdd` 造测试数据，先 `C.equipDef(id)` 确认非 null。
>
> **② `createState` 的初始铜币实测为 0。**
> 本步骤原稿断言连买 6 页 cost 为 200/500/1000/2000/5000（合计 8700 铜币），
> 但 0 铜币下 `buyBagPage` 返回 `{ok:false,reason:'铜币不够'}` —— **没有 `cost` 字段**，
> `cost === 200` 会以"铜币不够"这个错误理由失败。必须显式 `s.meta.coins = 100000`。
> 同时补一条「199 铜币（差 1 枚）→ ok:false、不扣钱、不加页」的边界断言，
> 让定价与拒绝两条路径都有覆盖。

```js
// 满包时不许静默吞装备（Task 2 复审实测的三个缺陷）
const full = L.createState(41);
full.meta.bagPages = 1;
while (full.meta.bag.length < 35) L.bagAdd(full, 'strawShoes', 1)  // 不是 grassShoes：该 id 不存在，见下方警示;
full.meta.coins = 99999;
const coinsBefore = full.meta.coins;
const buyFull = L.buyEquipment(full, 'ironHelm');
ok(buyFull.ok === false, '满包时买装备被拒绝，不是假成功');
eq(full.meta.coins, coinsBefore, '满包买失败不扣钱（不能是铜币黑洞）');
ok(L.equipOwned(full, 'ironHelm') === null, '没付钱也没拿到装备');

const wearer = L.createState(42);
wearer.meta.equipment.head = { id: 'ironHelm', level: 1 };
while (wearer.meta.bag.length < 35) L.bagAdd(wearer, 'strawShoes', 1);
const un = L.unequipSlot(wearer, 'head');
ok(un.ok === false, '满包时卸下被拒绝，不是谎报 success');
ok(wearer.meta.equipment.head && wearer.meta.equipment.head.id === 'ironHelm',
   '卸下失败时装备还穿在身上（不能凭空消失）');
```

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
s2.meta.coins = 100000;  // ⚠ 必须显式给钱：createState 的初始铜币实测为 0
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

**先做「前置修复」①②，再做分页。**

**① `game/hub.js:190`**：`(state.meta.inventoryLevels || {})[id] || 1` → 从 `meta.bag` 按 id 取条目读 `level`：
```js
const bi = bagIndexOfId(state, id);
const lv = bi >= 0 ? (state.meta.bag[bi].level || 1) : 1;
```
（**实测：`bagIndexOfId` 定义在 `game/logic.js:465`，但 Task 2 的 `API` 导出块里只有
`bagAdd, bagRemove, bagAt, bagCount, bagCapacity, bagIndexOfUid, bagEntry, nextUid` ——
**没有 `bagIndexOfId`**。本任务必须把它加进导出，否则 `hub.js` 拿不到。）

**② `game/logic.js` 三个满包静默吞件**：
- `buyEquipment`（`:497`）：`if (bagAdd(state, id, 1) === -1) return { ok: false, reason: '背包已满' };`
  ——**必须在扣钱之前判定**，否则钱扣了、件没了。
- `unequipSlot`（`:544`）：`bagAdd` 返回 `-1` 时**不要清空 `equipment[slot]`**，
  直接 `return { ok: false, reason: '背包已满' }`。
- `rollEquipDrop`（`:622`）的 `bagFull` 覆盖路径保留，但返回值加 `overwrote`（被覆盖那件的 `id`/`uid`），
  并在 `run.equipDrops` 里带出去。

**③ 分页**：`config.js` 加 `BAG`（值见 Interfaces）。`logic.js` 加 `buyBagPage`
（校验 `bagPages < maxPages` 与铜币，按 `pagePrices[bagPages]` 收费，成功后 `bagPages += 1`）
与 `pageOf`/`pageSlice`。

> **页价索引**：`pagePrices = [0, 200, 500, 1000, 2000, 5000]` 对应「从第 N 页扩到第 N+1 页」的价格，所以买页 2 用 `pagePrices[1]`。
> `bagPages` 的合法值是 **1..6**，买第 7 页要返回 `ok:false`（不是静默截断到 6）。

- [ ] **Step 4: 跑测试确认通过**

Run: `"$N" tests/test_bag.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add game/config.js game/logic.js game/hub.js tests/test_bag.js .github/workflows/ci.yml
git commit -m "feat(bag): 分页容量 5x7、最多 6 页、逐页涨价扩容；满包不再静默吞件"
```

> **`git add` 必须点名这 5 个文件**：`game/hub.js`（前置修复①）、
> `.github/workflows/ci.yml`（否则新测试在 CI 里永不运行）。
> 这是 Task 2 踩过的坑——Files 列表漏了 `tests/test_game_meta.js`，
> 差点把"绿测试的坏构建"提交上去。

---

## Task 5: 卖价、单件出售、批量出售

> **Task 3 复审带入的 UI 缺口（reviewer f43c23f2，Important）**
> Task 3 让 `equipItem`/`equipUpgradeCost`/`upgradeEquipment` 接受可选 `uid`，
> 但玩家路径根本走不到：`game/hub.js:195` 的 `payload: { id: id, slot: slot }` **没有 uid**，
> 于是 `hub.js:247`（`equip-wear`）与 `:248`（`equip-upgrade`）只传 `payload.id`，
> 背包里有两件同 id 时永远作用第一件。**三参修复目前在 UI 上不可达。**
> 本任务及后续 Task 7/8 涉及装备动作时必须让 payload 带上 `uid`，
> 并在 `app.js` → `H.perform` 的调用链里透传下去。
> 同一处还要注意：`hub.js:181` 的报价与 `:183` 的 kind 判定**必须与穿戴/升级成对改动**，
> 只改一边会让「报价按 A、扣费按 B」分叉。

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
// ⚠ 注意：`sellItem(s, 已穿戴的uid).ok === false` 是**恒真断言**，证明不了规则——
//   因为穿戴时该条目已从 meta.bag 移除（实测 bagIndexOfUid 返回 -1、bag 变空），
//   sellItem 找不到 uid 自然失败，与"已穿戴"毫无关系。
//   要证明的其实是：卖光同 id 的背包件之后，身上那件**必须还在**。
const s = L.createState(31);
s.meta.coins = 99999;
L.buyEquipment(s, 'longCloak');
L.equipItem(s, 'longCloak', s.meta.bag[0].uid);
const wornUidBefore = JSON.stringify(s.meta.equipment.back);
L.bagAdd(s, 'longCloak', 1);
L.bagAdd(s, 'longCloak', 1);
const n0 = s.meta.bag.length;
const rSell = L.sellBatch(s, L.sellableUids(s));
ok(rSell.ok === true, '批量出售成功');
ok(JSON.stringify(s.meta.equipment.back) === wornUidBefore,
   '身上那件装备卖不掉，卖完还在（不能连穿着的都卖掉）');
ok(s.meta.bag.length < n0,
   '背包件确实被卖掉了一些（否则上一条是空转）');
ok(L.sellableUids(s).indexOf(s.meta.equipment.back.uid) === -1,
   'sellableUids 不包含已穿戴条目');
ok(L.sellItem(s, 'u-not-exist').ok === false, '不存在的 uid 出售失败');

// V26：每 id 强制保留 1 件，全选也不清空
const s2 = L.createState(32);
L.bagAdd(s2, 'longCloak', 1);
L.bagAdd(s2, 'longCloak', 3);
s2.meta.coins = 0;
const r = L.sellBatch(s2, L.sellableUids(s2));
ok(r.count === 1, '两件同 id 只卖掉一件');
ok(s2.meta.bag.length === 1, '强制保留一件');
ok(s2.meta.bag[0].level === 3, '保留的是等级最高的那件');

// V28：总价 = 逐件求和（不是单价 × 件数）
// ⚠ 每个 id 必须放**两件**。V26 的「每 id 强制留一件」意味着 sellableUids
//   只返回「除最高等级那件以外」的条目；若每个 id 只有一件，两件都是"该留的
//   那件"，sellableUids 返回空数组，sellBatch 得 count 0 / total 0 ——
//   期望的 345 恒不可能成立（实测：duplicateUids []、sellableUids []）。
//   这里改的是 fixture，不是放宽断言：要证明的「逐件求和」完全保留。
const s3 = L.createState(33);
L.bagAdd(s3, 'longCloak', 1);
L.bagAdd(s3, 'longCloak', 1);
L.bagAdd(s3, 'windBoots', 2);
L.bagAdd(s3, 'windBoots', 2);
const r3 = L.sellBatch(s3, L.sellableUids(s3));
ok(r3.count === 2, '两个 id 各卖掉一件（各留一件）');
ok(r3.total === L.sellValue('longCloak', 1) + L.sellValue('windBoots', 2), '总价逐件求和');
// 反证：若实现偷懒用「首件单价 × 件数」，总数会是 200 而不是 345
ok(r3.total !== L.sellValue('longCloak', 1) * 2, '总价不是「单价 × 件数」');
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

> **为什么用 `equipPrice` 求和，而不是 `equipUpgradeCost` 加总**（实测校准，原批注理由说错了）：
> 两者**数值上恰好相等** —— `equipUpgradeCost(state,'longCloak')` 在 Lv1 时报 290，
> 升到 Lv2 后报 421，而 `equipPrice('longCloak',2)=290`、`equipPrice('longCloak',3)=421`，
> 即 `equipUpgradeCost` 本身就是「升到该级的单价」，两者和为 711 = `equipInvested(longCloak,3)`。
> 真正该避免的是**在循环里调 `equipUpgradeCost`**：它需要 `state`、会随状态变化
> （已穿戴时读身上那件的等级）、且满级返回 `null`（`null + n` 变 NaN）。
> `equipInvested(id, level)` 是纯函数，只依赖 id 与等级，**必须这样写**，不要绕 `state`。

**`sellItem(state, uid)` 的四种语义（都要有断言）**：
1. uid 在背包 → 卖出，`{ ok:true, value }`，`meta.coins += value`，从 `meta.bag` 移除。
2. uid 不存在 → `{ ok:false, reason }`，**不动铜币**。
3. uid 指向已穿戴 → 理论上不可达（穿戴即离包），但要防御：返回 `{ ok:false }`。
4. **该 id 是背包里仅剩的一件**（不穿在身上）→ 允许卖，卖完背包里就没有这个 id 了。
   规则「每 id 至少留一件」**只作用于 `sellBatch`**，单件出售是玩家明确点击的结果，不该被拦。
   这条必须有断言，否则实现者容易把「留一件」错写进 `sellItem`，导致单件也卖不掉。

**`duplicateUids(state)`**：返回「同 id 有多件时，除等级最高那件外其余」的 uid 列表。
同 id 只有一件时不出现在结果里。等级相同时保留 `meta.bag` 里**下标靠前**那件（稳定、可复现）。

**`sellableUids(state)`**：`meta.bag` 里除「每 id 等级最高那件」外的所有 uid ——
即「全选」卖出去之后每个 id 还剩一件。**注意这与 `duplicateUids` 等价**，
实现时让一个调用另一个，别写两套分组逻辑（两份必然分叉）。

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

// 「不同种类不独占一行」= 相同 id 必须挨在一起。
// ⚠ 不要写成 `ids.indexOf(X) + 1 === ids.lastIndexOf(X)` —— 实测该表达式
//   **等价于「恰好出现两次且相邻」**，对数量敏感：只出现一次时为 false
//   （会把正确实现判失败），三件同 id 时也为 false。要断言的是"分组连续"，
//   与出现几次无关，所以写成「对每个 id，其首次与末次出现之间不含别的 id」：
const ids = s.meta.bag.map((e) => e.id);
const grouped = ids.every((id) => {
  const seg = ids.slice(ids.indexOf(id), ids.lastIndexOf(id) + 1);
  return seg.every((x) => x === id);
});
ok(grouped === true, '同 id 的元素连续挨在一起，不被别的装备隔开（不独占行）');
ok(ids.indexOf('longCloak') >= 0 && ids.filter((x) => x === 'longCloak').length >= 2,
   '前提成立：确实有两件 longCloak，否则上一条是空转');

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

⚠ **必须同时把 `sortBag` / `bagFilter` 加进 `game/logic.js` 末尾的 API 导出块**
（`module.exports = API` 那段，Task 4 时 `bagIndexOfId` 就是漏在这）
—— 否则测试里 `L.sortBag` 是 `undefined`，红阶段能过、绿阶段永远过不了。

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
  - `global.BagHud = { open(state, opts), close(), refresh(), isOpen(), clamp() }`
    （`clamp()` 把面板位置夹回可见范围，拖动与测试都用它）
  - `opts.onChange` —— 每次背包内容变化后由 `BagHud` 调用，宿主负责 `refreshHeroEquip`

- [ ] **Step 1: 写浏览器测试（V2、V4）**

**本任务不测 Tab。** `CODES` 里还没有 `Tab`（那是 Task 9 的接线），所以这里只能用
公开 API `BagHud.open()` 打开面板。把「按 Tab 打开」留给 Task 9，否则本任务永远绿不了。

**（A）页面内** —— 追加到 `SCRIPT` 的 IIFE 里、`return out;` 之前：

```js
  // ---- 背包面板（V2 / V4）----
  // ⚠️ 必须用守卫：实现之前 `window.BagHud` 是 undefined，裸调会抛异常，
  //    驱动把它当成 {error} 直接中止整个脚本 —— 45 条既有断言全部消失，
  //    看起来像"游戏全线崩了"，实际只是新功能还没写。
  const bagEl = () => document.getElementById('bag');
  out.bagExists = !!bagEl();
  out.bagApiExists = !!(window.BagHud && typeof window.BagHud.open === 'function');
  const stBag = window.EmberfieldApp.__state;
  if (out.bagApiExists) {
    window.BagHud.open(stBag);
    await wait(300);
    out.bagOpen = window.BagHud.isOpen();
    out.bagDisplayed = !!(bagEl() && getComputedStyle(bagEl()).display !== 'none');
  }

  // V2：推到屏幕外，clamp() 之后必须回到可见范围
  if (out.bagApiExists && bagEl()) {
    bagEl().style.left = '-9999px';
    bagEl().style.top = '-9999px';
    window.BagHud.clamp();
    out.bagLeft = parseFloat(bagEl().style.left);
    out.bagTop = parseFloat(bagEl().style.top);
    out.bagW = bagEl().offsetWidth;
    out.bagH = bagEl().offsetHeight;
    out.viewW = window.innerWidth;
    out.viewH = window.innerHeight;
    // 只夹左上角是不够的：右下角同样会跑出屏幕，两个角都要验
    out.bagEndsWithinView =
      (out.bagLeft + out.bagW <= out.viewW) && (out.bagTop + out.bagH <= out.viewH);
  }

  // V4：第一页 5 列 × 7 行
  out.bagCells = document.querySelectorAll('#bag .cell').length;
```

**（B）Node 侧** —— 追加到既有断言序列末尾：

```js
console.log('\n--- 背包面板（V2 / V4）---');
ok(r.bagExists === true, '#bag 容器存在');
ok(r.bagApiExists === true, 'window.BagHud.open 是可调用函数（API 已接上）');
ok(r.bagOpen === true, 'BagHud.open() 后面板处于打开态');
ok(r.bagDisplayed === true, '面板真的显示出来了（不是只有 className）');
ok(typeof r.bagLeft === 'number' && r.bagLeft >= 0 && r.bagLeft <= r.viewW - 40,
   '夹边后 left 在可视范围内', r.bagLeft);
ok(typeof r.bagTop === 'number' && r.bagTop >= 0 && r.bagTop <= r.viewH - 40,
   '夹边后 top 在可视范围内', r.bagTop);
ok(r.bagW > 0 && r.bagH > 0, '面板有真实尺寸', r.bagW + 'x' + r.bagH);
ok(r.bagEndsWithinView === true, '面板右下角也不越界');
ok(r.bagCells === 35, '第一页 5×7 = 35 格', r.bagCells);
```


- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/browser/smoke.js`
Expected: FAIL —— `#bag` 不存在。

- [ ] **Step 3: 实现**

`index.html` 加 `#bag` 容器（标题栏 + 左右两栏），尺寸 **620×540**（960×600 的 ~40%），左栏 40% 宽、内部上 70% / 下 30%。`baghud.js` 负责：

- 网格：`cols = 5`、`rows = 7`，每格 **56×64**。
  **空槽位也要渲染**（始终 35 个 `.cell`，空格画成暗色凹槽）——
  否则 `#bag .cell` 的数量会随背包内容变化，测试与玩家都无法判断"还剩几格"。
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

**不引入测试专用出口**（不要在 `baghud.js` 里加 `testSellFirst()` 这类只为测试存在的函数）。
断言一律读**玩家真能看到的东西**：英雄容器的图层贴图键、左栏显示的数字、网格格子数、tooltip 文案。

**Review Focus #4 的机制在本任务就已成立**：`game/app.js:1530` 是 `if (this.panelOpen) return;`
—— 面板一开，Hub 的 `update` 直接早退，`refreshHeroEquip` 不会被跑到，英雄贴图就停在旧样子。
Task 9 加上 `scene.pause()` 后是同一个毛病的第二种触发方式，所以这里先测「面板开着的换装」。

**（A）页面内** —— 追加到 `SCRIPT` 的 IIFE 里、`return out;` 之前：

```js
  // ---- 背包交互（V3 / V12 / V13）----
  const stI = window.EmberfieldApp.__state;
  const Lg = window.GameLogic;
  const hubI = window.__game.scene.getScene('Hub');
  // 英雄装备图层挂在 container 的 layers_ 上（app.js:101-115 的 refreshHeroEquip 就改它），
  // 不要去遍历 hero.list 猜——直接读那一层，最准。
  const heroLayerKeys = (slot) => {
    const img = hubI.hero && hubI.hero.layers_ && hubI.hero.layers_[slot];
    return img && img.visible && img.texture ? img.texture.key : '';
  };
  stI.meta.coins = 99999;

  // V13：面板开着时换装，英雄图层必须真的换（不是等 update）
  const wId = 'twinBlades';
  if (Lg.equipOwned(stI, wId) === null) Lg.buyEquipment(stI, wId);
  window.BagHud.open(stI);
  await wait(250);
  out.heroWeaponBefore = heroLayerKeys('weapon');
  out.dmgBefore = Lg.playerStats(stI).damage;      // ← 必须在 equipItem 之前取
  const wUid = (stI.meta.bag.filter((e) => e.id === wId)[0] || {}).uid;
  out.equipResult = Lg.equipItem(stI, wId, wUid);
  window.BagHud.refresh();
  await wait(300);
  out.heroWeaponAfter = heroLayerKeys('weapon');

  // V12：左栏数值必须严格上升，且差额等于该件声明的加成（不能用 >=）
  out.dmgGainDeclared = window.GameConfig.equipDef(wId).mods.damage;
  out.dmgAfter = Lg.playerStats(stI).damage;

  // V3：悬停显示信息
  const cell0 = document.querySelector('#bag .cell');
  if (cell0) {
    cell0.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await wait(150);
    const tip = document.getElementById('bag-tip');
    out.tipVisible = !!(tip && getComputedStyle(tip).display !== 'none' && tip.textContent.trim().length > 0);
    out.tipText = tip ? tip.textContent.trim().slice(0, 40) : null;
    cell0.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
  }

  // V26–V29 UI 侧：批量出售入口存在、空选时确认按钮禁用
  out.batchBtn = !!document.querySelector('#bag [data-act="batch-sell"]');
  out.sortBtn = !!document.querySelector('#bag [data-act="sort"]');
  const bb = document.querySelector('#bag [data-act="batch-sell"]');
  if (bb) {
    bb.click();
    await wait(200);
    const confirm = document.querySelector('#bag .confirm-ok');
    out.batchConfirmDisabledWhenEmpty = !!(confirm && confirm.disabled);
  }
```

**（B）Node 侧**：

```js
console.log('\n--- 背包交互（V3 / V12 / V13 / V26–V29）---');
ok(r.equipResult && r.equipResult.ok === true, '穿戴成功', JSON.stringify(r.equipResult));
ok(typeof r.heroWeaponBefore === 'string', '能读到英雄的武器图层（探针有效）');
ok(r.heroWeaponAfter === 'eq-weapon-twinBlades',
   '面板开着换装后英雄图层真的换成新武器', r.heroWeaponAfter);
ok(r.heroWeaponAfter !== r.heroWeaponBefore,
   '图层确实变了，不是同一张', r.heroWeaponBefore + ' -> ' + r.heroWeaponAfter);
ok(typeof r.dmgGainDeclared === 'number' && r.dmgGainDeclared > 0,
   '该武器声明的加成是正数', r.dmgGainDeclared);
ok(r.dmgAfter - r.dmgBefore === r.dmgGainDeclared,
   '伤害上升幅度恰好等于武器加成（不是巧合变绿）',
   r.dmgBefore + ' + ' + r.dmgGainDeclared + ' vs ' + r.dmgAfter);
ok(r.tipVisible === true, '悬停出现物品信息', r.tipText);
ok(r.tipText && r.tipText.length > 0, '提示里有文字（不是空框）', r.tipText);
ok(r.sortBtn === true, '有「整理」按钮');
ok(r.batchBtn === true, '有「批量出售」按钮');
ok(r.batchConfirmDisabledWhenEmpty === true, '没勾选任何东西时确认按钮是禁用的');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/browser/smoke.js`
Expected: FAIL —— `window.BagHud.refresh is not a function`（Task 7 只做了 open/close/isOpen/clamp），
或 `#bag .cell` 的交互断言拿不到 tooltip。

- [ ] **Step 3: 实现**

- **装备槽**：角色图左右各 5 个，顺序 `head/torso/back/weapon/feet`，用 `eq-<slot>-<id>` 贴图**缩小**显示
- **悬停**：显示名称/槽位/等级/效果/售价
- **右键出售**：确认条 → `L.sellItem` → toast；已穿戴的提示「先卸下才能卖」
- **批量出售**：选择态 + 三个快捷勾选 + 每 id 强制留一件 + 已穿戴灰掉 + 总价确认
- **分页**：`第 N/M 页` + `[◀][▶]` + `[+扩容]`
- **`onChange` 里必须显式调 `refreshHeroEquip`**（暂停时 `update` 不跑）

**DOM 契约（测试直接按这些选择器断言，实现必须照此命名，不得自创）**：

| 选择器 | 含义 |
|---|---|
| `#bag .cell` | 每一格（空槽也算一格，永远 35 个） |
| `#bag .cell img` | 该格装备的贴图（空格无 img） |
| `#bag-tip` | 悬停信息浮层；`display:none` 表示未显示，`textContent` 是文案 |
| `#bag [data-act="sort"]` | 「整理」按钮 |
| `#bag [data-act="batch-sell"]` | 「批量出售」按钮 |
| `#bag .confirm-ok` | 批量出售确认对话框的确认按钮；无勾选时 `disabled === true` |
| `#bag [data-page="prev"]` / `[data-page="next"]` | 翻页 |
| `#bag [data-act="expand"]` | 「+扩容」 |

悬停事件绑在 `.cell` 上、监听 **`pointerover` / `pointerout`**（测试用 `new MouseEvent('pointerover', {bubbles:true})` 触发，所以必须冒泡可达，不要把监听器挂在非冒泡的自定义事件上）。

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

- [ ] **Step 1: 写测试（V1 的键盘侧、V21）**

两条断言必须成对出现，否则「位置没变」有两种平凡解释：**按键根本没生效**、**玩家本来就不会动**。
所以要配一条反证：关掉背包后同样的按键**必须**让位置变化。

**（A）页面内** —— 追加到 `SCRIPT` 的 IIFE 里、`return out;` 之前：

```js
  // ---- Tab 打开背包 + 暂停（V1 / V21）----
  const stP = window.EmberfieldApp.__state;
  const hubP = window.__game.scene.getScene('Hub');
  window.BagHud.close();              // 从关闭态开始，保证 Tab 真的从无到有
  stP.hub.x = 300; stP.hub.z = 105;   // 放在空地，避免撞到点位边界
  await wait(350);
  out.pauseClosedBefore = window.BagHud.isOpen();

  key('keydown', 'Tab', 9); await wait(90); key('keyup', 'Tab', 9);
  await wait(350);
  out.pauseOpenedByTab = window.BagHud.isOpen();
  out.pauseScenePaused = hubP.scene.isPaused();

  const x0 = stP.hub.x;
  key('keydown', 'KeyD', 68); await wait(700); key('keyup', 'KeyD', 68);
  await wait(120);
  out.pauseXBefore = x0;
  out.pauseXWhileOpen = stP.hub.x;

  // 关掉背包，同样的按键必须能动 —— 证明上一条的「不动」是暂停造成的
  key('keydown', 'Tab', 9); await wait(90); key('keyup', 'Tab', 9);
  await wait(350);
  out.pauseClosedAfter = window.BagHud.isOpen();
  out.pauseSceneResumed = !hubP.scene.isPaused();
  const x1 = stP.hub.x;
  key('keydown', 'KeyD', 68); await wait(700); key('keyup', 'KeyD', 68);
  await wait(120);
  out.pauseXBeforeReopen = x1;
  out.pauseXAfterClose = stP.hub.x;

  // Tab 默认会把焦点移到下一个控件，必须被 preventDefault 吃掉
  let defaultPrevented = false;
  const probe = (e) => { defaultPrevented = e.defaultPrevented; };
  window.addEventListener('keydown', probe);
  key('keydown', 'Tab', 9); await wait(60); key('keyup', 'Tab', 9);
  window.removeEventListener('keydown', probe);
  out.tabDefaultPrevented = defaultPrevented;
  await wait(250);
  window.BagHud.close();
```

**（B）Node 侧**：

```js
console.log('\n--- Tab 打开背包 + 暂停（V1 / V21）---');
ok(r.pauseClosedBefore === false, '起始态背包是关着的（否则下面测不到 Tab）');
ok(r.pauseOpenedByTab === true, '按 Tab 打开背包');
ok(r.pauseScenePaused === true, '背包打开时 Hub 场景真的 pause 了');
ok(r.pauseXWhileOpen === r.pauseXBefore,
   '暂停期间按住 D 位置不变', r.pauseXBefore + ' -> ' + r.pauseXWhileOpen);
ok(r.pauseClosedAfter === false, '再按 Tab 关闭背包');
ok(r.pauseSceneResumed === true, '关闭后场景恢复运行（pause/resume 成对）');
ok(r.pauseXAfterClose > r.pauseXBeforeReopen + 5,
   '关闭后同样按 D 位置真的变了（反证：上一条不是按键失效）',
   r.pauseXBeforeReopen + ' -> ' + r.pauseXAfterClose);
ok(r.tabDefaultPrevented === true, 'Tab 的浏览器默认行为被 preventDefault 拦掉');
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

> **两处原稿错误，已实测（`game/hub.js:89`）**：
> 1. `zoneActions(state, zoneId)` 的第二个参数是**字符串 id**，不是 zone 对象 ——
>    传 `H.zoneById('forgewear')` 会静默返回空数组（实测 `[]`，不报错），
>    于是原稿的每条断言都因 `notOwned` 是 `undefined` 而失败，且失败理由看起来像"功能没做"。
> 2. `a.label` 是**物品名**（`角盔`），**不是按钮文案**。按钮文案现在由
>    `game/index.html:445-447` 的内联阶梯决定（`挑战` / `出发` / `执行` / 价格）——
>    逻辑层根本拿不到它，所以原稿的 `owned.label === '穿戴'` 永远不可能成立。
>
> 修法：给每个 action 增加一个 **`verb` 字段**（按钮上写的动作词），
> UI 优先渲染 `a.verb`，`verb` 缺失时退回现有阶梯（不影响 boss「挑战」/ 远征「出发」）。

```js
const s = L.createState(31);
s.meta.coins = 99999;
H.ensureHub(s);
const pick = function (state, id) {
  return H.zoneActions(state, 'forgewear')
    .filter(function (a) { return a.payload && a.payload.id === id; });
};

// 未买：购买
const before = pick(s, 'hornHelm')[0];
ok(before && before.kind === 'equip-buy', '没买过时 kind 是 equip-buy（买）', before && before.kind);
ok(before && before.verb === '购买', '按钮文案"购买"', before && before.verb);
ok(before && before.label === '角盔', 'label 仍是物品名，不被挪用成按钮文案', before && before.label);

// 已买未穿：穿戴（不再是"执行"）
L.buyEquipment(s, 'hornHelm');
const owned = pick(s, 'hornHelm')[0];
ok(owned && owned.kind === 'equip-wear', '买过未穿时 kind 是 equip-wear', owned && owned.kind);
ok(owned && owned.verb === '穿戴', '按钮文案是"穿戴"（不是"执行"）', owned && owned.verb);

// 已穿：出现"卸掉"，且升级入口仍在（两个动作）
L.equipItem(s, 'hornHelm');
const worn = pick(s, 'hornHelm');
ok(worn.length === 2, '穿上后有两个动作：升级 + 卸掉', JSON.stringify(worn.map(function (a) { return a.verb; })));
const upg = worn.filter(function (a) { return a.kind === 'equip-upgrade'; })[0];
const uneq = worn.filter(function (a) { return a.kind === 'equip-unequip'; })[0];
ok(!!upg, '升级入口没丢（否则玩家无法强化已穿戴的装备）');
ok(!!uneq, '有"卸掉"入口');
ok(uneq && uneq.verb === '卸掉', '卸掉的按钮文案是"卸掉"', uneq && uneq.verb);
ok(uneq && uneq.cost === 0, '卸掉不收费', uneq && uneq.cost);
ok(upg && upg.verb === '升级', '升级的按钮文案是"升级"', upg && upg.verb);
ok(upg && typeof upg.cost === 'number' && upg.cost > 0, '升级带价格', upg && upg.cost);

// 卸掉之后回到"穿戴"
H.perform(s, uneq);
const afterUneq = pick(s, 'hornHelm')[0];
ok(afterUneq && afterUneq.kind === 'equip-wear', '卸掉后回到 equip-wear', afterUneq && afterUneq.kind);
```

> **口径变更（记入 ledger，需要 PM 醒来确认）**：用户原话是「穿上后按钮变卸掉」。
> 但若按钮**只能**是卸掉，升级就没了入口（现有 UI 正是靠这个按钮升级）。
> 这里采用「已穿戴的件给两个动作：`升级` + `卸掉`」，既满足"看得见卸掉"，也不丢功能。

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js && "$N" tests/browser/smoke.js`
Expected: FAIL —— 名字仍是旧的。

- [ ] **Step 3: 改配置与文案**

只改 `.name` / `.short`，**不碰 id**。同时改 `index.html:238` 的 `<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 喝药水（回春／力量／坚壁）` → `（治疗／力量／护盾）`。

兵器架：加页签 `全部/未拥有/已拥有/已穿戴/特殊`，每条显示贴图；按钮 `执行` → **`穿戴`**，已穿戴时变 **`卸掉`**。

**实现契约（照着写，测试已按此断言）**：

1. **每个 action 增加 `verb` 字段**（按钮上写的动作词）：
   `equip-buy → '购买'`、`equip-wear → '穿戴'`、`equip-upgrade → '升级'`、`equip-unequip → '卸掉'`、
   `equip-owned → '切换'`。**`label` 保持物品名不变**，不要把它挪用成按钮文案。
2. **已穿戴的件要出两个动作**（顺序：升级在前、卸掉在后）：
   ```js
   // hub.js 现有的 equip-upgrade 分支后面补一条：
   out.push({ kind: 'equip-unequip', label: def.name, verb: '卸掉', cost: 0,
              enabled: true, payload: { id: id, slot: def.slot, uid: uid } });
   ```
3. **`payload` 必须带 `uid`**（`hub.js:195` 现在是 `{ id, slot }`）。Task 3 给
   `equipItem` / `equipUpgradeCost` / `upgradeEquipment` 加了第三个可选 `uid` 参数，
   但 UI 侧一直没传，**所以那条修复从玩家路径根本不可达**（Task 3 复审实测）。
   本次一并接上：`payload: { id: id, slot: slot, uid: bagEntryUid }`。
4. **`perform` 增加分支**：`if (action.kind === 'equip-unequip') return L.unequipSlot(state, action.payload.slot);`
5. **`game/index.html:445-447` 的按钮文案阶梯改为优先用 `a.verb`**：
   ```js
   btn.textContent = a.verb ? a.verb
     : (isBoss ? '挑战' : (a.kind === 'run' ? '出发'
       : ((a.cost === null || a.cost === undefined || a.cost === 0) ? '执行' : a.cost)));
   ```
   —— 这样 boss「挑战」、远征「出发」等既有文案完全不受影响，只有显式给了 `verb` 的装备行变化。
6. **页签过滤**：`zoneActions` 接受可选第三参 `filter`（`'all' | 'unowned' | 'owned' | 'worn' | 'special'`），
   或在 `index.html` 侧过滤。二选一，但**必须有至少一条断言证明「未拥有」页签真的只剩没买的件**。

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
// 必须用 Phaser 侧探针。另外本仓库没有 Playwright，代码要分页面内/Node 侧两段写。
```

**（A）页面内** —— 追加到 `SCRIPT` 的 IIFE 里、`return out;` 之前：

```js
  // ---- 基地错落 + 键帽（V16 现场 / V17）----
  const stZ = window.EmberfieldApp.__state;
  const hubZ = window.__game.scene.getScene('Hub');
  const promptOf = () => {
    const p = hubZ && hubZ.prompt;
    return { exists: !!p, visible: !!(p && p.visible), hasText: !!(p && p.text && p.text.length > 0) };
  };

  // 远处：不应有任何提示或键帽
  stZ.hub.x = 500; stZ.hub.z = 105;
  await wait(500);
  out.farPrompt = promptOf();
  out.farCap = !!hubZ.__keycapVisible;

  // 铁匠铺（x=265, z=34）
  stZ.hub.x = 265; stZ.hub.z = 34;
  await wait(600);
  out.nearPrompt = promptOf();
  out.nearCap = !!hubZ.__keycapVisible;
  out.nearZoneId = (window.GameHub.zoneAt(stZ) || {}).id;

  // 每个点位都走一遍：靠近各命中、且不是别人
  out.zoneHits = [];
  for (const z of window.GameHub.ZONES) {
    stZ.hub.x = z.x; stZ.hub.z = z.z;
    await wait(160);
    out.zoneHits.push({ want: z.id, got: (window.GameHub.zoneAt(stZ) || {}).id });
  }
```

**（B）Node 侧**：

```js
console.log('\n--- 基地错落 + 键帽（V16 / V17）---');
ok(r.farPrompt && r.farPrompt.exists === true, '探针有效：prompt 对象确实存在（证明断言跑到真东西）');
ok(r.farPrompt && r.farPrompt.visible === false, '远离点位时没有长提示文案');
ok(r.farCap === false, '远离点位时没有键帽');
ok(r.farPrompt && r.farPrompt.hasText === false, '长文案「按 J · 点位（提示）」已不再写入');
ok(r.nearZoneId === 'anvil', '站在铁匠铺坐标命中 anvil', r.nearZoneId);
ok(r.nearCap === true, '靠近点位时头顶右上方出现键帽');
ok(r.nearPrompt && r.nearPrompt.visible === false, '靠近时也不再显示长提示文字（已删除）');
ok(Array.isArray(r.zoneHits) && r.zoneHits.length === 6, '6 个点位全部走了一遍', r.zoneHits && r.zoneHits.length);
ok((r.zoneHits || []).every((h) => h.got === h.want),
   '错落后每个点位仍各自命中自己（没有相互误触）',
   JSON.stringify((r.zoneHits || []).filter((h) => h.got !== h.want)));
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

- [ ] **Step 1: 写测试（V22 逻辑侧 + V20/V21/V23 浏览器侧）**

结算公式（设计文档 §3.4，**已批准，不要自行改**）：
`保留率 = 0.5 × (0.5 + 0.5 × 血量比)`，即满血 50%、空血 25%。取整用 `Math.round`。

**（A）逻辑侧** —— 追加到 `tests/test_bag.js`（或 `tests/test_game_logic.js` 末尾，二选一，两处都用已有的 `ok`/`eq` 助手）：

```js
// V22：退出战斗按血量结算
function runWithCoins(seed, coins, hpRatio) {
  const st = L.createState(seed);
  L.startRun(st, 'grass');
  st.run.loot.coins = coins;
  st.run.player.hp = Math.max(1, Math.round(st.run.player.maxHp * hpRatio));
  return st;
}
const sFull = runWithCoins(61, 1000, 1.0);
const rFull = L.exitRun(sFull);
ok(rFull.ok === true, '满血可以退出战斗');
ok(rFull.coins === 500, '满血退出保留 50%（1000 -> 500）', rFull.coins);
ok(sFull.meta.coins === 500, '结算真的进了存档铜币', sFull.meta.coins);

const sLow = runWithCoins(62, 1000, 0.0);
sLow.run.player.hp = 1;                     // 接近空血（活着退出，hp=0 应算死亡不结算）
const rLow = L.exitRun(sLow);
// 期望值按 maxHp=70、hp=1 实算：0.5×(0.5+0.5×1/70)=0.25357 → 254
// 不写死常数：只要落在 25% 附近且严格小于满血即可
ok(rLow.coins >= 245 && rLow.coins <= 260,
   '残血退出保留约 25%（1000 -> 约 254）', rLow.coins);
ok(rLow.coins < rFull.coins, '早退拿到的铜币一定少于满血退出', rLow.coins + ' < ' + rFull.coins);

// 已结束的对局不能再结算一次（防止刷币）
const again = L.exitRun(sFull);
ok(again.ok === false, '对局已结束，重复退出被拒绝', JSON.stringify(again));
ok(sFull.meta.coins === 500, '重复退出没有再发一次铜币', sFull.meta.coins);
```

> 这条刻意**不用等号**：`maxHp` 会随装备变化（这里是空装备的 70），
> 写死 254 会在以后平衡性调整时莫名其妙变红。断言的是「接近 25%、且严格低于满血退出」。

**（B）页面内** —— 追加到 `SCRIPT` 的 IIFE 里、`return out;` 之前：

```js
  // ---- ESC 菜单 / 设置滑块 / 退出战斗（V20 / V21 / V23）----
  const stE = window.EmberfieldApp.__state;
  const hubE = window.__game.scene.getScene('Hub');
  const escEl = () => document.getElementById('esc');

  // 基地里按 ESC：只有一行「设置」
  window.BagHud.close();
  stE.phase = 'hub';
  key('keydown', 'Escape', 27); await wait(80); key('keyup', 'Escape', 27);
  await wait(350);
  out.escOpenInHub = !!(escEl() && getComputedStyle(escEl()).display !== 'none');
  out.hubRows = escEl() ? [...escEl().querySelectorAll('.esc-row')].map((r) => r.textContent.trim()) : [];
  out.hubPaused = hubE.scene.isPaused();
  // 关掉
  key('keydown', 'Escape', 27); await wait(80); key('keyup', 'Escape', 27);
  await wait(300);
  out.escClosed = !(escEl() && getComputedStyle(escEl()).display !== 'none');
  out.hubResumed = !hubE.scene.isPaused();

  // 滑块：拖动后音量真的变了，且已扫过区域是绿色填充
  if (escEl()) {
    key('keydown', 'Escape', 27); await wait(80); key('keyup', 'Escape', 27);
    await wait(300);
    const vol = document.getElementById('vol-master');
    out.volExists = !!vol;
    if (vol) {
      out.volType = vol.type;
      out.volMin = vol.min; out.volMax = vol.max;
      vol.value = '40';
      vol.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(150);
      out.volStored = stE.meta.settings && stE.meta.settings.volume;
      out.volBg = getComputedStyle(vol).backgroundImage || '';
    }
    const mus = document.getElementById('vol-music');
    const note = document.getElementById('vol-music-note');
    out.musicExists = !!mus;
    out.musicNote = note ? note.textContent.trim() : '';
    key('keydown', 'Escape', 27); await wait(80); key('keyup', 'Escape', 27);
    await wait(250);
  }
```

**（C）Node 侧**：

```js
console.log('\n--- ESC 菜单 / 滑杆（V20 / V21 / V23）---');
ok(r.escOpenInHub === true, '基地按 ESC 打开设置');
ok(Array.isArray(r.hubRows) && r.hubRows.length === 1, '基地里菜单只有一行', JSON.stringify(r.hubRows));
ok((r.hubRows || []).some((t) => t.indexOf('设置') >= 0), '那一行是「设置」', JSON.stringify(r.hubRows));
ok((r.hubRows || []).every((t) => t.indexOf('退出战斗') < 0), '基地里没有「退出战斗」');
ok(r.hubPaused === true, '菜单打开时场景暂停');
ok(r.escClosed === true, '再按 ESC 关闭菜单');
ok(r.hubResumed === true, '关闭后恢复运行（pause/resume 成对）');
ok(r.volExists === true, '有主音量滑杆');
ok(r.volType === 'range', '是 range 控件（能被拖动）', r.volType);
ok(String(r.volMin) === '0' && String(r.volMax) === '100', '范围 0–100', r.volMin + '-' + r.volMax);
ok(Math.abs(r.volStored - 0.4) < 1e-6, '滑动后音量存进 meta.settings', r.volStored);
ok(typeof r.volBg === 'string' && r.volBg.indexOf('gradient') >= 0,
   '已扫过区域用渐变填充（绿色那一侧）', r.volBg);
ok(r.musicExists === true, '有音乐滑杆');
ok(typeof r.musicNote === 'string' && r.musicNote.length > 0,
   '音乐滑杆旁写明「暂无 BGM / 未接入」，否则玩家以为坏了', r.musicNote);
```

> 「战斗中两行」这一条用**逻辑侧**断言（渲染路径太多，浏览器里切战斗再开菜单容易受刷怪干扰）：
> 在 `tests/test_game_logic.js` 里断言 `L.escMenuRows(state)`（Task 13 新增的纯函数）
> 在 `phase === 'run'` 时返回 `['设置','退出战斗']`、`phase === 'hub'` 时返回 `['设置']`。
> 这样浏览器侧只验「渲染出来的行数与文案跟纯函数一致」即可。

**DOM 契约（实现必须照此命名）**：

| 选择器 | 含义 |
|---|---|
| `#esc` | 菜单容器，`display:none` 表示未打开 |
| `#esc .esc-row` | 每一行按钮 |
| `#esc [data-act="quit"]` | 「退出战斗」行（基地里不渲染） |
| `#vol-master` | 主音量滑杆（`input type=range`，`min=0 max=100`） |
| `#vol-music` | 音乐滑杆（同上） |
| `#vol-music-note` | 音乐滑杆旁的说明文字（必须写明暂无 BGM） |

- [ ] **Step 2: 跑测试确认失败**

Run: `"$N" tests/test_game_logic.js && "$N" tests/browser/smoke.js`
Expected: FAIL —— `L.exitRun is not a function`、`L.escMenuRows is not a function`；
浏览器侧 `#esc 打开设置` 等新断言 FAIL，但**既有 45 条仍 PASS**（页面脚本要加
`if (window.EmberfieldUI && document.getElementById('esc'))` 之类的守卫，避免抛异常中止整个脚本）。

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
- **Modify: `tests/bot.js:77` 与 `tests/test_game_logic.js:664`（把硬编码的 `d < 62` 改成 `d < C.ATTACK_RANGE`）**
- Test: `tests/test_game_logic.js`（V18）

> **两处硬编码 62（实测）**：`tests/bot.js:77` 和 `tests/test_game_logic.js:664` 都是
> `if (d < 62 && Math.abs(dz) <= C.ATTACK_DEPTH * 0.85) i.attack = true;` ——
> 机器人出招阈值被写死成 62。配置改到 66 之后，机器人仍然只在 62 内出手，
> **胜率漂移会把"射程变长"的效果系统性低估**，看起来像"改了没用"。
> 必须同步改成 `C.ATTACK_RANGE`（`bot.js` 顶部已 `require` 了 config，直接可用）。

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
同时把 `tests/bot.js:77` 与 `tests/test_game_logic.js:664` 的 `62` 换成 `C.ATTACK_RANGE`。

- [ ] **Step 4: 跑测试确认通过 + 经济漂移检查**

Run: `"$N" tests/test_game_logic.js && "$N" tests/bot.js 2>&1 | tail -20`
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
- Modify: `analysis/build_report2.py`（**本轮复审补记**：报告生成器仍读已删除的 `refundRatio`）

**Interfaces:**
- Consumes: 前 14 个任务的全部产出
- Produces: 一份可提交的验证证据

> **为什么 Task 15 要碰 `analysis/build_report2.py`**：它读 `C.EQUIP_DROP.refundRatio`
> （:109），而该字段已被 Task 1 删除。`Math.round(undefined*100)` = `NaN`，
> `JSON.stringify` 把 `NaN` 写成 `null`，**键不会消失、不抛异常**，脚本继续跑到 :303
> 把 **`refunded at None%`** 静默写进 Phase 2 报告。没有别的任务拥有这个文件，
> Task 15 是最后的收口点。

- [ ] **Step 0: 修掉报告生成器对已删字段的依赖（`analysis/build_report2.py`）**

删 :109 的 `" refund:Math.round(C.EQUIP_DROP.refundRatio*100)"` 表达式、
:119 的 `vals["refund_pct"] = eq["refund"]`、以及 :303 那句
`f"refunded at {v['refund_pct']}%, because otherwise a drop is worthless once the "` 叙述
（产品已改为"掉落全部进包、玩家自行出售"，报告不该再讲折算）。

验证不要靠读代码，直接跑一次生成器并 grep 产物：

```bash
python3 analysis/build_report2.py
```
Expected: 生成 `reports/COMM7660_Phase2_report.docx` 且**不再出现** `None%`；
`grep -c "None%" reports/` 在产物文本里为 0。

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
| §3.5 B7 refundRatio 六处（游戏内） | Task 1 |
| §3.5 B7 报告生成器三处 | Task 15 |
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
