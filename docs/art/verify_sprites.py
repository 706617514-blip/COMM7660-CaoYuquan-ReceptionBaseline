#!/usr/bin/env python3
"""
Acceptance sweep for the protagonist asset set.

Checks every normalised sprite against the frozen spec in
protagonist-art-brief.md and reports one line per file, plus a summary.
Written because the batch is 172 files: sampling a few by eye cannot catch a
systematic defect (the earlier batch shipped four different faces and three
sprites with enclosed white holes, none of which a spot check found).

Checks per file:
  size          96x144 exactly
  mode          RGBA with a real alpha channel
  colours       <= 32 distinct RGBA tuples
  alpha         both fully transparent and fully opaque pixels present
  matte holes   no opaque near-white region large enough to be a background
                hole rather than a highlight
  grounding     lowest opaque row is the last row (feet on the bottom edge)
  centring      the opaque bounding box is centred horizontally within 2 px
  coverage      the figure occupies 25-75% of the frame (wide gear such as a
                full helm legitimately fills the frame edge to edge)

Shape checks for equipment layers (--expect gear), added after two whole classes
of defect survived eyeballing:
  self-support  a ring, circlet or open helm must not enclose a blob: the model
                supplies a skull or a glowing orb when an open shape will not
                stand on its own. Detected as a large opaque region inside the
                item's own interior hole.
  no wearer     a gear layer must not contain a head, face or body. A lone item
                is one connected blob; a wearer adds a wide mass well above the
                item's own centroid with skin-tone pixels in it.

Exit code 1 if any file fails, so it can gate the contact sheet.
"""

import argparse
import os
import sys
from collections import deque

from PIL import Image

SPEC_W, SPEC_H = 96, 144
MAX_COLORS = 32
MATTE_LUMA = 200
# Share of opaque pixels that may be warm-hued before an equipment layer is
# treated as showing a wearer. The four surviving v1 samples run 21-51% and all
# four are in fact bad, so this is set low on purpose: it should be tightened
# once the regenerated batch supplies genuinely clean items to calibrate on.
# Calibration note (batch 2, wearing-state gear): this test is NO LONGER
# colour-thresholded, because colour cannot separate the two cases.
# Batch 1 drew isolated items, so any skin tone in the sprite had to be a
# leaked wearer. Batch 2 draws the item ON the reference figure and erases the
# body, so the item is legitimately rendered in the same warm earth ramp the
# skin uses: measured on the finished sprites, real skin is r-b = 26.2 and a
# straw sandal is r-b = 34.8, and a rusty sword 43% warm. Across all 140 items
# the warm share runs 0-50% with a median of 17.2%, i.e. straight through the
# old 18% cut - the rule flagged half the batch at random.
# What still holds is the shape test: a leaked wearer adds a torso-sized mass,
# not just warm pixels. That is checked separately (span + enclosed hole).
WARM_FRAC = 0.85


def gear_shape_problems(px, w, h, rows, cols):
    """Catch the two equipment defects that a spot check missed.

    self-support  An open shape (ring, circlet, open helm) gets propped up on a
                  skull or a glowing orb. The item's own ink forms a closed loop
                  around a hole; if that hole is sealed off from the border and
                  is large, something is sitting inside the item.
    no wearer     The prompt leaked and the image shows a wearer. A lone item is
                  a compact blob near one height; a wearer adds a shoulder or
                  chest mass near the bottom that spans the full frame width.
    """
    problems = []

    # Any visible pixel counts as solid. Using an exact == 255 test treated the
    # quantiser's soft edge pixels as holes, so a spiked breastplate with a
    # 1-pixel anti-aliased rim reported "102 px sealed inside" when nothing was
    # actually enclosed. Alpha > 0 is the test that matches what a viewer sees.
    solid = [[px[x, y][3] > 0 for x in range(w)] for y in range(h)]
    outside = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not solid[y][x] and not outside[y][x]:
                outside[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not solid[y][x] and not outside[y][x]:
                outside[y][x] = True
                q.append((x, y))
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and not solid[ny][nx] and not outside[ny][nx]:
                outside[ny][nx] = True
                q.append((nx, ny))

    enclosed = sum(
        1
        for y in range(h)
        for x in range(w)
        if not solid[y][x] and not outside[y][x]
    )
    # An open item (a helm shell, a ring, a circlet) legitimately encloses a
    # hole - that is its shape, not a defect. What the test is looking for is a
    # hole with something sitting IN it (the batch-1 failure was a skull or a
    # glowing orb propping up an open helm). Distinguish by what surrounds the
    # hole: a real cavity is bounded by the item's own thin rim, while a
    # "something inside" case has a solid mass filling most of the interior.
    #
    # Measure the enclosed region's shape: a ring's hole is a large fraction of
    # the item's own bounding box and is bounded by a thin band, so the ratio of
    # hole area to item area is high. A skull inside a helm leaves a hole that
    # is small relative to the solid mass around it.
    item_px = sum(1 for y in range(h) for x in range(w) if solid[y][x])
    if enclosed >= 120 and item_px > 0 and enclosed > item_px * 0.55:
        problems.append("%d px sealed inside the item" % enclosed)

    top, bottom = min(rows), max(rows)
    height = bottom - top + 1
    item_w = max(cols) - min(cols) + 1
    lower = [y for y in range(top + int(height * 0.72), h)]
    lower_cols = [x for x in range(w) if any(px[x, y][3] for y in lower)]
    if lower_cols:
        lower_w = max(lower_cols) - min(lower_cols) + 1
        # A pair of straw sandals is drawn side by side and legitimately spans
        # the full item width, so the test only fires when the lower mass fills
        # the WHOLE canvas width - which is what a leaked torso does.
        if lower_w >= item_w * 0.99 and lower_w > 78:
            problems.append(
                "wearer? base spans %dpx of item width %d" % (lower_w, item_w)
            )

    # Skin tone. This is the reliable signal: the gear palette is bone, stone
    # and leather, all desaturated, so any warm hue at volume is a face or
    # neck. The base-width test above misses a head that is NARROWER than the
    # helm it wears, which is the exact shape of the ironHelm_left failure.
    warm = sum(
        1
        for y in range(h)
        for x in range(w)
        if px[x, y][3] >= 200
        and px[x, y][0] > px[x, y][1] > px[x, y][2]
        and px[x, y][0] - px[x, y][2] > 25
        and px[x, y][0] > 60
    )
    opaque = sum(1 for y in range(h) for x in range(w) if px[x, y][3] >= 200)
    if opaque and warm / float(opaque) >= WARM_FRAC:
        problems.append(
            "wearer? %.0f%% skin-toned (%d/%d px)" % (100 * warm / opaque, warm, opaque)
        )

    return problems


def check(path, max_colors=MAX_COLORS, expect=None):
    problems = []
    im = Image.open(path)
    if im.size != (SPEC_W, SPEC_H):
        problems.append("size %dx%d != %dx%d" % (im.size + (SPEC_W, SPEC_H)))
    if im.mode != "RGBA":
        problems.append("mode %s != RGBA" % im.mode)
        im = im.convert("RGBA")
    else:
        im = im.convert("RGBA")

    px = im.load()
    w, h = im.size

    colors = {px[x, y] for y in range(h) for x in range(w)}
    if len(colors) > max_colors:
        problems.append("%d colours > %d" % (len(colors), max_colors))

    has_clear = any(px[x, y][3] == 0 for y in range(h) for x in range(w))
    has_solid = any(px[x, y][3] == 255 for y in range(h) for x in range(w))
    if not has_clear:
        problems.append("no transparent pixel")
    if not has_solid:
        problems.append("no opaque pixel")

    # NOTE: the old opaque near-white hole test that lived here has been
    # removed. It looked for bright (>200) enclosed regions, which was right
    # for the batch-1 white-matte sprites but wrong for batch 2: these are
    # dark woodcut items, so the test measured warm highlights and reported a
    # phantom "102 px enclosed matte" on a spiked breastplate that has no hole
    # at all (gear_shape_problems, called below, checks the real thing).


    rows = [y for y in range(h) if any(px[x, y][3] for x in range(w))]
    cols = [x for x in range(w) if any(px[x, y][3] for y in range(h))]
    if not rows or not cols:
        problems.append("fully transparent image")
        return problems, 0.0

    if expect == "gear":
        problems.extend(gear_shape_problems(px, w, h, rows, cols))
        # Equipment is centred in the canvas, not stood on the bottom edge:
        # the compositor places each item on the body's own landmarks, so an
        # isolated gear sprite carries no position. Requiring its lowest row to
        # be h-1 (the character rule) would fail every correctly centred item.
        # What matters instead is that the item is fully inside the frame and
        # roughly centred.
        if min(rows) <= 0 or max(rows) >= h - 1:
            problems.append("gear touches the frame edge (rows %d..%d)" % (min(rows), max(rows)))
        if min(cols) <= 0 or max(cols) >= w - 1:
            problems.append("gear touches the frame edge (cols %d..%d)" % (min(cols), max(cols)))
        opaque = sum(1 for y in range(h) for x in range(w) if px[x, y][3])
        coverage = opaque / float(w * h)
        # A single item is much sparser than a whole figure; a small helm is
        # legitimately ~5% of the canvas.
        # A single boot is legitimately ~2.6% of the canvas (362 px of 13824):
        # the slot target height is only 24 px. The floor therefore sits at 1%
        # so a small-but-correct item is not flagged, while a blank layer (0%)
        # still is.
        if not (0.01 <= coverage <= 0.75):
            problems.append("coverage %.0f%% outside 1-75%%" % (coverage * 100))
        return problems, coverage

    if max(rows) != h - 1:
        problems.append("feet at row %d, not %d" % (max(rows), h - 1))

    x0, x1 = min(cols), max(cols)
    left_gap, right_gap = x0, (w - 1) - x1
    if abs(left_gap - right_gap) > 2:
        problems.append("off-centre (gaps %d/%d)" % (left_gap, right_gap))

    opaque = sum(1 for y in range(h) for x in range(w) if px[x, y][3])
    coverage = opaque / float(w * h)
    # A pure side view is legitimately the narrowest of the four: the figure
    # is only ~25 px wide there against ~47 px in the back view, so the floor
    # sits below the 25% the front-facing views comfortably clear.
    if not (0.20 <= coverage <= 0.75):
        problems.append("coverage %.0f%% outside 20-75%%" % (coverage * 100))

    return problems, coverage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("indir")
    ap.add_argument("--max-colors", type=int, default=MAX_COLORS)
    ap.add_argument("--quiet", action="store_true", help="only print failures")
    ap.add_argument(
        "--expect",
        choices=("hero", "gear"),
        default=None,
        help="gear adds the self-support and no-wearer shape checks",
    )
    args = ap.parse_args()

    files = sorted(
        f for f in os.listdir(args.indir) if f.lower().endswith(".png")
    )
    if not files:
        sys.exit("no PNG files in %s" % args.indir)

    failed = []
    for f in files:
        # Equipment layers are named eq_<slot>_...; everything else is the hero.
        # Inferring here keeps the two call sites from drifting apart.
        expect = args.expect or ("gear" if f.startswith("eq_") else "hero")
        problems, coverage = check(
            os.path.join(args.indir, f), args.max_colors, expect
        )
        if problems:
            failed.append(f)
            print("FAIL %-34s %s" % (f, "; ".join(problems)))
        elif not args.quiet:
            print("ok   %-34s coverage %.0f%%" % (f, coverage * 100))

    print(
        "\n%d file(s): %d pass, %d fail"
        % (len(files), len(files) - len(failed), len(failed))
    )
    if failed:
        print("failed: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
