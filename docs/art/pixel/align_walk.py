#!/usr/bin/env python3
"""
把 8 帧走路图对齐成可用的逐帧动画。

## 对齐基准的选择（这一步的成败全在这里）

第一版用【包围盒中心】对齐 —— 失败。
实测各帧包围盒宽度 315~475px（差 50%），因为走路时两腿张开、
斗篷飘动都会让包围盒变宽。**包围盒不是稳定参考点。**

改用【头部中心】—— 实测 8 帧的头部中心是 320~327
（波动 7px，占画面 0.4%）。**头部在走路时几乎不动，是正确的基准。**

这个结论也适用于其它动画：**找"这个动作里不动的部位"当基准**。
  - 走路 / 奔跑 → 头部
  - 攻击   → 躯干（头会前倾）
  - 受击   → 脚（整体会后退）

## 其它两个问题

- 洋红残留：用距离判据抠像（阈值 70）+ 边缘半透明过渡
- 各帧尺寸不一：统一高度后按头部中心水平对齐、脚底垂直对齐
"""
from PIL import Image
import numpy as np

D = "/Users/f1gment/Library/Application Support/dsh-desktop/harness/game-material-master/sequence-jobs/smwi4d50b92f2bf"
OUT = "docs/art/pixel/walk-test"
BG = np.array([241, 19, 242])
W, H = 40, 60
TARGET_H = 54          # 留点余量

def head_center_x(arr, mask):
    """取画面顶部 25% 区域的内容水平中心 —— 走路时的稳定参考点。"""
    h = arr.shape[0]
    zone = mask[:int(h * 0.25), :]
    cols = np.where(zone.sum(axis=0) >= 3)[0]
    if len(cols) == 0:
        return arr.shape[1] / 2
    return (cols[0] + cols[-1]) / 2

print("=== 抠像 + 求各帧头部中心 ===")
records = []
for i in range(8):
    im = Image.open(f"{D}/frames/f0{i}.png").convert("RGB")
    arr = np.array(im).astype(int)
    dist = np.sqrt(((arr - BG) ** 2).sum(axis=2))
    mask = dist >= 70
    alpha = np.full(arr.shape[:2], 255, dtype=np.uint8)
    alpha[dist < 70] = 0
    band = (dist >= 70) & (dist < 150)
    alpha[band] = ((dist[band] - 70) / 80 * 255).astype(np.uint8)
    img = Image.fromarray(np.dstack([arr.astype(np.uint8), alpha]), "RGBA")
    bb = img.getbbox()
    hx = head_center_x(arr, mask)
    records.append({"i": i, "img": img, "bbox": bb, "head_x": hx})
    print(f"  帧{i}: 包围盒{bb}  头部中心x={hx:.0f}")

print()
print("=== 统一高度 + 按头部中心对齐 ===")
# 参考头部中心：取中位数
med_head = float(np.median([r["head_x"] for r in records]))
print(f"  头部中心中位数: {med_head:.1f}")
# 画布上，头部中心放在略偏左的位置（角色朝右，给前方留空间）
target_head_x = 19

aligned = []
for r in records:
    img = r["img"]
    k = TARGET_H / img.height
    nw = max(1, round(img.width * k))
    s = img.resize((nw, TARGET_H), Image.LANCZOS)

    # 该帧头部中心缩放后的位置
    head_in_s = (r["head_x"] - r["bbox"][0]) * k
    # 要让 head_in_s 落在 target_head_x
    x = round(target_head_x - head_in_s)
    y = H - TARGET_H

    cv = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cv.paste(s, (x, y), s)
    aligned.append(cv)
    print(f"  帧{r['i']}: {img.size}→{s.size}  贴到({x},{y})  头部落在 x={head_in_s+x:.1f}")

# 条图
strip = Image.new("RGBA", (W * 8, H), (0, 0, 0, 0))
for i, f in enumerate(aligned):
    strip.paste(f, (i * W, 0), f)
strip.save(f"{OUT}/06-aligned-v2.png")
print()
print(f"已存 {OUT}/06-aligned-v2.png  {strip.size}")

big = strip.resize((strip.width * 6, strip.height * 6), Image.NEAREST)
bgb = Image.new("RGBA", (big.width + 40, big.height + 40), (20, 26, 34, 255))
bgb.paste(big, (20, 20), big)
bgb.convert("RGB").save(f"{OUT}/07-aligned-v2-zoom.png")
print(f"放大预览 {OUT}/07-aligned-v2-zoom.png")
