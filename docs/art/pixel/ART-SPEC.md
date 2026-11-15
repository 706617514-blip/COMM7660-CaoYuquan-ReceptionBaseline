# 像素风美术规格（样片用）

**来源**：全部来自权威资料，不是我的审美判断。
- Stardew Valley 官方风格指南 *A Guide To Being Stylish*（Sundrop 团队，10 页 PDF）
  https://web.archive.org/web/20220204164234/https://sundrop.kvdk.net/files/SundropArtGuide.pdf
- Stardew Modding Wiki: Tutorial: How to make pixel art
  https://stardewmodding.wiki.gg/wiki/Tutorial:_How_to_make_pixel_art
- Smithsonian: Designing Easter Eggs（彩蛋图案参考）
  https://www.si.edu/stories/designing-easter-eggs

---

## 一、调色板（硬规则）

| # | 规则 | 依据 |
|---|---|---|
| P1 | **一个精灵最多 6–8 色** | Sundrop："six or eight different colors at most"，只有最复杂的资产才破例 |
| P2 | **绝不用纯黑或纯白** | Sundrop："Never use pure black or white"，一切都要有色相 |
| P3 | **描边 = 该精灵最暗的颜色** | Sundrop："Outlines are your darkest color"，其余（含阴影）都比描边亮 |
| P4 | **高饱和** | Sundrop："almost too saturated"，做灰了必须有理由 |
| P5 | 服装/皮肤 **3–4 阶**，头发 **4–5 阶** | SMW Wiki |
| P6 | **阴影换色相，不是降亮度** | Sundrop：黄→橙，不是黄→暗黄 |
| P7 | 阴影偏冷、高光偏暖 | SMW Wiki："shift shadows to a cooler hue and highlights to a warmer hue" |

## 二、光照（可计算的规则）

| # | 规则 | 依据 |
|---|---|---|
| L1 | **光源在右上、略偏前** | SMW Wiki："top-right & slightly forward" |
| L2 | 因此：**右肩 > 左肩**、右脸 > 左脸、头发右上 > 左上 | 同上 |
| L3 | 投影：黑色 **40% 不透明**，**左 1px / 下 2px** | SMW Wiki |

> L1 的价值：它把"这里该不该更亮"从审美判断变成**几何判断**
> （这个像素相对重心的位置是右上还是左下）。可以算，不用凭感觉。

## 三、抖动（四选一，不是凭感觉）

| # | 情形 | 做法 | 依据 |
|---|---|---|---|
| D1 | 投影（物体投在下方物体上） | **实心** | Sundrop |
| D2 | 整个侧面在阴影里 | **实心** | 同上 |
| D3 | 阴影是物体**曲面**的一部分 | **抖动** | 同上 |
| D4 | 只有**局部**在阴影里 | **抖动** | 同上 |

## 四、透视（与本项目架构一致）

> **"一切表现高度的东西都压平到地面上，只有深度留在垂直轴上"**
> —— 像一本压平的立体书（Sundrop）

本项目的 `toScreen(x, z, h)` 正是这个范式：`z`（深度）走垂直轴，`h`（高度）压平。
**所以换画风不需要动渲染逻辑**，只换贴图。

## 五、本项目样片的尺寸

| 类型 | 尺寸 | 依据 |
|---|---|---|
| 主角 | 40×60（**直接画，不缩放**） | 现有运行时尺寸；像素风的核心优势是不必降采样 |
| 装备 | 40×60（与主角同尺寸，对齐） | 现有分层结构 |
| 敌人 | 40×60 | 现有 |
| 地图块 | 32×32 | Terraria 是 16×16，星露谷是 16×16；32 更适合本项目的 960×600 画布 |

> **关键差别**：现在的管线是「96×144 精细图 → LANCZOS 降到 40×60」，
> 降采样会糊掉细节（downsample_for_game.py 的注释自己承认了）。
> 像素风**直接在 40×60 画**，不存在这个问题。
