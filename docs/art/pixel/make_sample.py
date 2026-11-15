#!/usr/bin/env python3
"""
把 1024×1024 的生成图处理成项目可用的像素风资产。

三个关键动作，每个都有理由：

1) **抠洋红底**。生成时用 #FF00FF 做键色（像素素材的标准做法：颜色极端、
   不易与角色撞色）。这里用**到背景色的欧氏距离**做判据，而不是逐通道阈值 ——
   实测背景是 RGB(241,19,242)，有轻微噪声，逐通道阈值会漏掉边缘留下毛边。

2) **整数倍降采样**。像素风的铁律：缩放系数必须是整数，否则方块像素被
   插值成不等宽矩形，观感立刻变糊。1024 → 256 是 4:1。

3) 必须用 NEAREST，不能用 LANCZOS —— 后者会平滑掉像素边缘，
   把"方格"糊成"渐变"，那就不是像素风了。
   （注意：这与本项目既有的 downsample_for_game.py 相反 ——
    那里处理的是精细手绘图，这里处理的是像素图，需求正好相反。）
"""
from PIL import Image
import numpy as np

SRC = "docs/art/pixel/samples/01-hero-raw-1024.png"
OUT_DIR = "docs/art/pixel/samples"

im = Image.open(SRC).convert("RGB")
arr = np.array(im).astype(int)
print(f"源图: {im.size}")

# ---- 1) 抠洋红底（用距离判据）----
BG = np.array([241, 19, 242])
dist = np.sqrt(((arr - BG) ** 2).sum(axis=2))

alpha = np.full(arr.shape[:2], 255, dtype=np.uint8)
alpha[dist < 60] = 0        # 明确是背景
# 边缘带：60~140 之间按距离线性给半透明，避免硬锯齿
band = (dist >= 60) & (dist < 140)
alpha[band] = ((dist[band] - 60) / 80 * 255).astype(np.uint8)
# 140 以上是不透明的角色

rgba = np.dstack([arr.astype(np.uint8), alpha])
out = Image.fromarray(rgba, "RGBA")
print(f"判定为背景的像素: {int((alpha == 0).sum())} / {alpha.size}")

# 裁到内容
bbox = out.getbbox()
out = out.crop(bbox)
print(f"裁到内容: {out.size}")

# ---- 2) 整数倍降采样 ----
saved = []
for factor in (4, 3, 2):
    w, h = out.width // factor, out.height // factor
    if w >= 30 and h >= 30:
        small = out.resize((w, h), Image.NEAREST)   # ★ 必须 NEAREST
        p = f"{OUT_DIR}/02-hero-{factor}x.png"
        small.save(p)
        saved.append((factor, small.size))
        print(f"降 {factor} 倍 → {small.size}")

# ---- 3) 切四个姿势 ----
half = Image.open(f"{OUT_DIR}/02-hero-4x.png")
W, H = half.size
for i in range(4):
    x0, x1 = int(W * i / 4), int(W * (i + 1) / 4)
    pose = half.crop((x0, 0, x1, H))
    bb = pose.getbbox()
    if bb:
        pose = pose.crop(bb)
    pose.save(f"{OUT_DIR}/pose-{i}.png")
    print(f"  pose-{i}: {pose.size}")
