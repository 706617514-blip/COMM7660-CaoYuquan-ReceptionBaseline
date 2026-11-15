#!/usr/bin/env python3
"""
Contact sheets for reviewing the protagonist asset set.

The set is 172 sprites across 4 views. Reviewing them means seeing every one
of them at a readable size against a checkerboard, grouped so that a single
group's row can be compared at a glance: identity drift, palette drift and
silhouette quality all show up as a ragged row.

Renders at 4x with nearest-neighbour scaling, because the acceptance test is
whether the sprite reads at 1x in the game, and interpolation would hide the
very edge quality being judged.

Groups:
  hero     - hero_base and hero_action, one row per action, one column per view
  equip    - equipment, one row per item, one column per view
  all      - every sprite in the directory
"""

import argparse
import os
import sys

from PIL import Image, ImageDraw

SCALE = 4
CHECKER = 8
PAD = 6
LABEL_H = 16
BG_A = (58, 58, 62)
BG_B = (78, 78, 84)
VIEWS = ["left", "right", "back", "34"]


def checkerboard(w, h):
    im = Image.new("RGB", (w, h), BG_A)
    d = ImageDraw.Draw(im)
    for y in range(0, h, CHECKER):
        for x in range(0, w, CHECKER):
            if ((x // CHECKER) + (y // CHECKER)) % 2:
                d.rectangle([x, y, x + CHECKER - 1, y + CHECKER - 1], fill=BG_B)
    return im


def load(path):
    im = Image.open(path).convert("RGBA")
    return im.resize(
        (im.size[0] * SCALE, im.size[1] * SCALE), Image.NEAREST
    )


def sheet(rows, out, title=None):
    """rows: list of (label, [(view, path)])"""
    if not rows:
        sys.exit("no rows")
    cell_w = max(len(v) for _, v in rows) * 0
    tile_w = max(load(p).size[0] for _, vs in rows for _, p in vs) + PAD
    tile_h = max(load(p).size[1] for _, vs in rows for _, p in vs) + PAD
    ncols = max(len(vs) for _, vs in rows)
    width = tile_w * ncols + PAD
    height = (tile_h + LABEL_H) * len(rows) + PAD + (LABEL_H if title else 0)
    canvas = checkerboard(width, height)
    d = ImageDraw.Draw(canvas)
    y = PAD
    if title:
        d.text((PAD, 2), title, fill=(240, 240, 240))
        y += LABEL_H
    for label, views in rows:
        x = PAD
        for view, path in views:
            im = load(path)
            canvas.paste(im, (x, y), im)
            d.text((x + 2, y + tile_h - LABEL_H + 2), view, fill=(235, 235, 235))
            x += tile_w
        d.text((PAD, y), label, fill=(255, 220, 140))
        y += tile_h + LABEL_H
    canvas.save(out)
    print("%s  %dx%d  %d row(s)" % (out, width, height, len(rows)))
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--indir", default="docs/art/sprites")
    ap.add_argument("--outdir", default="docs/art/sheet")
    ap.add_argument("--group", default="all", choices=["all", "hero", "equip"])
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    files = sorted(f for f in os.listdir(args.indir) if f.endswith(".png"))
    if not files:
        sys.exit("no sprites in %s" % args.indir)

    def find(stem):
        base = stem.rsplit("_", 1)[0]
        view = stem.rsplit("_", 1)[1]
        for v in VIEWS:
            if view == v:
                p = os.path.join(args.indir, "%s_%s.png" % (base, v))
                if os.path.exists(p):
                    return (v, p)
        return None

    stems = sorted({f[:-4] for f in files})
    if args.group == "hero":
        stems = [s for s in stems if s.startswith("hero_")]
    elif args.group == "equip":
        stems = [s for s in stems if s.startswith("eq")]

    bases = sorted({s.rsplit("_", 1)[0] for s in stems})
    rows = []
    for b in bases:
        views = [f for f in (find("%s_%s" % (b, v)) for v in VIEWS) if f]
        if views:
            rows.append((b, views))

    # A single canvas taller than ~8000 px is unwieldy in most viewers, so
    # split by group rather than emitting one enormous image.
    if args.group == "all":
        for name, rows_sub in (
            ("hero", [r for r in rows if r[0].startswith("hero_")]),
            ("equip", [r for r in rows if r[0].startswith("eq")]),
        ):
            if rows_sub:
                sheet(
                    rows_sub,
                    os.path.join(args.outdir, "sheet_%s.png" % name),
                    title="%s asset set" % name,
                )
    else:
        sheet(rows, os.path.join(args.outdir, "sheet_%s.png" % args.group),
              title="%s asset set" % args.group)


if __name__ == "__main__":
    main()
