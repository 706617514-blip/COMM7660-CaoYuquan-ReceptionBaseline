# 主角动画方案（逐帧精灵图）

## 为什么是逐帧，不是骨骼

之前我说过"骨骼动画与像素风冲突"——**这句话是错的，作废。**
正确的答案来自业界实践：**像素风游戏用逐帧精灵图，不用骨骼动画。**

依据：Spritesheets.ai 的像素图教程（业界标准工作流）
> "32×32 canvas is the sweet spot... **This is the scale used by Stardew Valley**"
> "The walk cycle is the animation players see most. For pixel art at 32x32,
>  **an 8-frame cycle at 10 FPS is standard**"
> "Attack animations need snap and weight. Start with an anticipation frame
>  (wind-up), then 1 to 2 frames of the attack at full extension, followed by
>  2 to 3 recovery frames."

**星露谷是像素风，它有完整动画，方法是逐帧画。** 两者的关系不是冲突，是"像素风本来就该用逐帧"。

## 动画清单（依据上面的标准）

| 动画 | 帧数 | 帧率 | 说明 |
|---|---|---|---|
| **待机 idle** | 4 | 6 fps | 呼吸 1–2px 位移，循环 |
| **走路 walk** | 8 | 10 fps | 标准 8 帧循环 |
| **奔跑 run** | 8 | 14 fps | 同走路但更快、幅度更大 |
| **攻击 attack** | 6 | 12 fps | **前摇 1 → 全力 2 → 收招 3** |
| **受击 hurt** | 3 | 12 fps | 后仰 + 闪白 |
| **跳跃 jump** | 3 | 10 fps | 蹲 → 起 → 落 |
| **技能 skill** | 6 | 12 fps | 抬手 → 释放 → 收 |

合计约 38 帧。**注意攻击必须有"前摇帧"**——没有它，攻击会显得没有重量（教程原话："without it, the attack feels instantaneous and weightless"）。

## 武器问题的正解

依据同一份教程的图层建议：
> "Use layers to separate the body, head, arms, and **any equipment** —
>  this makes animation easier and **lets you swap equipment later**"

**武器不单独贴一张整图**（现在的做法，所以飘在手外），而是：
1. **每个攻击帧里，武器已经画在手上了**（和身体同一张图）
2. 换武器时，用 `ludo toolbox image recolor` **给武器的色块换色**
3. 或者：武器作为**独立小图**，锚点设在握把，跟着"手部坐标表"走

**方案 1 更简单也更可靠**（不用算坐标，不会错位）。

## 产出形式

一张精灵图（spritesheet）+ JSON 元数据：

```
hero-sheet.png     ← 所有帧横向排列
hero-sheet.json    ← { "idle": [0,3], "walk": [4,11], "attack": [12,17], ... }
```

Phaser 加载方式：
```js
this.load.atlas('hero', 'hero-sheet.png', 'hero-sheet.json');
this.anims.create({ key: 'walk', frames: this.anims.generateFrameNames('hero', ...) });
```

`ludo toolbox sprite export --engine texturepacker` 正好能生成这个 JSON。
