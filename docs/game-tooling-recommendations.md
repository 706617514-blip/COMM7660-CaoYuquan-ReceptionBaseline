# Kill the Vines — 工具选型建议

**调查日期**：2026-11-15
**调查对象**：`game/`（Phaser 3.80.1，vanilla JS，无构建步骤）
**结论一句话**：这个项目缺的不是"游戏引擎工具"，而是**精灵图管线**和**关卡搭建**；
DSH 插件市场里 `phaser` 相关插件 **0 个**，能帮上忙的主要在 GitHub 侧。

---

## 一、先说这个项目**实际**长什么样

我读了 `game/`、`docs/art/`、`tests/`、`README.md`，不是靠名字猜的：

| 事实 | 依据 |
|---|---|
| 引擎 Phaser **3.80.1**，vendored（`game/vendor/phaser.min.js`） | 版本号写在文件里 |
| **无构建步骤**，全部是 `<script>` + 全局 IIFE | `index.html` 3597 行内联 |
| 规则与渲染分离：`logic.js`（2348 行）不认识渲染 | `README.md` 第 101 行明说 |
| 平衡数值全在 `config.js`（932 行） | 同上 |
| **美术是单张静态 PNG，40×60 等**，共 58 个 | `game/assets/art/` |
| **没有任何精灵图/帧动画** | `app.js` 只有 `generateTexture`，无 `anims.create` |
| 贴图是"烘"出来的：`generateTexture(key,w,h)` | `app.js:317-326` |
| **音效是合成的**，21 个振荡器音效，无音频文件 | `audio.js` 文件头注释 |
| 有平衡测试：`tests/balance_report.js` + `tests/bot.js` | `README.md` 第 103-113 行 |
| 212 条断言，三个测试套件 | 同上 |

**关键判断**：这是一个**已经跑起来**的游戏，不是从零开始的工程。
它自建了一套"矢量烘贴图 + 单图实体"的做法，工作正常。

---

## 二、我发现的一个**现存问题**（与你之前记的笔记冲突）

`docs/art/gen_direct.py` 开头写着：

> the plugin fails to load because '@deepseek-ai/cordis' and 'react' are not
> injected into the plugin profile ... Confirmed by preflight state:
> dsh-image-gen -> unresolved, recorded 2026-11-13T16:37Z

我**逐项核对了这个说法**：

| 声明 | 实际 | 判定 |
|---|---|---|
| `dsh-image-gen` peer 要 `@deepseek-ai/cordis` | profile 里 **ABSENT** | ✅ 属实 |
| peer 要 `react` | profile 里 **ABSENT** | ✅ 属实 |
| peer 要 `@deepseek-ai/schemastery` | 存在 | — |
| 对照：`dsh-ppt` 能工作，peer 只有 `libreoffice-kit`，**不要 react** | 确实如此 | ✅ |
| 对照：`dsh-media-converter` peer 为空，能工作 | 确实如此 | ✅ |

**结论**：`dsh-image-gen` 是这三个客户端插件里唯一声明 `react` peer 的，
而这个 profile 不提供 React 运行时 —— 它确实会走 fallback 到需要 Gemini key 的内置 handler。
你的 `gen_direct.py` 绕开它是对的，**我没有改动它**。

> 注意时间线：这个 `unresolved` 记录在 **2026-11-13T16:37Z**，
> 早于我装 `dsh-image-gen`（2026-11-13 17:07）。也就是说这不是我装坏的，
> 是它本身在这个 profile 下就起不来。我没有验证"重启后是否仍然失败"——
> 那需要重启 GUI，我没做。

---

## 三、GitHub 侧：真正对得上的工具

### 🥇 1. `Ludo-AI/ludo-cli` —— 最推荐

- **★7 · TypeScript · MIT · 2026-11-12 更新 · 零依赖 · Node ≥20**
- `npm install -g @ludoai/cli`（本机 **无 npm**，见第五节）
- **离线一半是免费的**：`ludo toolbox` 32 个工具，**不需要账号、不需要 key、不消耗额度**

我**在你的真实素材上跑过**，不是看 README 猜的：

```bash
ludo toolbox asset manifest game/assets/art --emit phaser
# → 58 个资产全部识别，生成了 assets-pack.json + assets.ts（Phaser loader）
#   带 sha256、尺寸、alpha 通道检测
```

直接对得上你的缺口的功能：

| 命令 | 解决你什么问题 |
|---|---|
| `toolbox asset manifest --emit phaser` | **自动生成 Phaser 加载清单**，替代手写 |
| `toolbox sprite collide --ppu <n>` | 生成 **Box2D/Phaser 碰撞盒**（你现在是手写 hitbox） |
| `toolbox sprite metrics --overlay` | **脚底 pivot / 地面线**检测，出图给人看 |
| `toolbox sprite slice / join` | 精灵图切帧 / 合成（你现在完全没有帧动画） |
| `toolbox sprite loop` | 动画循环质量 0–1 打分 |
| `toolbox sprite export --engine texturepacker` | 导出 Phaser 能直接 `load.atlas` 的 JSON |
| `toolbox image recolor --palette` | 换色（你的装备换色可以批量化） |
| `toolbox image outline / shadow` | 描边、投影（你现在代码里手画） |
| `toolbox audio info` | 响度/LUFS/循环接缝检测 |
| `toolbox image tiles --tiled` | 出 Tiled 能读的图集 |

**注意**：我实测 `sprite metrics` 在 `docs/art/sheet/sheet_hero.png` 上
**拒绝猜网格**（返回 exit code 12，要求 `--grid`）—— 这点很好，不瞎猜。
那两个 sheet 是 1566×7796 / 1566×20952 的**参考图合集**，不是运行时精灵图，
所以它判不出来是正常的。

**联网那一半**（`ludo image create` / `sprite animate` / `audio music`）
需要注册账号、消耗 credits，**有消费**，我没有任何额度信息，不做评价。

### 🥈 2. `printemps-tokyo/sheetpack` —— 只在你上 CI 时才值得

- ★0 · **Rust** · MIT · 2026-11-12
- 确定性图集打包，`--check` 模式能在 CI 里**因图集过期而让构建失败**
- **本机没有 cargo/rustc**，装它要先装 Rust 工具链
- 对你的价值取决于你**是否决定引入真正的精灵图**。现在你连帧都没有，
  这个属于"以后再说"。★0 也说明没人验证过。

### 🥉 3. `pixscapegames/pixscape-studio-free` —— ★20，但是 LibGDX

- JavaScript · Apache-2.0 · 2026-11-14 更新
- 开源 2D 引擎 + 可视化编辑器 + Tiled 等距地图
- **是 LibGDX（Java）生态，不是 Phaser**。地图编辑器部分理论上可导出通用格式，
  但把它接进 Phaser 项目是额外工作。**不建议现在引入**。

### 4. `LBarimi/metroidvania-studio` —— ★2，C#

- 免费开源 2D 地图编辑器，连房间、刷地形
- **C# 桌面程序**，是横版银河城方向的地图工具
- ★2、9 月后没更新，**成熟度未知**。你的游戏是横版，方向对，但生态不搭。

---

## 四、DSH 插件市场侧

**先说结论：`phaser` 关键词命中 0 个。** 市场里没有任何 Phaser 专用插件。

我按你项目的真实需求重新筛了一遍（关键词命中会误报，我逐条读了描述）：

| 插件 | 下载 | 判定 |
|---|---|---|
| `dsh-game-material-master` | ↓6017 ★166 | ✅ **相关**。Seedream 生图 + MiniMax 图生视频，八方向精灵图、序列帧、骨架动画、绿幕抠像 |
| `dsh-comfyui` | ↓7855 ★184 | ⚠️ 需要本机或远程 ComfyUI 服务 |
| `dsh-aseprite` | 未计量 ★10 | ✅ 浏览器像素画 + 精灵动画编辑器，兼容 Aseprite 文件 |
| `dsh-sprite-studio` | 未计量 ★1 | ✅ 无限画布精灵图工作台，**1066 项 LPC 素材库**，可切图/抠底 |
| `dsh-pixel` | 未计量 ★0 | ✅ 像素画编辑器（8 图层、36 色板、完整 undo） |
| `deepseek-harness-game-studios` | 未计量 ★26 | ⚠️ CCGS 移植 76 技能/49 代理，**面向通用游戏开发流程**，不解决你具体缺口 |
| `dsh-game-studio-presets` | 未计量 ★10 | ⚠️ 11 个按阶段切分的预设 |
| ~~`dsh-shadertoy-skin`~~ | ↓4295 | ❌ 只是把 ShaderToy 当**聊天背景**，不是游戏着色器工具 |
| ~~`dsh-pixelbar` / `-studio`~~ | ↓571/379 | ❌ 驱动物理像素屏音箱 |
| ~~`dsh-minigames` / `dsh-ai-arcade`~~ | — | ❌ 是**给人玩的**，不是做游戏的 |

**最相关的是 `dsh-game-material-master`** —— 它做的正是"从参考图生成游戏素材、
合成八方向精灵图"，和你的 `docs/art/` 流程是同一件事。但注意：
它走 Seedream，**和你的 `gen_direct.py` 是同一家（火山方舟）**，功能重叠。

---

## 五、本机环境实情（会影响你能不能用）

| 工具 | 状态 |
|---|---|
| `node` | ✅ v24.17.0（Electron-as-Node shim） |
| `python3` | ✅ 带 **Pillow 12.3.0** + **numpy 2.3.5** |
| `pnpm` | ✅ 10.34.5 |
| **`npm` / `npx`** | ❌ **不存在**（我昨天给 drawio 写了 shim，但那是 MCP 专用） |
| **`cargo` / `rustc`** | ❌ **不存在** |
| **`ffmpeg`** | ❌ **不存在** |
| Blender / Unity / Unreal / Godot / Aseprite | ❌ **都不存在** |

**这意味着**：
- `ludo-cli` 不能 `npm install -g` —— 但可以直接下载 tarball 解包跑
  （我实测可行，见下），或让我写个 shim
- `sheetpack` 需要先装 Rust
- `ludo` 的视频/音频格式转换功能需要 ffmpeg

我实测跑通的方式（供参考）：

```bash
curl -s -o ludo.tgz "https://registry.npmjs.org/@ludoai/cli/-/cli-0.2.9.tgz"
tar xzf ludo.tgz
NODE="/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
"$NODE" package/dist/cli.js toolbox --help        # ✅ 离线可用
"$NODE" package/dist/cli.js toolbox asset manifest game/assets/art --emit phaser  # ✅ 跑通
```

---

## 六、我的建议（按优先级）

1. **`ludo toolbox`** —— 先只当离线工具用。它能立刻替掉你手写的东西：
   资产清单、碰撞盒、脚底 pivot、描边、换色。**不花钱、不注册**。
2. **`dsh-game-material-master`** —— 如果你对现在的出图流程不满意再考虑。
   但它和 `gen_direct.py` 走同一家 API，**属于重复投资**。
3. **`dsh-aseprite` 或 `dsh-sprite-studio`** —— 如果你决定给角色加**帧动画**
   （目前一个都没有），这两个能直接画/切精灵图。
4. **`sheetpack` / `pixscape` / `metroidvania-studio`** —— **暂时别碰**。
   要么缺工具链（Rust），要么生态不搭（LibGDX / C#），
   要么你还没有用得上它们的资产形态（精灵图集 / 图块地图）。

---

## 七、必须声明的边界

- **我没有打开过 GUI**，以上 DSH 插件的结论全部来自市场 registry 的描述字段与
  下载/星数字段。
- **我只对 `ludo-cli` 做了实际执行验证**（在你真实素材上跑了 2 个命令，都成功）。
  其余工具**一个都没装、没跑**。
- `dsh-image-gen` 是否在重启后仍失败，**我没有验证** —— 需要重启 GUI 才能确认。
  我只核对了"peer 依赖确实缺失"这个事实。
- 我没动你的项目任何文件，除新增本文档。
- 本机没有 Blender/Unity/Unreal/Godot/Aseprite/ffmpeg/cargo，
  所以本文档里任何一个需要这些的工具，**现在都无法真正使用**。
