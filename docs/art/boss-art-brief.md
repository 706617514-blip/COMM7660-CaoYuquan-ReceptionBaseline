# 藤蔓 Boss 美术方向简报

按 `create-game-assets` 技能的流程编写（步骤 1–4：勘察 → 锁定技术参数 → 定义视觉语言 → 建素材清单）。

**当前状态：等待生成工具。** 本机无图像生成能力；AIMC 平台可达但需 SSO 登录
（见 `aimc-platform-probe.md`）。本简报可在登录后直接作为生成提示词的依据。

---

## 1. 勘察现有画面（步骤 1）

**不重新设计美术方向，沿用现有语言。** 这是技能明确要求的：*"Preserve a coherent existing
direction unless the user asks for a redesign."*

| 现有元素 | 实测规格 | 来源 |
|---|---|---|
| 主角 | 40×60 px，侧视，深色描边 + 受光面 | `game/app.js` `hero` |
| 爬虫 / 冲刺虫 / 吐酸虫 | 46×46 / 46×43 / 50×50 | 同上 |
| 画布 | 960×600，地面基线 y=515 | `game/config.js` |
| 景深带 | z ∈ [0, 210]，屏幕纵向压缩 1.02 | `Z_TO_Y` |
| 配色（植被） | 针叶 `#2f4633` / 阔叶 `#36512f` / 灌木 `#2e4529` | `buildTextures` |
| 配色（敌人） | 爬虫 `#6d9450` / 冲刺虫 `#b8543a` / 吐酸虫 `#5a4d80` | 同上 |
| 描边惯例 | 深色底 + 主体 + 受光面 + 高光（四层） | 全项目一致 |

**结论：** Boss 必须符合"深色底 → 主体 → 受光面 → 高光"的四层惯例，
并在 960×600 的画布上以**侧视**呈现。

---

## 2. 技术参数（步骤 2）

| 参数 | 值 | 理由 |
|---|---|---|
| 视图 | **侧视**（与主角同） | 现有全部角色都是侧视 |
| 原生尺寸 | **240×220 px** | 约为主角的 4 倍体积；960 宽画布上占 1/4 宽，符合"半屏范围技能"的视觉预期 |
| 透明度 | **必须带 alpha 通道** | 否则会盖住地面 |
| 锚点 | **底部中心**（origin 0.5, 1） | 与其他实体一致，贴地绘制 |
| 调色板 | **≤ 32 色** | 与现有敌人一致，避免风格割裂 |
| 帧数 | **静态单帧 + 程序化动态** | 不做逐帧动画；藤蔓的蠕动由代码驱动（旋转/缩放/偏移） |
| 碰撞半径 | 视觉半径的 **0.62 倍** | 视觉可以比判定大，避免"看着没碰到却受伤" |
| 输出格式 | PNG-24 with alpha | 与 Phaser 加载方式一致 |

**为什么不做逐帧动画：** 逐帧需要 8–12 张图，生成与归一化成本高；
而藤蔓怪的蠕动**更适合用代码做**（正弦驱动的多段位移），既能保证平滑，
又能随技能状态实时变化（比如前摇时剧烈抖动）。

---

## 3. 视觉语言（步骤 3）

### 形状语言

- **主体**：不规则块状，**下宽上窄**，像被连根拔起的树桩与藤蔓纠缠
- **触手**：**6 条**，从主体底部放射，长短不一（长 90–160 px）
- **轮廓优先**：在 240px 宽下必须能看出"这是一团会动的藤蔓"，而不是"一坨绿色"

### 轮廓优先级（技能要求：定义"在游戏尺寸下必须存活的特征"）

| 优先级 | 特征 | 在 1× 下是否可见 |
|---|---|---|
| 1 | 6 条触手的外伸方向 | **必须可见** |
| 2 | 主体上宽下窄的剪影 | **必须可见** |
| 3 | 中央的"核心"（发光点） | **必须可见** —— 这是玩家判断攻击方向的依据 |
| 4 | 触手上的尖刺 | 1× 下可省略 |
| 5 | 表皮的纹理纹路 | 仅 3× 下需要 |

### 配色角色

| 角色 | 色值 | 用途 |
|---|---|---|
| 暗部 | `#1a2416` | 轮廓与阴影 |
| 主体 | `#3d5a2a` | 与现有植被同色系，但更深 |
| 受光 | `#6d9450` | **与爬虫同色** —— 强化"同类"的视觉关联 |
| 高光 | `#9ac46a` | 触手尖端与核心边缘 |
| **核心** | `#ff7a3c` | **唯一暖色**，用于前摇预警，与既有 ember 色一致 |
| 中毒/腐蚀 | `#8a3a6a` | 仅地狱难度使用 |

**关键：核心必须是画面中唯一的暖色。** 玩家的躲避反应依赖它，任何其他暖色都会削弱这个信号。

---

## 4. 素材清单（步骤 4）

| 素材 | 尺寸 | 状态 | 用途 |
|---|---|---|---|
| `boss_vine_body.png` | 240×220 | 待生成 | 主体 |
| `boss_vine_tentacle.png` | 60×180 | 待生成 | 触手（6 条复用，各自变换） |
| `boss_vine_core.png` | 64×64 | 待生成 | 中央核心（独立层，便于单独发光） |
| `fx_wave_ring.png` | 256×256 | 待生成 | 范围技能的地面波纹 |
| `fx_shockwave.png` | 384×384 | 待生成 | 全屏技能的地面冲击 |
| `fx_telegraph.png` | 256×256 | 待生成 | 前摇预警圈 |

**若无法生成，降级方案：** 用现有 `Graphics` 绘制等价形状，
并由 `asset_report.py` 验证尺寸/透明度/调色板（脚本已可用）。

---

## 5. 生成提示词（技能提供的模板）

按 `create-game-assets` 的 prompt blocks 结构：

```text
ROLE/PURPOSE: production boss asset for a 2D side-scrolling roguelite
SUBJECT: an enormous vine-and-root monster, a tangled mass pulled from the
         earth, six thick tendrils radiating outward at different lengths
VIEW: strict side view (orthographic), facing right, no perspective
ART DIRECTION: layered flat shapes with one lit face per layer, dark outline
         (#1a2416), body #3d5a2a, lit face #6d9450, highlight #9ac46a,
         single warm-orange core (#ff7a3c) at the centre
GAME-SCALE READ: at 240x220 px the six tendril directions and the
         top-narrow/bottom-wide silhouette must be unmistakable
TECHNICAL OUTPUT: 240x220 px, transparent background, single frame
LOCKS: palette stays within the existing enemy palette; four-layer shading
       convention (dark base, body, lit face, highlight)
EXCLUDE: text, labels, frames, background scenery, ground, duplicate creatures,
         cropped edges, signature, drop shadow
```

---

## 6. 验收标准（步骤 9）

生成后**必须**通过：

```bash
python scripts/asset_report.py boss_vine_body.png \
  --expect-size 240x220 --require-alpha --max-colors 32
```

（脚本位于 `/tmp/gamedev-skills/skills/disciplines/create-game-assets/scripts/`）

并人工核对：

- [ ] 放在**真实游戏背景**（`docs/screenshots/hub.png` 的草地）上看，不是看白底
- [ ] 缩到 **1×（240px）** 时，6 条触手方向仍可辨认
- [ ] 暖色核心是画面中**唯一**的暖色
- [ ] 与爬虫并排时，色调属于同一族

---

## 7. 来源记录（步骤 10）

| 素材 | 来源 | 许可 | 备注 |
|---|---|---|---|
| 待定 | AIMC 平台（待登录） | 课程指定平台 | 生成后记录 workflow 与模型版本 |
| 参考 | Kenney Monster Builder Pack | **CC0** | 仅作形状参考，未直接使用 |
