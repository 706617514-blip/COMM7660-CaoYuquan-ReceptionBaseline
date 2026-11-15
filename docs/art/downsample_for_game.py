#!/usr/bin/env python3
"""Downsample the 96x144 art to the game's 40x60 runtime texture size.

Why this exists
---------------
The art was authored at 96x144 (the art brief's spec). The game draws every
sprite into a 40x60 texture: `g.generateTexture('hero', 40, 60)` and the same
for each equipment layer. Both are 2:3, so the mapping is a clean scale by
0.4167 with no distortion - but the downscale is destructive, and it has to be
done with the right filter or the woodcut's fine hatching turns to mud.

Pillow's LANCZOS is used rather than NEAREST: at this ratio NEAREST drops
roughly 5 of every 6 pixels, which shreds the hatching and breaks the silhouette
into disconnected specks. LANCZOS averages the neighbourhood instead, which
keeps the shapes readable. The result is then re-quantised so the game still
sees a small palette.

Output: game/assets/art/<name>.png at 40x60.
"""

import argparse
import os
import sys

from PIL import Image

SRC_W, SRC_H = 96, 144
DST_W, DST_H = 40, 60


def downsample(src, dst, colors=24):
    im = Image.open(src).convert("RGBA")
    if im.size != (SRC_W, SRC_H):
        im = im.resize((SRC_W, SRC_H), Image.LANCZOS)

    small = im.resize((DST_W, DST_H), Image.LANCZOS)

    # Keep hard alpha: a soft alpha edge at 40x60 reads as a blurry smudge and
    # the game's setAlpha flicker multiplies it further.
    px = small.load()
    for y in range(DST_H):
        for x in range(DST_W):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 110 else 0)

    # Re-quantise the visible pixels onto a small palette, same approach as the
    # 96x144 pipeline: build the palette from opaque pixels only so the
    # anti-aliased rim does not consume entries.
    rgb = small.convert("RGB")
    alpha = small.getchannel("A")
    ap = alpha.load()
    body = Image.new("RGB", small.size)
    bp = body.load()
    for y in range(DST_H):
        for x in range(DST_W):
            if ap[x, y] > 200:
                bp[x, y] = rgb.getpixel((x, y))

    pal = body.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    palette = pal.getpalette()
    entries = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)][:colors]

    out = Image.new("RGBA", small.size, (0, 0, 0, 0))
    op = out.load()
    cache = {}
    for y in range(DST_H):
        for x in range(DST_W):
            if ap[x, y] <= 8:
                continue
            c = rgb.getpixel((x, y))
            hit = cache.get(c)
            if hit is None:
                best, bd = entries[0], None
                for e in entries:
                    d = ((c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2)
                    if bd is None or d < bd:
                        bd, best = d, e
                hit = cache[c] = best
            op[x, y] = (hit[0], hit[1], hit[2], 255)

    out.save(dst)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sprites", default="docs/art/sprites")
    ap.add_argument("--outdir", default="game/assets/art")
    ap.add_argument("--colors", type=int, default=24)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    files = sorted(f for f in os.listdir(args.sprites) if f.endswith(".png"))
    if args.limit:
        files = files[: args.limit]

    ok = 0
    for i, f in enumerate(files, 1):
        dst = os.path.join(args.outdir, f)
        try:
            downsample(os.path.join(args.sprites, f), dst, args.colors)
            ok += 1
            if i % 20 == 0 or i == len(files):
                print(f"[{i}/{len(files)}] {f}")
        except Exception as e:
            print(f"FAIL {f}: {type(e).__name__}: {e}")
    print(f"\ndone: {ok}/{len(files)} -> {args.outdir} ({DST_W}x{DST_H})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
