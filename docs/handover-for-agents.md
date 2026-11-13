# 接手说明（给下一个 AI 会话 / 换供应商后接着干）

**如果你是一个新会话、新的模型、或者换了供应商后被叫来接手，先读这一页。**

读完你应该能在 5 分钟内接着干活，不需要人重述。

---

## 1. 这是什么项目

COMM7660 课程作业，学生 Cao Yuquan，学号 26366290。分两阶段：

- **Phase 1（已完成，冻结）**：Steam 好评率的统计分析。冻结在 tag `phase1-analytics` → `3e7f65e`。
  数据集指纹 `67eaeb6d965ae0d2109c411896f1f12a88d52459520e1f993b2369a77d0c2875`（CI 强制校验）。
  **Phase 1 的任何东西都不许动。**
- **Phase 2（进行中）**：交付一个浏览器游戏《Kill the Vines》并做用户测试。
  截止 **2026-11-19**。

## 2. 项目硬规矩（`AGENTS.md` 与 `$DSH_HOME/AGENTS.md`）

- **不许编造**：用户反馈、试点记录、执行声明、CI 运行链接，一律不许编。
  编造直接违反作业条款。没有证据就写「尚无证据」。
- **不许代签**：`records/approvals.md` 的四个审批点、`records/independent-verification.md`
  的验证工作表、`evaluation/observation-sheet.csv` 的观察行，**只能本人填**。
- **主张强度 ≤ 证据强度**：测试绿了不等于功能对；CI 绿灯不等于验证了新东西。
- 代码任务要加载技能：`test-driven-development` + `verification-before-completion`（至少）；
  声称「完成」前必须已加载后者。

## 3. 现在在哪（读的时候先核对）

```bash
cd /Users/f1gment/Documents/7660
git status --short          # 必须是空的
git log --oneline -5
git branch --show-current   # feat/backpack-audio-settings
```

- 工作分支：`feat/backpack-audio-settings`（**绝不在 main 上实现**，main 有分支保护：
  5 个必需检查、`strict: true`、禁 force-push）
- PR #2 开着：<https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/pull/2>
- **线上只部署 main**（`deploy-pages.yml` 触发条件是 `push: branches: [main]`），
  所以线上是旧版本。要看新版必须用本地预览。

## 4. 怎么跑

```bash
# 本地预览（给用户和自己看新版游戏）
cd game && python3 -m http.server 8788 --bind 127.0.0.1
# → http://127.0.0.1:8788/

# 六个测试套件（逐个跑，不要用 && 串起来，否则失败会掩盖）
node tests/check_textures.js
node tests/test_audio.js
node tests/test_bag.js
node tests/test_game_logic.js
node tests/test_game_meta.js
node tests/test_game_page.js
ELECTRON_RUN_AS_NODE='' node tests/browser/smoke.js
```

**环境事实（踩过的坑）**：

- `npm` 不存在，只有 `pnpm`（10.34.5）。查 npm 包用 `curl https://registry.npmjs.org/<pkg>`。
- macOS **没有 `timeout` 命令**，要限时用 `run_in_background: true`。
- 跑 smoke 前 `lsof -nP -iTCP:8123` 确认空闲。smoke **独占 8123，不能并行跑**。
  端口被占通常是残留孤儿 Electron（PPID=1，user-data-dir `/tmp/emberfield-browser-*`）。
  清理时**别杀 DSH 自己的进程**。临时探针用 8132。
- `ELECTRON_RUN_AS_NODE` 必须置**空字符串**（`ELECTRON_RUN_AS_NODE=''`），
  否则 Electron 以 node 模式启动并报 `Cannot find module 'electron'`。
- 内置 node：`/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node`

## 5. 代码结构

| 文件 | 职责 | 行数级 |
|---|---|---|
| `game/config.js` | **所有数值**（价格、概率、时长、上限） | ~740 |
| `game/logic.js` | **纯模拟**，不许有 DOM/Phaser/storage | ~2200 |
| `game/hub.js` | 基地规则、点位、面板动作（`zoneActions`/`perform`） | ~466 |
| `game/profile.js` | 存档序列化 / 迁移 / 导出码 | ~126 |
| `game/sprites.js` | 纹理 → dataURL、按内容紧裁切 `fitUrl` | ~190 |
| `game/baghud.js` | 背包 DOM 浮层 | ~1100 |
| `game/audio.js` | WebAudio 合成器（**自建 AudioContext**，不是 Phaser 的） | ~314 |
| `game/app.js` | Phaser 表现层（Boot/Hub/Run/Farm 四个场景） | ~3200 |
| `game/index.html` | DOM 覆盖层：面板、背包、ESC 菜单、toast | ~1300 |

**渲染器是 CANVAS**（`Phaser v3.80.1 (Canvas | Web Audio)`），不是 WebGL。
所有美术除 6 张 boss PNG 外都是 `Graphics.generateTexture` 烘出来的。

## 6. 测试怎么写（`tests/browser/smoke.js` 不是 Playwright！）

这是最容易踩的坑。`smoke.js` 里 `page.` / `keyboard.press` / `evaluate(` **一次都不存在**。
真实结构是两段式：

```js
// 页面内：从 :108 起的模板字符串 SCRIPT，是个 (async function(){...})()
//   助手：wait(ms)、key(t, code, kc)
//   读状态用 window.EmberfieldApp.__state（不是 window.__game.state）
//   结果写 out.xxx，最后 return out;
// Node 侧：ok(cond, label, detail) 读 r.xxx
```

**硬规则**：`SCRIPT` 是模板字符串，其中的注释与代码
**不许出现反引号、`${`、以及单个反斜杠**（正则 `\s` 必须写成 `\\s`）。
踩过两次：一次反引号让整个 smoke 文件 `SyntaxError`，一条都跑不了；
一次 `\s` 被吞变成 `s`，断言对着正确实现假红。

## 7. 进度（做到哪了）

已完成并逐条独立验收：**Task 1–25**。

- 第一批（Task 1–21，设计 `2026-11-12-backpack-audio-settings-design.md`）：
  背包系统（5×7 格、6 页、整理、右键出售、批量出售）、装备收集（35 件全收不删）、
  21 个音效、ESC 菜单与滑块、基地错落与键帽、攻击 +5%、
  兵器架/铁匠铺贴图与部位页签、药水改名（治疗/力量/护盾）、商店卖背包页、排序加稀有度。
- 第二批（Task 22–25，设计 `2026-11-13-boss-anim-audio-farm-design.md`）：
  进关卡渐黑 + 防连点、种子超额腐烂、脚步/胜负/虫鸣音效与环境音滑块、
  商店买田地（3000/块、最多 27 块）+ 农场翻页箭头、Boss 程序化藤蔓动作（idle/walk/windup/strike）。

当前断言数：**2,162**
（audio **225** / bag **184** / logic **611** / meta **313** / page **195** /
bosspose **96** / smoke **538**；`check_textures` 无计数框架）。
CI 已接线全部套件（`.github/workflows/ci.yml`，含 `test_bag`、`test_audio`、`test_bosspose`）。

## 8. 只有用户本人能做的事（AI 绝对不许代做）

1. 合并 PR #2（分支保护要求本人点击）
2. 在 `records/approvals.md` 勾选并签署 Approval 4 的 Phase 2 空白块
3. 跑 5–8 人用户测试，把结果填进 `evaluation/observation-sheet.csv`
4. 补 Phase 2 的独立验证工作表（Phase 1 那份在 `records/independent-verification.md`）
5. 试听全部音效（AI 听不到，只能看波形参数）

详细步骤在 `docs/handover-checklist.md`（中文大白话，含每步要点与链接）。

## 9. 当前已知的、故意没修的东西

- 窄高武器（剑/杖）在兵器架与背包小格里偏细（内容高宽比 0.52~0.96，最窄的剑画出来 7px 宽）。
  改法是给武器单独一套横放图标，属美术工作量。
- 熔炉终局胜率 97.75%（阈值 0.98，只差 0.25pp）。已用对照实验证明
  「加强熔炉倍率」是错杠杆（中间档 36.5% → 3.0% 的悬崖），正确杠杆是
  「只对终局生效的缩放」，属设计变更、需 PM 批准。**没有擅自改。**
- 平衡：半满 × 熔炉 +8.3pp（越过 8pp 判据），已如实记录在 PR 描述与证据文档里。
- **Boss 蓄力光效盖住手臂中段**：蓄力粒子在 `bossGfx`（depth 1400），手臂层是
  `1000 - z + 1`（约 896），所以 windup 时手臂中段被光晕冲淡，只剩头尾露在外面。
  要修就得把手臂抬到 1401+，那会破坏"和躯干同层次、按 z 排序"的规则（Boss 在后面时
  手臂会盖住挡在它前面的怪）。**没有擅自改**，属需要权衡的取舍。
- **Boss 手臂在 1x 下偏细**：已从任务书原定的 7→2.5 加粗到 10→4（落屏 5.2→2.1 CSS px）。
  再粗会开始像"两根香肠"。旋钮是 `C.BOSS.armWidthRoot/armWidthTip`。
- **Boss 只有 idle/walk/windup/strike 四个姿态**，没有受击硬直、没有死亡动画
  （用户原话是"包括但不限于走路、抬手"，这两条已满足）。要加受击后仰，
  在 `game/bosspose.js` 的 `compute` 里加一个 `hit` 分支即可，纯函数层好加。

## 10. 会话中断/换供应商后怎么接

所有进度都在 git 里，不在对话里。接手时：

```bash
git log --oneline -10                    # 看最近做了什么
git status --short                       # 看有没有未提交的东西
ls .superpowers/sdd/*/                    # 看任务简报与 ledger（被 gitignore，不入库）
```

`.superpowers/sdd/2026-11-12-backpack-audio-settings/` 下有每个任务的
`task-N-brief.md`（派发用的完整任务书）与 `task-N-report.md`（实施者回报），
`progress.md` 是总的 ledger（含预检表、共享文件矩阵、冲突裁决）。

**接手后第一件事**：跑一遍六个套件确认基线真的是绿的，再去改东西。
不要相信文档里写的断言数 —— 自己数。
