#!/usr/bin/env python3
"""
走路动画的最终处理：对齐 → 统一画布 → 强制调色板。

画布从 40 宽放宽到 48，因为实测帧宽 43px，
40 会把角色裁掉边（这正是上一版仍有漂移感的原因之一）。

调色板用与主角静立图**同一套**（docs/art/pixel/palettes/ktv-hero.txt），
这样走路帧和静立帧的颜色完全一致 —— 换动画时不会闪色。
"""
from PIL import Image
import numpy as np

D = "/Users/f1gment/Library/Application Support/dsh-desktop/harness/game-material-master/sequence-jobs/smwi4d50b92f2bf"
OUT = "docs/art/pixel/walk-test"
BG = np.array([241, 19, 242])
W, H = 48, 64
TARGET_H = 58

def head_center_x(arr, mask):
    h = arr.shape[0]
    zone = mask[:int(h * 0.25), :]
    cols = np.where(zone.sum(axis=0) >= 3)[0]
    return (cols[0] + cols[-1]) / 2 if len(cols) else arr.shape[1] / 2

# ---- 1) 抠像 + 取头部中心 ----
recs = []
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
    recs.append({"img": img, "bbox": img.getbbox(), "head_x": head_center_x(arr, mask)})

med_head = float(np.median([r["head_x"] for r in recs]))
target_head_x = 22          # 48 宽画布上偏左一点，给面朝方向留空间

# ---- 2) 对齐 ----
frames = []
for r in recs:
    img = r["img"]
    k = TARGET_H / img.height
    nw = max(1, round(img.width * k))
    s = img.resize((nw, TARGET_H), Image.LANCZOS)
    head_in_s = (r["head_x"] - r["bbox"][0]) * k
    x = round(target_head_x - head_in_s)
    cv = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cv.paste(s, (x, H - TARGET_H), s)
    frames.append(cv)

# ---- 3) 拼条图 ----
strip = Image.new("RGBA", (W * 8, H), (0, 0, 0, 0))
for i, f in enumerate(frames):
    strip.paste(f, (i * W, 0), f)
strip.save(f"{OUT}/08-final-pre-palette.png")
print(f"对齐完成: {strip.size}")

# ---- 4) 强制调色板（用 ludo）----
import subprocess
r = subprocess.run([
    "ludo", "toolbox", "image", "recolor",
    f"{OUT}/08-final-pre-palette.png",
    "--palette", "docs/art/pixel/palettes/ktv-hero.txt",
    "--out", OUT,
], capture_output=True, text=True)
print("recolor:", r.stdout.strip() or r.stderr.strip()[:200])

# 找出 recolor 的输出文件
import glob, os
cands = sorted(glob.glob(f"{OUT}/08-final-pre-palette*.png"), key=os.path.getmtime)
palette_file = cands[-1] if len(cands) > 1 else None
if palette_file:
    print(f"调色板化输出: {palette_file}")
    im = Image.open(palette_file).convert("RGBA")
    im.save(f"{OUT}/09-final-48x64.png")
    print(f"最终条图: {im.size}")

    # 放大预览
    big = im.resize((im.width * 6, im.height * 6), Image.NEAREST)
    bgb = Image.new("RGBA", (big.width + 40, big.height + 40), (20, 26, 34, 255))
    bgb.paste(big, (20, 20), big)
    bgb.convert("RGB").save(f"{OUT}/10-final-zoom.png")
    print(f"放大预览: {OUT}/10-final-zoom.png")
