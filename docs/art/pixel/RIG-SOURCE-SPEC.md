# 骨骼动画基准图规格

**为什么需要这份文档**：骨骼动画的质量 90% 取决于基准图的姿势与拆件方式。
拿一张"好看的立绘"去做骨骼，等于拿照片做木偶。

## 来源（全部是权威资料，不是我的判断）

| # | 来源 | 性质 |
|---|---|---|
| S1 | [Spine 官方：How to cut your assets for animation](https://en.esotericsoftware.com/blog/How-to-cut-your-assets-for-animation)（Esoteric Software, 2025-03-06） | **业界标准工具**的官方拆件规范 |
| S2 | [Model sheet / Turnaround 定义](https://nhance-school.com/tools/glossary/model-sheet-turnaround)（Nhance School，AAA 游戏美术培训） | 主机/PC 大厂的角色原型图规范 |
| S3 | [Stardew Valley 官方风格指南](https://web.archive.org/web/20220204164234/https://sundrop.kvdk.net/files/SundropArtGuide.pdf)（Sundrop 团队） | 目标画风的依据 |

---

## 一、姿势：必须是 bind pose（S2）

> Model sheet 使用**中性姿势**，如 **T-pose 或 A-pose**，便于建模与绑骨。
> **Bind pose** = "the neutral pose a mesh is skinned in"

| # | 要求 | 依据 |
|---|---|---|
| P1 | **正面或接近正面**，不要 3/4 视角 | S2：各视角要对齐在共享参考线上 |
| P2 | **双臂微微张开（A-pose）**，不要贴紧身体 | 上一条的实践；贴紧会导致拆件器分不清左右臂 |
| P3 | **双腿分开**，不要并拢 | 并拢时左右腿几乎一样，拆件器会重复 |
| P4 | **不要有遮挡手臂的斗篷/披风** | 遮挡会让拆件器拿不到完整肢体 |

> **本项目上一版失败的直接原因**：那张图是 **3/4 视角 + 手臂贴身体 + 斗篷遮臂**，
> 三条全部违反 P1–P3，所以拆件器报 "left/right-upper-arm 同向重合 0.97"。

## 二、拆件：Spine 官方六条（S1）

| # | 规则 | 原文要点 |
|---|---|---|
| R1 | **被遮挡的部分也要画出来** | "draw even the parts that are usually covered" —— 否则旋转时会露出空隙 |
| R2 | **关节处画成接近圆形** | "aim to leave an area as close to a circle as possible where the joints overlap" —— 圆形收尾能保证旋转时**不露缝**且**转动范围最大** |
| R3 | **直的图更好弯** | 需要弯曲的部件要先画成直的；已经弯的图反向弯会很差 |
| R4 | **越分开，可能性越大** | 每个要动的部件单独一层 |
| R5 | **前后件分层** | 例如斗篷在身前和身后的部分必须分两层；连接点在两层都画，进 Spine 后用同样的权重绑住 |
| R6 | **描边要贯穿关节** | 有描边的画风，肢体**上下都要带描边**，这样旋转时描边不断 |

### R2 是最重要的一条

它解释了"为什么关节要圆"：**圆形的重叠区在任意旋转角度下都不产生空隙**，
而且**能转的角度最大**。这直接决定了走路/挥砍动作好不好看。

### R6 对本项目尤其关键

我们的画风**有描边**（星露谷式单像素深色描边）。
若上臂和小臂各画各的描边、只在关节处切断，旋转时描边会断开。
**正确做法：上下两段在重叠区都带完整描边。**

## 三、层序（本项目既有约定 + S1）

现有 `EQUIP_LAYER_ORDER = ['back', 'torso', 'feet', 'head', 'weapon']` 保留，
但在其内部还要按 R5 细分前后。

| 层 | 内容 |
|---|---|
| back-1 | 斗篷后片 |
| legs-back | 后腿 |
| torso | 躯干、胸甲 |
| legs-front | 前腿 |
| arms-back | 后臂 |
| arms-front | 前臂 |
| head | 头、兜帽 |
| weapon | 武器（挂在手上，见 WEAPON-ATTACH-SPEC.md） |
| cloak-front | 斗篷前片 |

---

## 四、给生成提示词的要求（由上面推导）

| # | 提示词必须包含 |
|---|---|
| G1 | 正面站立、**A-pose**、双臂与身体**有明显间隙** |
| G2 | **双腿分开**站立 |
| G3 | **不穿斗篷/披风**（或披风完全在身后、不遮手臂） |
| G4 | 各部件轮廓**清晰分离**，关节处**可见圆形** |
| G5 | 像素风规格（见 ART-SPEC.md：8 色内、右上光源、描边=最暗色） |

## 五、验收判据

| # | 判据 | 怎么验 |
|---|---|---|
| V1 | 拆件质检通过（无 duplicate-parts） | 工具报 |
| V2 | 左右手臂形状**不同**（有前后/朝向差异） | 目视蒙太奇图 |
| V3 | 左右腿形状**不同** | 同上 |
| V4 | 关节处是圆形而非直角 | 目视 |
| V5 | 六个动画都能生成 | 工具报 |
