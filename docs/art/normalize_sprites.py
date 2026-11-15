#!/usr/bin/env python3
"""
Normalise raw Seedream output into game-ready sprites.

Raw output from the ARK endpoint is 1024x1024 RGB JPEG on a near-white matte:
no alpha, ~20k+ colours. The frozen spec in protagonist-art-brief.md requires
96x144, real alpha, <=32 colours, feet on the bottom edge, centred
horizontally.

Pipeline per file:
  1. alpha from luminance-keyed matte removal (flood-fill from the border, so
     light areas *inside* the figure are not punched out)
  2. crop to the figure's bounding box
  3. scale to fit 96x144 preserving aspect, then bottom-centre anchor
  4. quantise to the spec's palette with ordered dithering off
  5. re-derive a 1px dark outline (#1a1611) so silhouettes survive at 1x

The order matters: quantising before scaling would soften edges; outlining
before scaling would produce a thick outline at native size.
"""

import argparse
import os
import sys
from collections import deque

from PIL import Image

SPEC_W, SPEC_H = 96, 144
OUTLINE = (26, 22, 17)          # #1a1611, matches the ink colour in the brief
BACKGROUND_TOL = 30             # how close to the border colour still counts as matte


def build_alpha(img, tol=BACKGROUND_TOL):
    """Cut the matte with a chroma-aware, connectivity-decided mask.

    Two facts about this batch drove the design:

    1. The matte colour is not constant across the batch. Some frames come
       back on pure BLACK, others on pure WHITE, because image-to-image
       prompts that forbid a background are inconsistent about what they
       substitute. The matte colour is therefore *measured* from the border
       (median) instead of assumed.
    2. On a black matte a luminance threshold alone eats the woodcut's own
       dark side. The back view lost the whole seat and inner thighs to
       holes that measured [10,9,5] - darker than the 18 threshold, yet not
       actually the matte. Those pixels are distinguishable by CHROMA: the
       matte is strictly neutral (r == g == b, measured 0-1), while the
       figure's darkest ink always carries a warm offset (r > b).

    So foreground = bright enough OR chromatic enough. Connectivity then
    decides what is background: only non-foreground pixels reachable from the
    border are matte, which keeps enclosed matte opaque instead of punching
    holes. A morphological opening removes the anti-aliased fringe that the
    threshold leaves behind, because at 96x144 a one-pixel fray is visible.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    # Measure the real matte colour from the border rather than assuming
    # white; this batch contains both black-matte and white-matte frames.
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)]
    border += [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    matte = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    matte_dark = sum(matte) / 3.0 < 96

    if matte_dark:
        # Dark matte: brightness OR chroma marks the figure. FG_MIN sits just
        # above the matte's measured 0-1; CHROMA_MIN catches the warm ink that
        # falls below it. A purely neutral dark pixel is matte.
        # FG_MIN sits just above the matte's measured 0-1. It was 18, which
        # ate the woodcut's darkest figure tone: on the idle sprite only 9.8%
        # of the lower half survived the test while 14.8% was above 5, and the
        # 5% in between was the legs - the silhouettes came out with chewed
        # notches along the calves. 8 keeps that tone while staying clear of
        # the matte, and the chroma test below catches anything darker still.
        FG_MIN = 8
        CHROMA_MIN = 3
        is_figure = bytearray(w * h)
        for y in range(h):
            row = y * w
            for x in range(w):
                r, g, b = px[x, y]
                if r > FG_MIN or g > FG_MIN or b > FG_MIN:
                    is_figure[row + x] = 1
                elif max(r, g, b) - min(r, g, b) > CHROMA_MIN:
                    is_figure[row + x] = 1
    else:
        # Light matte: anything far enough from the measured matte colour is
        # figure. The old hardcoded r,g,b > 200 test is kept as a floor so a
        # light grey matte still reads as background.
        is_figure = bytearray(w * h)
        for y in range(h):
            row = y * w
            for x in range(w):
                r, g, b = px[x, y]
                far = (
                    abs(r - matte[0]) > tol
                    or abs(g - matte[1]) > tol
                    or abs(b - matte[2]) > tol
                )
                pale = r > 200 and g > 200 and b > 200
                if far or not pale:
                    is_figure[row + x] = 1

    # Morphological opening (erode then dilate, 4-neighbour, 3x3) strips the
    # anti-aliased fringe and detached specks. scipy is not installed in this
    # environment, so both passes are done directly on the flat bytearray via
    # shifted writes.
    def _dilate(m):
        out = bytearray(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            for y in range(h):
                ny = y + dy
                if not (0 <= ny < h):
                    continue
                src = y * w
                dst = ny * w
                if dx == 0:
                    for x in range(w):
                        if m[src + x]:
                            out[dst + x] = 1
                else:
                    rng = range(w - 1) if dx == 1 else range(1, w)
                    for x in rng:
                        if m[src + x]:
                            out[dst + x + dx] = 1
        return out

    def _erode(m):
        out = bytearray(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            for y in range(h):
                ny = y + dy
                if not (0 <= ny < h):
                    out[y * w:(y + 1) * w] = bytes(w)
                    continue
                src = y * w
                dst = ny * w
                if dx == 0:
                    for x in range(w):
                        if not m[src + x]:
                            out[dst + x] = 0
                else:
                    rng = range(w - 1) if dx == 1 else range(1, w)
                    for x in rng:
                        if not m[src + x]:
                            out[dst + x + dx] = 0
        return out

    is_figure = _dilate(_erode(is_figure))

    # Exterior fill: non-figure pixels reachable from the border are matte.
    # Everything else - figure, plus any matte sealed inside a closed ink
    # outline - stays opaque. Opening can sever a thin bridge at a wrist or
    # ankle, so this runs on the cleaned mask and any region it detached is
    # simply filled back in as figure.
    exterior = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if not is_figure[i] and not exterior[i]:
                exterior[i] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if not is_figure[i] and not exterior[i]:
                exterior[i] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if not is_figure[i] and not exterior[i]:
                    exterior[i] = 1
                    q.append((nx, ny))

    # Small-cavity fill. A thorned breastplate or a spiked pauldron can enclose
    # a pocket of matte that still reaches the border through a one-pixel gap
    # between spikes, so the exterior fill (which is purely topological) leaves
    # it transparent and the item ships with a hole punched through it - the
    # QA gate caught exactly that on thornMail. Any transparent region small
    # enough to be an internal pocket rather than real background is filled in.
    # The size cap keeps genuine gaps (the space between an arm and the body,
    # the hole in a ring) open, because those are far larger.
    CAVITY_MAX_PX = int(w * h * 0.0016)   # ~1670 px at 1024x1024
    seen = bytearray(w * h)
    for sy in range(h):
        for sx in range(w):
            i0 = sy * w + sx
            if not exterior[i0] or seen[i0]:
                continue
            region = []
            q2 = deque([(sx, sy)])
            seen[i0] = 1
            touches_border = False
            while q2:
                x, y = q2.popleft()
                region.append((x, y))
                if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                    touches_border = True
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        i = ny * w + nx
                        if exterior[i] and not seen[i]:
                            seen[i] = 1
                            q2.append((nx, ny))
            if not touches_border and len(region) <= CAVITY_MAX_PX:
                for (x, y) in region:
                    exterior[y * w + x] = 0

    # Matte-coloured pixels still marked opaque.
    #
    # A spiked item (thornMail) has pockets of pure matte that reach the border
    # through one-pixel gaps between the spikes, so neither the exterior fill
    # nor the cavity fill removes them: the region is genuinely connected to
    # the border, yet it is inside the item as far as a viewer is concerned. It
    # shipped as a 105 px pure-white (250,250,250) blob on the breastplate.
    # Any opaque pixel that still matches the measured matte colour is matte,
    # wherever it sits - the artwork never uses pure #fff or pure #000 as a
    # fill, so this cannot eat real detail.
    # Sweep any opaque pixel that is still a MATTE COLOUR.
    #
    # Two cases get through the fills above:
    #  - a spiked item (thornMail) leaves pockets of pure matte joined to the
    #    border through one-pixel gaps between the spikes, so the region is
    #    genuinely "connected" yet reads as a hole inside the item;
    #  - a pale item on a pale matte (a steel ring on white) has rim pixels
    #    light enough to survive as a bright blob.
    # The woodcut never fills with strict neutral white, so requiring near-zero
    # chroma as well as brightness cannot eat real highlights: measured on the
    # finished sprites, a genuine metal highlight came back as (198,183,161),
    # which is 37 levels of chroma and stays well clear of this test.
    #
    # Pixels are not merely flagged transparent - they are also cleared to the
    # transparent colour, because leaving the RGB in place let the outline pass
    # later read them as figure.
    for i in range(w * h):
        if exterior[i]:
            continue
        y, x = divmod(i, w)
        r, g, b = px[x, y]
        if matte_dark:
            is_matte_colour = (max(r, g, b) <= 12
                               and max(r, g, b) - min(r, g, b) <= 4)
        else:
            is_matte_colour = (min(r, g, b) >= 225
                               and max(r, g, b) - min(r, g, b) <= 12)
        if is_matte_colour:
            exterior[i] = 1

    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            op[x, y] = (r, g, b, 0 if exterior[row + x] else 255)
    return out


def crop_to_figure(img, pad=2):
    bbox = img.getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(img.width, x1 + pad)
    y1 = min(img.height, y1 + pad)
    return img.crop((x0, y0, x1, y1))


def fit_bottom_centre(img, w=SPEC_W, h=SPEC_H, scale=None):
    """Scale by a SHARED factor, then paste bottom-centre.

    The sprite origin in app.js is bottom-centre with feet on GROUND_Y, so the
    figure sits on the bottom edge rather than centred in the canvas.

    `scale` must be passed in from the batch, not derived per image. Fitting
    each view to the canvas independently makes every view a different size:
    a narrow side view gets magnified while a wide back view gets shrunk, so
    the head, shoulders and hips land at different heights in each sprite and
    a gear layer drawn for one view cannot sit on another. Wave 1 shipped like
    that and the four views measured 37-70 px wide by a full 144 px tall -
    i.e. no common scale at all. Callers therefore compute one scale from the
    tallest figure in the batch and reuse it for every view.
    """
    if scale is None:
        scale = min(w / img.width, h / img.height)
    nw = max(1, int(round(img.width * scale)))
    nh = max(1, int(round(img.height * scale)))
    # Never overflow the canvas: a shared scale is safe for the reference
    # figure but a wider pose could still exceed it.
    if nw > w or nh > h:
        shrink = min(w / nw, h / nh)
        nw = max(1, int(round(nw * shrink)))
        nh = max(1, int(round(nh * shrink)))
    resized = img.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(resized, ((w - nw) // 2, h - nh), resized)
    return canvas


def quantise(img, colors=32):
    """Snap every visible pixel onto a palette of at most `colors` entries.

    Pillow's quantize() counts colours over the whole RGBA image and keeps the
    antialiased edge pixels, which pushed these sprites past 500 colours. So
    build the palette from fully-opaque pixels only, snap every visible pixel to
    its nearest entry, and force edges to hard alpha (the spec is pixel art:
    a crisp silhouette reads better at 96x144 than a soft one).
    """
    rgb = img.convert("RGB")
    alpha = img.getchannel("A")
    ap = alpha.load()

    body = Image.new("RGB", img.size)
    bp = body.load()
    for y in range(img.height):
        for x in range(img.width):
            if ap[x, y] > 200:
                bp[x, y] = rgb.getpixel((x, y))

    pal_img = body.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    palette = pal_img.getpalette()
    entries = [tuple(palette[i : i + 3]) for i in range(0, len(palette), 3)][:colors]
    if not entries:
        return img

    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    op = out.load()
    cache = {}
    for y in range(img.height):
        for x in range(img.width):
            a = ap[x, y]
            if a <= 8:
                continue
            c = rgb.getpixel((x, y))
            hit = cache.get(c)
            if hit is None:
                best, bd = entries[0], None
                for e in entries:
                    d = (c[0]-e[0])**2 + (c[1]-e[1])**2 + (c[2]-e[2])**2
                    if bd is None or d < bd:
                        bd, best = d, e
                hit = cache[c] = best
            op[x, y] = (hit[0], hit[1], hit[2], 255)
    return out


def add_outline(img, color=OUTLINE):
    """Add a 1px outline outside the existing silhouette."""
    w, h = img.size
    src = img.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3] != 0:
                dst[x, y] = src[x, y]
                continue
            touches = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 128:
                    touches = True
                    break
            if touches:
                dst[x, y] = (*color, 255)
    return out


# Target height in canvas pixels for each equipment slot, so an isolated item
# lands at the size it must be when worn. Without this the batch shares one
# scale and every item ends up roughly the same size: the first run produced a
# 45 px helm, a 57 px boot, and a 115 px breastplate - none of which match the
# body they have to sit on. Values follow the base figure's own anatomy
# (head ~28 px, torso ~40 px, boot ~22 px, weapon ~75 px).
SLOT_TARGET_H = {
    "head": 28,
    "torso": 42,
    "back": 62,
    "weapon": 76,
    "feet": 24,
}


def slot_of(path):
    """eq_<slot>_<eid>_<view>.png -> slot, else None."""
    base = os.path.basename(path)
    if not base.startswith("eq_"):
        return None
    parts = base.split("_")
    if len(parts) < 3:
        return None
    return parts[1] if parts[1] in SLOT_TARGET_H else None


def normalise(src_path, dst_path, colors=32, do_outline=True, scale=None,
              target_h=None, keep_layout=False):
    """Cut, size and save one sprite.

    keep_layout is the mode equipment needs. A gear layer is generated AS WORN
    on the reference figure, so the position it occupies in its own 1024x1024
    frame IS its worn position: the generator drew the helm on the head at the
    scale the head has in the reference. Cropping the item out and re-centring
    it throws that away, and no amount of landmark arithmetic can put it back -
    that is why every attempt to re-place gear by coordinates left something
    clipped, floating or buried.
    With keep_layout the whole frame is scaled by one factor instead, so the
    item lands exactly where it was drawn relative to the same 96x144 canvas
    the base body uses.
    """
    img = Image.open(src_path)
    img = build_alpha(img)
    if keep_layout:
        # One factor for the whole frame: the reference and the output share
        # the 96x144 canvas, so scaling the full 1024x1024 (or whatever the
        # generator returned) preserves both size and placement.
        # The generator returns a SQUARE frame (1024x1024) whatever aspect the
        # reference had, and it stretches the reference to fill it. The
        # reference is 96x144, so the square frame's content is the 3:2 canvas
        # squeezed horizontally - mapping it back needs the two axes scaled
        # INDEPENDENTLY.
        #
        # Using one uniform factor (min of the two ratios) shrank the vertical
        # axis to 96/1024 as well, which pulled every item up the canvas: boots
        # that belong at the feet landed at y 81-106 against a sole line of
        # y 143.
        w, h = img.size
        img = img.resize((SPEC_W, SPEC_H), Image.LANCZOS)
        canvas = img

        # Rescale to the slot's target height WITHOUT moving the item.
        #
        # The generator honours the size anchor only loosely - measured across
        # the batch, helms came back 21-89 px tall against a 28 px target and
        # boots 18-82 px against 24. Position is already correct thanks to
        # keep_layout, so the fix is a resize about the item's own centre: its
        # centroid stays put and only its bulk changes. Re-cropping and
        # re-placing would reintroduce exactly the misalignment keep_layout
        # exists to remove.
        if target_h:
            bb = canvas.getbbox()
            if bb:
                x0, y0, x1, y1 = bb
                ih = y1 - y0
                if ih > 0 and ih != target_h:
                    f2 = target_h / ih
                    item = canvas.crop(bb)
                    nw2 = max(1, int(round(item.width * f2)))
                    nh2 = max(1, int(round(item.height * f2)))
                    item = item.resize((nw2, nh2), Image.LANCZOS)
                    cx = (x0 + x1) // 2
                    cy = (y0 + y1) // 2
                    canvas = Image.new("RGBA", (SPEC_W, SPEC_H), (0, 0, 0, 0))
                    canvas.paste(item, (cx - nw2 // 2, cy - nh2 // 2), item)
        return _finish(canvas, dst_path, colors, do_outline)
    img = crop_to_figure(img)
    if target_h:
        # Fit the item's own height to the slot target, then bottom-centre it.
        s = target_h / img.height
        nw = max(1, int(round(img.width * s)))
        nh = max(1, int(round(img.height * s)))
        # Leave a small margin. Clamping to the full canvas width produced a
        # sprite 95 px wide on a 96 px canvas, which the QA gate correctly
        # rejects as "touches the frame edge": a weapon that fills the frame
        # edge to edge has no margin for the outline pass and reads as cropped.
        MAX_W = SPEC_W - 4
        if nw > MAX_W:
            s2 = MAX_W / nw
            nw = MAX_W
            nh = max(1, int(round(nh * s2)))
        img = img.resize((nw, nh), Image.LANCZOS)
        # Centre the item in the canvas rather than bottom-aligning it. The
        # compositor places each item on the body's anatomical landmarks, so
        # the isolated sprite must not carry a position of its own: bottom-
        # aligning every item stacked a second, wrong offset on top of the
        # compositor's own, which buried the helm and the boots inside the body.
        canvas = Image.new("RGBA", (SPEC_W, SPEC_H), (0, 0, 0, 0))
        canvas.paste(img, ((SPEC_W - nw) // 2, (SPEC_H - nh) // 2), img)
        img = canvas
    else:
        img = fit_bottom_centre(img, scale=scale)
    # The QA gate counts distinct RGBA tuples, so the transparent pixel is one
    # entry and the outline colour is another. Reserve both: colors - 2 leaves
    # room for the artwork itself and still lands under the cap.
    return _finish(img, dst_path, colors, do_outline)


def _finish(img, dst_path, colors, do_outline):
    """Quantise, outline and save. Shared by both layout modes."""
    budget = colors - 2 if do_outline else colors - 1
    img = quantise(img, budget)
    if do_outline:
        img = add_outline(img)
    img.save(dst_path)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--indir", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--no-outline", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--ids", nargs="*",
                    help="only normalise these stems (without extension)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--keep-layout", action="store_true",
                    help="scale the whole frame instead of cropping and re-centring; "
                         "required for gear, whose worn position is baked into its frame")
    ap.add_argument("--no-keep-layout", action="store_true",
                    help="disable keep-layout for gear (crop and re-centre instead)")
    ap.add_argument("--no-slot-size", action="store_true",
                    help="do not fit equipment to its slot's target height")
    ap.add_argument("--no-shared-scale", action="store_true",
                    help="fit each view to the canvas independently (default: one scale per batch)")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    files = sorted(
        f for f in os.listdir(args.indir)
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
    )
    if args.ids:
        wanted = set(args.ids)
        files = [f for f in files if os.path.splitext(f)[0] in wanted]
    if args.limit:
        files = files[: args.limit]
    print(f"normalising {len(files)} file(s) -> {args.outdir}")

    # One scale for the whole batch. Each view is cut out first, then the
    # tallest resulting figure sets the scale that every view shares, so the
    # head, shoulders and hips land on the same rows across all four views.
    shared_scale = None
    if not args.no_shared_scale and len(files) > 1:
        heights = []
        for f in files:
            try:
                cut = crop_to_figure(build_alpha(Image.open(os.path.join(args.indir, f))))
                heights.append(cut.height)
            except Exception:
                pass
        if heights:
            tallest = max(heights)
            # Target the full canvas height so the sprite uses the space the
            # art brief reserves for it (the figure should stand on the
            # bottom edge and fill the 144 px column).
            shared_scale = SPEC_H / tallest
            print(f"shared scale {shared_scale:.4f} (tallest cut-out {tallest} px)")

    ok = fail = 0
    for n, f in enumerate(files, 1):
        dst = os.path.join(args.outdir, os.path.splitext(f)[0] + ".png")
        if os.path.exists(dst) and not args.force:
            print(f"[{n}/{len(files)}] skip {f} (exists)")
            continue
        try:
            slot = slot_of(f)
            th = SLOT_TARGET_H.get(slot) if slot and not args.no_slot_size else None
            # Gear defaults to keep-layout: its worn position comes from the
            # generator, not from the compositor.
            # Slots whose generator reliably draws the item ON the body use
            # keep-layout: their worn position is baked into the frame, so the
            # compositor does nothing but stack the layers.
            #
            # Footwear is the exception. The generator keeps returning boots as a
            # product shot - a matched pair, centred, spanning 55-89% of the
            # frame height when the feet occupy 83-99% - so its position in the
            # frame is meaningless. For those, crop to the item and let the
            # compositor place it on the foot landmarks.
            # Weapon also needs re-placing: the generator keeps drawing held
            # weapons slung across the BACK rather than in the hand, so their
            # frame position is wrong for the same reason footwear's is.
            KEEP_LAYOUT_SLOTS = {"head", "torso", "back"}
            if args.no_keep_layout:
                keep = False
            elif args.keep_layout:
                keep = True
            else:
                keep = slot in KEEP_LAYOUT_SLOTS if slot else False
            im = normalise(
                os.path.join(args.indir, f), dst,
                colors=args.colors, do_outline=not args.no_outline,
                scale=shared_scale, target_h=th, keep_layout=keep,
            )
            a = im.getchannel("A")
            opaque = sum(1 for p in a.getdata() if p > 0)
            print(
                f"[{n}/{len(files)}] OK   {f} -> {im.size[0]}x{im.size[1]} "
                f"opaque={opaque} ({100*opaque/(im.size[0]*im.size[1]):.0f}% fill)"
            )
            ok += 1
        except Exception as e:
            print(f"[{n}/{len(files)}] FAIL {f}: {type(e).__name__}: {e}")
            fail += 1

    print(f"\ndone: {ok} ok, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
