# 彩蛋 · 农场循环 · 独立应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Kill the Vines 加上终极彩蛋（熔炉通关 + 地狱 Boss 两成就齐全后掉落七彩蛋，全屏泛光，纸条渐现，基地相框回看），把远征产出接进农场（作物必须种 → 收获才可用），并打上 Electron 外壳，使其成为可双击启动、离线可玩的独立应用。

**Architecture:** 规则改动全部落在纯模拟层 `logic.js`（不碰 DOM/Phaser/storage），数值全部落在 `config.js`。彩蛋是 **`run.egg` 独立对象，不是 `pickups` 条目**——因为 `stepWave` 的 `collectAll` 会把 pickups 全部吸走（见 §陷阱）。渲染器由 `Phaser.AUTO` 改为 **`Phaser.WEBGL`**，这是全屏泛光的前置。Electron 外壳套在现有静态资源外，存档层复用 `profile.js` 的注入式设计。

**Tech Stack:** 原生 JS（无构建步骤）、Phaser 3.80.1（vendored）、Node 内置 `assert` 跑测试、DOM 浮层、自建 WebAudio 合成、**Electron（新增，唯一新依赖）**。

**Spec:** `docs/superpowers/specs/2026-11-15-egg-and-farm-loop-design.md`（设计文档，本计划逐条实现它；执行者应同时读两份）

---

## Global Constraints

### 测试基线（改动前冻结，每次改动后必须复核）

| 套件 | 基线断言数 |
|---|---|
| `test_game_logic` | **650** |
| `test_game_meta` | **313** |
| `test_game_page` | **195** |
| `test_bag` | **184** |
| `test_audio` | **225** |
| `test_bosspose` | **96** |
| `test_feel` | **44** |
| `check_textures` | 通过 |
| `test_product_app` | 通过 |

### 平衡基线（改动前后必须一致，`tests/balance_report.js`）

```
强化水平     草丛    林地    密林    熔炉
零强化      100%   94%    61%     8%
半满         91%   94%    81%    53%
全满         92%   92%    89%    78%
```

> **任何一项偏移超过 ±8 个百分点即视为破坏平衡**，必须停下查因。
> （报告自带说明：单档 ±8 个百分点内属噪声范围。）

### 项目硬规则

- **规则与渲染分离**：`logic.js` 内**禁止**出现 `document` / `window` / `Phaser` / `localStorage`。CI 有测试盯着。
- **数值只在 `config.js`**：`logic.js` / `app.js` 里出现裸魔数视为缺陷。
- **不得引入浏览器专有依赖**（spec §8.4）：不用 `window.open`、不依赖 HTTP 服务器、资源路径必须相对、存档层不得写死 `localStorage`。
- **`STATE_VERSION` 保持 6**，加字段走 `normSettings` 式兜底（`ambient` 有先例，`logic.js:2255`）。
  不匹配会 **throw**（`logic.js:2264`），所以兜底必须在版本检查**之前**。
- **纸条文字是 PM 的原文，一个字都不许改**（见 §纸条原文）。
- **`tests/browser/smoke.js` 页面内片段是模板字符串**：粘进去的代码**任何位置都不许出现反引号**（包括注释）。踩过一次，整个 smoke 会语法崩溃。

### 纸条原文（PM 亲笔，实施时原样使用）

```js
EGG_LETTER_TEXT: [
  '感谢你游玩我的游戏。',
  '这是我第一次且独立开发的',
  '有很多不足之处让您皱了眉头',
  '我会用下一佳作舒展它们',
].join('\n'),
```

> **不改标点、不改语序、不补字、不润色。** 第三行结尾没有句号是 PM 的原文，保持原样。
> 篇幅极短（正文 46 字），**排版上要当作一首短诗处理，不要拉伸成段落**。

### 测试命令

```bash
N="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
"$N" tests/test_game_logic.js
"$N" tests/balance_report.js      # 平衡阶梯，较慢
```

- **本机 `npm` 不存在**，用上面的 node 或 `pnpm`/`npx`。
- **`timeout` 命令在 macOS 上不存在**，需要限时用后台任务。

---

## §陷阱：本计划最容易做错的一处

**彩蛋绝不能做成 `run.pickups` 的条目。** 事实链（三处已核实）：

| # | 事实 | 位置 |
|---|---|---|
| 1 | `stepWave()` 清波时调用 `collectAll(state, run)` | `logic.js:2027` |
| 2 | `collectAll` 把 **`run.pickups` 全部**吸进战利品 | `logic.js:1820` |
| 3 | `stepPickups` 自动吸附 `grounded` 且进入 40/34 半径的任何掉落物 | `logic.js:701-702` |

**后果**：熔炉通关正是由 `stepWave` 触发的。彩蛋若进 `pickups`，会在最后一只怪死的那一刻被吸走 + 立即 `endRun` 进结算，**玩家永远没机会按 J**。

**正确做法**：`run.egg = { x, z, state }` 独立对象，**不放进 `pickups`，无自动吸附，不超时消失**。

---

## File Structure

| 文件 | 现状 | 本批职责 |
|---|---|---|
| `electron/` | **新建** | Electron 主进程 + 打包配置 |
| `package.json` | **新建** | Electron 依赖与启动脚本 |
| `game/config.js` | 932 行 | 加 `EGG`（演出参数 + 纸条原文）、加 `CROPS`（作物表）、改 `FARM`（种子结构相关） |
| `game/logic.js` | 2348 行 | **主要改动**：彩蛋两成就判定 + `run.egg` + 熔炉通关流程 + `lastKillX/Z` + 存档三字段；作物种子结构 + 种植 + 收获 + 迁移 |
| `game/app.js` | 4220 行 | **`AUTO`→`WEBGL`**、彩蛋演出（三阶段）、相框 zone、J 拾取接线、作物种植 UI |
| `game/hub.js` | 500 行 | 加相框 zone（须避开远征之门 reach） |
| `game/index.html` | 1375 行 | 纸条浮层、作物种子选择 UI |
| `tests/test_egg.js` | **新建** | 彩蛋触发（两顺序）、不重掉、`run.egg` 免疫 collectAll、存档往返 |
| `tests/test_farm_crops.js` | **新建** | 作物种植、腐烂、收获、老档迁移 |
| `tests/test_game_logic.js` | 650 断言 | 加熔炉通关流程未变（两成就不齐时）的锁定断言 |

---

## 分步交付

**四步，每步独立可回退，每步完成后 PM 能看到实物。**

---

## Task 1: Electron 外壳

**为什么先做**：PM 已定（D9）在壳里开发。先搭环境，之后所有功能都在正确的环境里验证。

**Files:**
- Create: `package.json`, `electron/main.js`, `electron/preload.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pnpm start` 能启动应用；`pnpm run dist` 能出安装包

- [ ] **Step 1: 建 `package.json`**

```json
{
  "name": "kill-the-vines",
  "version": "0.3.0",
  "description": "Kill the Vines — 2.5D roguelite (COMM7660 Phase 2)",
  "main": "electron/main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  },
  "build": {
    "appId": "com.caoyuquan.killthevines",
    "productName": "Kill the Vines",
    "files": ["electron/**/*", "game/**/*"],
    "directories": { "output": "dist" }
  }
}
```

- [ ] **Step 2: 建 `electron/main.js`**

要点（每条都有理由）：
- `loadFile('game/index.html')` —— **用 `loadFile` 而不是 `loadURL('http://…')`**，这是"离线可用"（E2）的实现基础
- `webPreferences: { contextIsolation: true, nodeIntegration: false }` —— 安全默认
- `width/height` 用 960×540 的整数倍放大（现有画布是 960 宽）
- 不得调用任何需要网络的 API

- [ ] **Step 3: 安装依赖**

```bash
cd /Users/f1gment/Documents/7660
pnpm add -D electron electron-builder
```
若 Electron 二进制下载慢，设镜像：
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm add -D electron
```
（实测该镜像可达：HTTP 302，0.30s）

- [ ] **Step 4: 验证 E1/E2/E5**

| 判据 | 怎么验 |
|---|---|
| E1 双击启动 | `pnpm start` 直接进游戏 |
| E2 离线可用 | **断开网络**后 `pnpm start`，游戏可玩 |
| E5 测试在壳里通过 | 在 Electron 窗口里跑一局，确认无报错 |

- [ ] **Step 5: 提交**

```bash
git add package.json electron/ .gitignore
git commit -m "feat(shell): Electron 外壳，双击启动 + 离线可玩"
```

---

## Task 2: 切 WebGL（含两道闸门）

**为什么独立成一步**：这是**唯一能让一切回归的改动**。spec §2 反目标：「宁可回退到 A，也不能发布一个泛光好看但贴图坏掉的版本」。

**Files:**
- Modify: `game/app.js:4206`

- [ ] **Step 1: 改渲染器**

```js
// game/app.js:4206
type: Phaser.WEBGL,   // 原为 Phaser.AUTO
```

- [ ] **Step 2: 闸门一 —— 自动化回归**

```bash
N="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
for t in test_game_logic test_game_meta test_game_page test_bag test_audio test_bosspose test_feel check_textures test_product_app; do
  printf "%-20s " "$t"; "$N" tests/$t.js >/dev/null 2>&1 && echo PASS || echo FAIL
done
```
**判据**：全部 PASS，且断言数与 §基线表完全一致。

- [ ] **Step 3: 闸门二 —— 8 处 ADD 混合逐一目视（关键）**

**这是 WebGL 切换的真正风险点**，不是 38 处 `generateTexture`（那是 Phaser 统一 API，跨渲染器行为一致）。

实查到的 8 处 `BlendModes.ADD`，**全部是发光效果**：

| # | 位置 | 用途 |
|---|---|---|
| 1 | `app.js:1723` | 光晕 |
| 2 | `app.js:1751` | 火星 |
| 3 | `app.js:1753` | 火星 |
| 4 | `app.js:1755` | 火星 |
| 5 | `app.js:1769` | 火星 |
| 6 | `app.js:1789` | 火星 |
| 7 | `app.js:2696` | 光晕 |
| 8 | `app.js:3964` | 光晕 |

做法：起本地服务器 → CDP 截图 → **与切换前的同一画面逐张对比** → 生成核对表逐项打勾。

> ADD 在 Canvas 与 WebGL 下渲染不同（WebGL 受预乘 alpha 影响）。
> **判据是"目视确认发光效果没有变黑、变灰或消失"**，不是"看起来差不多"。

- [ ] **Step 4: PM 人眼确认一局**

> ⚠️ **按 `AGENTS.md`，agent 不得把自己的完成声明当作证据。** 这一步必须由 PM 亲自玩一局确认。

- [ ] **Step 5: 任一异常即回退**

若闸门二发现任何一处异常：**立即改回 `Phaser.AUTO`**，记录为已知问题，**不得带病继续**。

- [ ] **Step 6: 提交**

```bash
git add game/app.js
git commit -m "feat(render): 切 Phaser.WEBGL，为全屏泛光铺路（过两道闸门）"
```

---

## Task 3: 彩蛋（触发 + 演出 + 相框）

### Task 3.1: 彩蛋状态与触发（logic 层）

**Files:**
- Modify: `game/logic.js`, `game/config.js`
- Create: `tests/test_egg.js`

**Interfaces:**
- Produces:
  - `state.meta.clearedForge: boolean`
  - `state.meta.beatHellBoss: boolean`
  - `state.meta.eggFound: boolean`
  - `run.egg: { x, z, state: 'ground' | 'taken' } | null`
  - `run.lastKillX: number`, `run.lastKillZ: number`
  - `L.eggEligible(state, run): boolean` —— 两成就齐全且未掉过

- [ ] **Step 1: 先写失败测试（RED）**

`tests/test_egg.js` 必须覆盖：

| 断言 | 说明 |
|---|---|
| 两成就不齐 → 不掉蛋 | **最重要的一条**，保证既有行为不变 |
| 先通关熔炉 → 后打赢地狱 → 掉蛋 | 落在 **Boss 尸体位置** |
| 先打赢地狱 → 后通关熔炉 → 掉蛋 | 落在 **最后一只怪位置** |
| 蛋掉过后再打赢地狱 → 不掉 | D3 |
| **`run.egg` 不在 `run.pickups` 里** | 防 §陷阱回归 |
| 清波时 `collectAll` **不会**移走 `run.egg` | 同上 |
| 存档往返：三字段持久化 | 老档补 `false` |

**先跑一次确认 FAIL**，且失败原因是"功能还不存在"而不是拼写错误。

- [ ] **Step 2: `config.js` 加 `EGG` 参数表**

```js
const EGG = {
  // 判定
  requiredForge: true, requiredHellBoss: true,   // 两成就都必需（D1）
  dropOnce: true,                                 // 只掉一次（D3）

  // 演出时长（毫秒）—— 全部可调，理由同 FEEL：
  // 演出节奏是主观的，必须能反复微调而不碰渲染代码
  burstMs: 1400,        // 全屏光爆
  letterFadeMs: 900,    // 纸条渐现
  letterCharMs: 55,     // 每字浮现间隔

  // 拾取
  pickupRadius: 90,     // 比普通掉落物(40/34)大得多：这是彩蛋，别让玩家找不到
  needsConfirm: true,   // 必须按 J（PM 指定）

  // 纸条原文 —— PM 亲笔，禁止改动（见 Global Constraints）
  letterText: [
    '感谢你游玩我的游戏。',
    '这是我第一次且独立开发的',
    '有很多不足之处让您皱了眉头',
    '我会用下一佳作舒展它们',
  ].join('\n'),
};
```

- [ ] **Step 3: `logic.js` —— 记录最后击杀位置**

在 `killEnemy` 里**无条件**加两行（纯增量，无副作用）：

```js
run.lastKillX = e.x;
run.lastKillZ = e.z;
```

- [ ] **Step 4: `logic.js` —— 两个成就判定**

在 `killEnemy` 的 Boss 分支（`if (!e.isBoss)` 的 **else** 路径）：

```js
if (e.isBoss && run.isBossRun && run.bossTier === 'hell') {
  state.meta.beatHellBoss = true;
  maybeDropEgg(state, run, e.x, e.z);
}
```

在 `stepWave` 通关处（`endRun` 之前）：

```js
if (run.waveIndex >= run.diff.waves) {
  if (!run.isBossRun && run.difficultyId === 'forge') {    // ← !run.isBossRun 不可省！
    state.meta.clearedForge = true;
    if (maybeDropEgg(state, run, run.lastKillX, run.lastKillZ)) {
      run.pendingEggSettlement = true;   // 见 Step 5
    }
  }
  if (!run.pendingEggSettlement) endRun(state, true);
}
```

> ⚠️ **`!run.isBossRun` 不可省略。** `BOSS_TIER_DIFF` 把 `hell` 映射到 `forge`，
> 所以 Boss 局的 `run.difficultyId` 就是 `'forge'`。漏掉这个条件，
> 打赢地狱会同时置位两个成就，**"两个成就"的设计当场坍缩成一个**。

- [ ] **Step 5: `logic.js` —— 熔炉通关流程改造（D5，风险最高处）**

```js
function maybeDropEgg(state, run, x, z) {
  if (state.meta.eggFound) return false;
  if (!state.meta.clearedForge || !state.meta.beatHellBoss) return false;
  run.egg = { x: x, z: z, state: 'ground' };   // ← 独立对象，不进 pickups
  state.meta.eggFound = true;
  return true;
}
```

- [ ] **Step 6: 跑测试（GREEN）+ 平衡回归**

```bash
"$N" tests/test_egg.js
"$N" tests/test_game_logic.js   # 必须仍是 650
"$N" tests/balance_report.js    # 必须与基线一致
```

- [ ] **Step 7: 提交**

### Task 3.2: 彩蛋演出 + 拾取（渲染层）

**Files:**
- Modify: `game/app.js`, `game/index.html`
- Modify: `game/audio.js`（新增一个合成音效）

- [ ] **Step 1: 七彩蛋（发现阶段）**

| 元素 | 做法 |
|---|---|
| 蛋体 | 程序化贴图（与既有风格一致），**色相循环**（`setTint` 随时间走遍色环） |
| 光晕 | 复用既有 `glow` 贴图 + `BlendModes.ADD`（**切了 WebGL 才能真发光**） |
| 浮动 | 呼吸式上下起伏 + 轻微缩放 |

- [ ] **Step 2: 按 J 拾取**

复用既有 `KeyJConfirm`。**蛋不自动吸附**——`pickupRadius: 90` 只是判定的范围，触发仍须按键。

- [ ] **Step 3: 全屏光爆（拾取瞬间）**

按 `EGG.burstMs` 推进：白光快速涨到峰值 → 七彩光扩散（ADD）→ 衰减。

- [ ] **Step 4: 纸条渐现**

光散去后：纸条从模糊到清晰，**文字逐字浮现**（间隔 `EGG.letterCharMs`）。

> **排版要求**：正文仅 46 字，是四行短句。**当作短诗排版**——居中、行距舒展、字号偏大。
> 不要拉伸成正文段落，也不要加标题或署名（PM 没写这些）。

- [ ] **Step 5: 演出结束后才结算**

若 `run.pendingEggSettlement`，演出完毕才调 `endRun(state, true)`。

- [ ] **Step 6: PM 人眼确认**

- [ ] **Step 7: 提交**

### Task 3.3: 基地相框（纸条回看，D4/D8）

**Files:**
- Modify: `game/hub.js`, `game/app.js`, `game/index.html`
- Modify: `tests/test_egg.js`

- [ ] **Step 1: 选址（须满足三条约束）**

现有 6 个 zone：田地(165,88) → 铁匠铺(265,122) → 兵器架(415,88) → 商店(565,122) → 技能祭坛(720,88) → 远征之门(880,105)。

| 约束 | 理由 |
|---|---|
| 与既有 zone 的触发半径**不重叠** | 远征之门 `reach: 60` 在 x=880；重叠会导致按 J 歧义 |
| 保持在 `HUB_W = 960` 内 | **不重排现有 6 个交互点及其美术** |
| 尽量靠近远征之门 | 保留"打完回来第一眼看见"的仪式感 |

**若三条不能同时满足**：优先保证"不重排"，其次放弃"靠近门"。

- [ ] **Step 2: D8 —— 未掉蛋时不给相框**

```js
// 蛋没掉落 → 这个 zone 不出现（不是出现一个灰的）
if (!state.meta.eggFound) return null;
```

> PM 选的是"没填就不给相框，发布空相框状态"。现在的实现更进一步：
> **纸条有内容了（PM 已写），所以彩蛋掉落后相框直接可用**，不存在空相框。

- [ ] **Step 3: 打开纸条的浮层**

复用既有 DOM `#panel` 浮层模式（`baghud.js` 已验证这条路可行）。
**排版与彩蛋演出时一致**（同为短诗式）。

- [ ] **Step 4: 存档往返测试**

```bash
"$N" tests/test_egg.js   # 加：掉蛋 → 存档 → 读档 → 相框仍在
```

- [ ] **Step 5: 提交**

---

## Task 4: 作物种植（D6）

**Files:**
- Modify: `game/config.js`, `game/logic.js`, `game/app.js`
- Create: `tests/test_farm_crops.js`

**⚠️ 这一步会动农场六处**（构建者审查所列，已复核）：

| # | 要改的 | 现状 |
|---|---|---|
| 1 | `meta.seeds` 结构 | **单一整数**（`logic.js:42`）→ 按作物分类的表 |
| 2 | `plant()` | 只做 `meta.seeds -= C.FARM.seedCost`（`logic.js:396`） |
| 3 | 种子腐烂 | `seedSpoilRate` 按单一整数算（`endRun` 内） |
| 4 | 结算卡显示 | `seedSpoiled` |
| 5 | 田地 UI | `FarmScene`（`app.js:3700`）要能选作物 |
| 6 | 存档迁移 | 老档 `seeds: 3` 整数 → 新结构 |

- [ ] **Step 1: 先写失败测试（RED）**

`tests/test_farm_crops.js` 覆盖：种植指定作物、成熟、收获、腐烂按作物分别计算、**老档迁移**。

- [ ] **Step 2: `config.js` 加 `CROPS` 表**

**先做 3 种**，效果**刻意与现有三种药水对齐**（这是有意的）：

| 作物 id | 效果 | 对齐的药水 |
|---|---|---|
| `待 PM 命名` | 回血 | `POTIONS.heal` |
| `待 PM 命名` | 伤害增益 | `POTIONS.strength` |
| `待 PM 命名` | 减伤 | `POTIONS.wall` |

> **作物命名与外观是 PM 拥有的内容，实施者不得自行发明。**
> 若 PM 尚未命名，**用占位名并在交付说明里标注"待 PM 命名"**，不得自行编造世界观。

- [ ] **Step 3: 种子结构迁移**

```js
// 老档：meta.seeds = 3（整数）
// 新档：meta.seeds = { <cropId>: n, ... }
// 迁移：整数 → 全部归给第一种作物；0 或缺失 → 空表
```

**必须在 `STATE_VERSION` 检查之前做**（不匹配会 throw，见 Global Constraints）。

- [ ] **Step 4: 远征掉落作物种子**

`LOOT.seedChance` 已有掉种子逻辑（`killEnemy` 内），扩展成按权重选作物种类。

- [ ] **Step 5: 收获 → 可用（D7 最小版）**

收获物进 `POTIONS` 携带体系（`run.potions` / 键 1-2-3）。
**本次不做背包"使用"按钮**（PM 已同意下次做）。

- [ ] **Step 6: 平衡回归（关键）**

```bash
"$N" tests/balance_report.js   # 必须与基线一致，偏移 >8 个百分点即视为破坏
```

> 作物一旦能吃，等于**给玩家的战斗资源变多了**，可能推高胜率。
> 若熔炉零强化胜率从 8% 显著上升，说明难度被稀释，**必须回调**。

- [ ] **Step 7: 提交**

---

## 完成判据（全部满足才算完成）

| # | 判据 | 谁来确认 |
|---|---|---|
| C1 | 四步全部提交，每步可独立回退 | agent |
| C2 | 9 个测试套件断言数与基线一致 | agent |
| C3 | 平衡阶梯与基线一致 | agent |
| C4 | **PM 人眼确认：彩蛋演出好看、纸条可读、相框可用** | **PM** |
| C5 | **PM 人眼确认：WebGL 下 8 处 ADD 发光正常** | **PM** |
| C6 | 双击启动 + 离线可玩 | PM |
| C7 | 纸条文字与 PM 原文**逐字一致** | agent（diff 核对） |

> **C4/C5/C6 是人的判据，agent 的自测不能替代。** 按 `AGENTS.md`：
> 「A task is complete only when the PM has inspected the output.」
