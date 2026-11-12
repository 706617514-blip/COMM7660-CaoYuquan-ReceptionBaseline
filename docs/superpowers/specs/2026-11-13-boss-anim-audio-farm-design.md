# 设计文档：Boss 动作、音效扩充、进场过渡与农场经济扩展

- 日期：2026-11-13
- 分支：`feat/backpack-audio-settings`
- 状态：**PM 已口头批准全部 8 条需求（2026-11-13 01:42）**，文中「PM 未指定」的部分由实施者按 §7 的记录自行决断
- 上游文档：`docs/superpowers/specs/2026-11-12-backpack-audio-settings-design.md`

---

## 1. 需求原文

PM 于 2026-11-13 提出的 8 条（逐字保留，作为验收依据）：

1. 给三个 boss 增加包括但不限于走路、抬手等动作，「现在依然是一张贴图在平移看着很诡异」。
2. 增加角色走路音效，「像 Minecraft 里踩土地的沙沙声」。
3. 增加通关成功/失败音效，「简短的就可以，0.3-0.8 秒之间差不多」。
4. 点击进入关卡后做渐黑，「像进入农场那样。现在是硬切，需要一点给玩家过渡的节奏」。
5. 农场的种子增加失效机制，「以防止玩家收集过多种子没地方用」。
6. 药铺改名为商店，增加购买农场田地的机制（和背包页数相似），初始田地数量和现在一样，
   每块田地售价 3000 金币；农场增加切换下一页机制，右边箭头切下一页，
   非第一页同时存在左箭头与右箭头（左箭头在左、右箭头在右）。
7. 基地页面增加夜晚静谧虫鸣音效，「记得把加入到音效调节里，意思就是做成可调节的」。
8. （过程性）为跨会话接手，把「接手说明」写进仓库。→ 见 `docs/handover-for-agents.md`。

第 8 条已在开工前完成（本设计的第一个提交）。

---

## 2. 现状（实施前实测，不是回忆）

| 事实 | 位置 | 证据 |
|---|---|---|
| Boss 美术只有 6 张 PNG | `game/assets/boss_<tier>_<dir>.png` | `normal 191×321`、`hard 193×407`、`hell 196×403`，各含 left/right |
| Boss 本体是**单张 image** | `game/app.js` `if (!this.bossSprite) { this.bossSprite = this.add.image(0,0,'boss_normal_right')... }` | 只有 `setPosition/setScale/setRotation` |
| 现有「动作」是纯形变 | `game/app.js` boss 渲染段 | `const breathe = Math.sin(time/620)*0.014; let sx = 1+breathe, sy = 1-breathe;` + 蓄力时 `dxOff` 抖动、`sy = 1-charge*0.10`、`rot = -0.045*charge*facing` |
| Boss 状态机在逻辑层 | `game/logic.js` `stepBoss` | 状态只有三种可观测：`boss.casting`（前摇中）、`boss.attackCd`、位置变化（走路） |
| 音效是**合成器**不是音频文件 | `game/config.js` `AUDIO.sfx` | 17 条：slash/hit/crit/hurt/coin/seed/dropNew/dropDup/potion/skill/special/upgrade/sell/bagOpen/wave/boss/death |
| 音效引擎支持 `voices/f0/f1/filter/am/at` | `game/audio.js` `buildVoice` | 单次播放；`play(name)`，25ms 节流 |
| **没有任何循环播放能力** | `game/audio.js` | 只有 `play`，没有 ambient/loop —— 虫鸣必须新开通道 |
| 进农场有渐黑，进关卡是硬切 | `game/app.js` | 农场：`fadeOut(340,0,0,0)` + `once('camerafadeoutcomplete')` → `scene.start('Farm')`，`FarmScene` 里 `fadeIn(420)`；关卡：`startRun` 直接 `this.scene.start('Run')` |
| 种子是单一计数 | `game/logic.js` `createState` | `meta.seeds: 3`，`plant` 扣 1，结算 `state.meta.seeds += seeds` |
| 农场固定 3×3=9 块 | `game/config.js` `FARM.cols/rows` + `game/hub.js` `farmLayout` | `runsToMature:2`、`yieldPerPlot:9`、`seedCost:1` |
| 商店（原药水铺）已卖背包扩容 | `game/hub.js` shop 分支 | `kind:'bag-page'`、`verb:'购买'`、价格取自 `C.BAG.pagePrices` |
| 设置面板有两条滑块 | `game/index.html` `#esc-settings` | `#vol-music`（**只存值不发声**，无 BGM）、`#vol-master`（真实增益） |

---

## 3. 决策

### 3.1 Boss 动作：程序化藤蔓手臂 + 步态周期，不新增美术

**问题**：一张静态 PNG 无法"抬手"。要真做逐帧动画，需要 3 档 × 左右 × N 帧 = 几十张图，
本仓库没有画师产能（所有美术都是 `Graphics.generateTexture` 烘出来的，唯独 boss 是外部 PNG）。

**方案**：保留 PNG 当躯干与腿，**在它上面程序化画 2 条藤蔓手臂**，逐帧按状态驱动：

| 状态 | 判据（来自逻辑层，不猜） | 表现 |
|---|---|---|
| `idle` | 位置无变化且非 casting | 手臂轻摆（±4°）、躯干呼吸（沿用现有 `breathe`） |
| `walk` | 本帧位移 > 0.5px | 躯干随步伐上下 ±3px、左右微倾、手臂反向摆动（±18°）、**脚下扬尘**（每次落步一个粒子） |
| `windup` | `boss.casting` 存在且 `timer/windup > 0.35` | 手臂**抬起**（-60°）、躯干后仰、蓄力抖动（沿用现值） |
| `strike` | `boss.casting` 存在且 `timer/windup ≤ 0.35` | 手臂**下砸**（+35°）、躯干前倾 |

**为什么藤蔓手臂能融进现有美术**：`boss_normal_right.png` 本体就是一团纠缠藤蔓/树根，
肩部本来就有大量垂下的枝蔓。额外画两条同色系（`0x4a4038`~`0x6b5a49`）的分节藤蔓，
在视觉上是"这团藤蔓里又多伸出两条"，不是"贴了两根香肠"。

**约束**：
- 手臂必须画在**独立 Graphics 层**，`setDepth(1000 - boss.z + 1)`，即紧跟 boss 但更高一层，
  否则会被 boss 本体挡住一半。
- 手臂锚点相对 boss 贴图取（肩高约贴图高度的 0.62、左右各 ±0.30 宽），**随 `scale` 缩放**，
  否则三档 boss 高度不同（185 目标高、贴图 321~407）手臂会长短不一。
- 左右朝向：`dir === 'left'` 时锚点镜像，手臂摆动相位也镜像。
- 手臂节数 6 节、每节长度递减（1.0/0.86/0.74/0.63/0.54/0.46 × 基长），
  逐节角度 = 基准角 + sin(phase + i*0.6) × 摆幅，形成自然波动。

**不做**：不替换 PNG、不改 boss 判定半径、不改任何战斗数值。

#### 3.1.1 补记（2026-11-13 02:10，派发 Task 25 前补的）

姿态计算要放进**新的纯函数模块 `game/bosspose.js`**（`global.BossPose = { compute, segments }`），
不要直接写在 `app.js` 的渲染循环里。

原因：写在渲染循环里就只有**肉眼**能验证（截图一天只能看几张），
而"抬手确实比走路高""走路起伏确实比站着大""2 秒内确实踩了 2–6 步"
这些都是可以用 Node 单测钉死的不变量。`app.js` 只负责按姿态画图。

`compute()` 输出 `state/bob/squash/lean/armRaise/armSwing/armPhase/footfall/stepPhase`，
`segments()` 输出 6 节角度。判据与数值见 §3.1 的表，§5 任务书里有逐条不变量。

### 3.2 走路音效：脚步按位移触发，不按时间

不允许用定时器每 300ms 响一次 —— 那样站着不动也会响、冲刺时又太慢。
**按累积位移触发**：`stepAccum += moved; if (stepAccum >= stepStride) { play('footstep'); stepAccum -= stepStride; }`

- `stepStride` 基础 26（世界单位），冲刺时 22（步子更密）。
- 基地与关卡都触发（用户说的是"角色走路音效"，没限定场景）。
- 音量必须低于 `slash`：脚步是背景节奏，不是事件。峰值 ≤ 0.12。
- **必须节流**：连续两帧都可能跨过阈值，`play` 内部已有 25ms 节流兜底。

### 3.3 通关成功/失败音效

- 新增 `victory`：上行三音（392→523→784，三角波），总长 ≈ 0.62s。
- 现有 `death` 改名为 `defeat` 并调整到 ≈ 0.55s（下行 392→294→196，保留原音色）。
- 触发点：`run.status` 从 `active` 变为 `won` → `victory`；变为 `lost` → `defeat`。
- **不叠加**：结果卡出现时不额外播音效。
- 时长断言：`0.3 ≤ 总时长 ≤ 0.8`（见验收 V6）。

### 3.4 进关卡渐黑

照抄农场那套，不自创：

```
this.cameras.main.fadeOut(340, 0, 0, 0);
this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Run'));
```

- `startRun` 与 `startBossRun` 两处都要改（Boss 挑战也是"进关卡"）。
- `RunScene.create` 加 `this.cameras.main.fadeIn(420, 0, 0, 0)`，与 `FarmScene` 同参数。
- **必须防连点**：渐黑 340ms 内玩家再按 J 会触发第二次 `fadeOut`，导致 `once` 回调注册两次、
  `scene.start` 被调用两次（表现为进入关卡后立刻重开）。用一个 `this.transitioning` 标志挡住。
- 远征结束回基地（`Run → Hub`）已有 `fadeOut(320)`，不动。

### 3.5 种子失效：超过「自家田地播种量」的部分每局腐烂 25%

**规则**：每局结算时，
`grace = 当前田地数`（9 起步，买了田就涨）
`if (seeds > grace) seeds = grace + ceil((seeds - grace) * 0.75)`

- 保底 = 田地数：满田玩家**永远**留得下够种一页的种子，不会断种。
- 超过部分每局掉 25%：100 颗 → 9+69=78 → 61 → … 逐渐收敛到 9。
- 为什么不是"每颗种子有寿命"：`meta.seeds` 是**单一整数**，改成带年龄的列表要动存档结构、
  迁移链、以及所有 `meta.seeds` 的读取点（种植、结算、HUD、导出码），
  收益与风险不成比例。按比例腐烂用 3 行代码达到同样目的。
- **必须在结算卡上显示**：`种子 12 → 9（腐烂 3）`，否则玩家会觉得种子凭空消失。
- 数值写进 `C.FARM.seedSpoilRate = 0.25`，不在逻辑里内联。

### 3.6 药铺 → 商店，并卖田地

- `H.ZONES` 里 `{ id:'shop', name:'药水铺' }` → `name: '商店'`；`hint` 同步改为
  `补给消耗品 · 农场田地 · 每局都要重新买`（田地买一次永久）。
- 商店新增一行，**仿照 `bag-page` 的写法**（同一套 `verb/cost/enabled/disabledReason` 契约）：
  - `kind: 'farm-plot'`、`label: '农场田地+1'`
  - `sub: '当前 N/M 块 · 每页 9 块 · 第 K 页'`
  - `cost: 3000`（`C.FARM.plotPrice`）
  - 满额时 `cost: null` + `disabledReason: '田地已开满 27 块'`
- 逻辑层新增 `buyFarmPlot(state)`，与 `buyBagPage` 同构：先规整、判上限、判钱、
  成功才扣钱并 push 一个空 plot。

**上限与页**（PM 未指定，实施者决断）：
- 每页 9 块（与现行 3×3 一致），**最多 3 页 = 27 块**。
- `C.FARM.cols/rows` 仍是 3×3（决定单页布局），新增 `C.FARM.maxPlots = 27`。
- 页面数**由田地数推导**：`pages = ceil(plots.length / 9)`，不单独存 ——
  存两份必然会漂（买了田但页数没涨）。

### 3.7 农场翻页

- 第 1 页（index 0）只有**右**箭头（前提：还有下一页）。
- 第 2 页起左右都有；最后一页只有左箭头。
- 箭头位置：屏幕左缘 / 右缘，垂直居中，大小 44×44，`depth` 高于田块低于 HUD。
- 翻页不改变 `cursor`（选中态）语义：`cursor` 是**绝对** plot 索引，翻页只改可见窗口。
- 空页不可能出现（页数由田地数推导），但**跳页后必须重绘** `redrawField()` + `refreshHud()`。

### 3.8 基地虫鸣：新增「环境音」通道

**为什么不能复用「音乐」滑块**：音乐滑块明确标注"暂无 BGM · 不发声"，两者语义不同；
把虫鸣塞进去，玩家拖"音乐"听到虫鸣，会以为那是 BGM。

- `game/audio.js` 新增：`startAmbient(name)`、`stopAmbient()`、`setAmbientVolume(v)`、
  `ambientName()`；内部一条 `ambientGain → master` 链与一个 `loop` AudioBufferSource。
- 虫鸣合成：8 秒缓冲区，**离线**一次性渲染（`OfflineAudioContext` 不可用时退化为
  实时调度的稀疏脉冲），内容 = ~26 只蟋蟀的短促高频脉冲（4.2~6.8kHz 正弦 + 带通噪声）
  + 极低的 60Hz 夜风底噪。**随机但固定种子**，避免每次进入听起来不同。
- 只在 `Hub` 场景播放：`HubScene.create` → `startAmbient('cricket')`；
  `HubScene` 的 `shutdown` 事件 → `stopAmbient()`。
  **必须在离开 Hub 时停**，否则进关卡后基地虫鸣还在响。
- 设置面板加第三条滑块「环境音」：`meta.settings.ambient`（0..1，默认 0.30）。
  拖它只改 `ambientGain`，**不碰 masterGain**。

### 3.9 设置面板最终形态

| 滑块 | 控制 | 真实生效 |
|---|---|---|
| 音乐 | `meta.settings.music` | **否**（无 BGM），下方保留说明文字 |
| 环境音 | `meta.settings.ambient` | 是（虫鸣增益） |
| 音量 | `meta.settings.volume` / `masterGain` | 是（总音量） |

---

## 4. 不可破坏的既有约束

1. **逻辑层不许有 DOM/Phaser/storage**（`game/logic.js` 纯模拟）。
2. **数值不许内联**：单价、腐烂率、上限、步幅一律进 `game/config.js`，CI 会查。
3. `tests/browser/smoke.js` 的 `SCRIPT` 是**模板字符串**：其中的注释与代码
   **不许出现反引号、`${`、以及单个反斜杠**（`\s` 必须写成 `\\s`）。踩过两次。
4. smoke 独占端口 **8123**，不能并行跑；探针用 8132。
5. `.superpowers/sdd/` 被 `.gitignore` 忽略，progress/report 不入库。
6. 存档版本 `STATE_VERSION = 6`；本次**不改结构**（`meta.settings.ambient` 走默认值兜底，
   不需要迁移；`farm.plots` 变长是数组天然支持）。

等等 —— `meta.settings.ambient` 是新字段。现有 `settings` 只有 `{volume, muted, music?}`。
新增字段必须**有默认值兜底**（`syncSettings` 里 `settings.ambient == null ? 0.30 : ...`），
否则老存档读出来是 `undefined`，音量变 0 或 NaN。**不需要**升 `STATE_VERSION`。

---

## 5. 任务拆分

| # | 任务 | 主要文件 | 风险 |
|---|---|---|---|
| A | 音效：脚步 / 胜负 / 环境音通道 / 设置滑块 | `config.js`、`audio.js`、`app.js`、`index.html`、`test_audio.js`、`smoke.js` | 中（循环通道是新能力） |
| B | 进关卡渐黑 + 防连点 | `app.js`、`smoke.js` | 低 |
| C | 种子失效 | `config.js`、`logic.js`、`index.html`(结算文案)、`test_game_logic.js` | 低 |
| D | 商店改名 + 买田地 + 农场翻页 | `config.js`、`logic.js`、`hub.js`、`app.js`、`test_game_logic.js`、`test_game_meta.js`、`smoke.js` | **高**（跨 4 层 + 布局） |
| E | Boss 程序化藤蔓动作 | `app.js`、`smoke.js` | **高**（观感无法自动断言，必须截图） |

建议顺序：B → C → A → D → E（先做小的、风险低的，把 D/E 这两个需要人工看图的放后面，
且 D 依赖 C 的 `grace = 田地数`）。

---

## 6. 验收条款

| # | 条款 | 判据 |
|---|---|---|
| V1 | 三个 boss 都有走路动作 | 同一 boss 在移动时，躯干 y 与手臂角度**随时间连续变化**，且与静止态不同 |
| V2 | 三个 boss 都能"抬手" | `casting` 期间手臂角度显著大于 idle（≥ 40° 差），前摇后半段转下砸 |
| V3 | 手臂随档位缩放 | 三档 boss 的手臂基长与 `bossSprite.scale` 成正比 |
| V4 | 走路有沙沙声 | 移动时 `footstep` 被触发；静止时 3 秒内**零次**触发（反证） |
| V5 | 脚步按位移不按时间 | 冲刺时单位时间内触发次数 > 走路时 |
| V6 | 胜负音效时长 0.3~0.8s | 两个音效各 voice 的最大 `at+dur` 落在区间内 |
| V7 | 通关播 victory、失败播 defeat | 由 `run.status` 驱动，且**只播一次** |
| V8 | 进关卡渐黑 | 点进入关卡后 `camera.fadeEffect.isRunning` 为真，340ms 后才 `scene.start` |
| V9 | 防连点 | 渐黑期间再按 J，`scene.start('Run')` 只发生一次 |
| V10 | 种子腐烂 | `seeds=100, plots=9` → 结算后 78；`seeds=9` → 不变；`seeds=0` → 0 |
| V11 | 腐烂不吞掉播种量 | 任意输入下结算后 `seeds >= min(原值, plots)` |
| V12 | 结算卡显示腐烂量 | 文案含「腐烂」与具体数量，且只在真的腐烂时出现 |
| V13 | 商店改名 | 面板标题为「商店」，zone.name 也是 |
| V14 | 能买田地 | 点「农场田地+1」→ 扣 3000、plots +1、返回 `{ok:true}` |
| V15 | 钱不够 / 满额被拒且不扣钱 | 2999 → `{ok:false}` 且 coins 不变；27 块 → 拒绝 |
| V16 | 初始田地数不变 | 新档 `plots.length === 9` |
| V17 | 农场翻页 | 第 1 页无左箭头有右箭头；末页有左无右；中间页两个都有 |
| V18 | 翻页显示正确的田 | 第 2 页的第 1 块 = 绝对索引 9 的那块 |
| V19 | 基地有虫鸣 | Hub 场景内 `ambientName() === 'cricket'` |
| V20 | 离开基地停虫鸣 | 进关卡后 `ambientName() === null` |
| V21 | 虫鸣可调 | 拖「环境音」滑块只改 ambientGain，masterGain 不动 |
| V22 | 环境音滑块有默认值 | 老存档（无 `settings.ambient`）读出 0.30，不是 undefined/NaN |
| V23 | 既有 1679 条断言不减少 | 六个套件全部 exit 0，总数只增 |

---

## 7. 实施者决断记录（PM 未指定，事后可推翻）

| 项 | 取值 | 理由 |
|---|---|---|
| 田地单页 | 9 块（3×3） | 与现行布局一致，`farmLayout` 不用重写几何 |
| 田地上限 | 27 块（3 页） | 18 块 × 3000 = 54,000 铜币，长线目标足够；再多页面没有观赏价值 |
| 田地单价 | 3000 固定（不涨价） | PM 明确说「每块田地售价 3000 金币」，不擅自做递增 |
| 种子腐烂率 | 超过「田地数」的部分每局 25% | 见 §3.5 |
| 环境音默认值 | 0.30 | 与总音量默认值一致 |
| 虫鸣长度 | 8 秒循环缓冲 | 8 秒内蟋蟀脉冲约 26 次，听不出循环点 |
| Boss 手臂节数 | 6 节 | 少于 4 节像棍子，多于 8 节每帧计算浪费 |
| 渐黑时长 | 340ms（照抄农场） | 与既有节奏一致，不自创新数值 |
