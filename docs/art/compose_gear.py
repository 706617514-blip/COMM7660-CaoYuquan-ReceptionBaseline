#!/usr/bin/env python3
"""Composite one equipment layer onto the base body, per view.

Why this exists
---------------
The acceptance test for "does this gear clip?" is NOT a freshly generated
image of an armoured hero. A generated image only proves the model can draw
armour; it says nothing about whether the game's actual layer stack lines up.
So the worn-on-character proof is built by stacking the real, normalised
equipment layer onto the real, normalised base body, at the same scale, and
inspecting the result. If the composite clips, the game would clip too.

Alignment model
---------------
Every sprite shares one scale and one bottom-centre anchor (feet at y=143,
figure centred on x=48). An equipment layer is drawn as its own isolated
sprite on that same 96x144 canvas, so the generator was told to place the item
where it belongs on the body. That means the two images can be alpha-composited
with NO offset for most slots - the position is already baked in.

Two slots need an explicit nudge because their isolated sprite cannot know
where the body is:

  head    sits on the skull; the isolated helm is drawn centred, but the head
          in a side view is off-centre, so the helm is shifted to the head
          centroid measured from the base body's upper region.
  weapon  is held in a hand; the hand position differs per view, so the
          weapon is anchored to the hand centroid instead of the canvas centre.

The offsets are computed from the base body itself rather than hardcoded, so
they follow the art if the base is ever regenerated.

Usage:
    python3 docs/art/compose_gear.py --sprites docs/art/sprites \
        --outdir docs/art/composites --views right left back 34
"""

import argparse
import os
import sys

from PIL import Image

SPEC_W, SPEC_H = 96, 144


def load(path):
    return Image.open(path).convert("RGBA")


def figure_bbox(img):
    bbox = img.getbbox()
    return bbox


# Anatomical landmarks as a fraction of the figure's own height, measured from
# the top of the silhouette. Derived from the finished base sprite, where the
# figure spans y 1..143 and the landmarks fall at these rows:
#   crown 0%  chin 20%  shoulder 25%  chest 35%  waist 52%
#   hip 62%  knee 80%  ankle 94%  sole 100%
# Using fractions of the measured figure keeps the anchors correct if the base
# art is ever regenerated at a different scale.
# The crown row is where the skull actually reaches full width, not the very
# top of the silhouette: the base sprite tapers to a 5 px point at y=1 before
# widening to 29 px at y=15. Anchoring a helm to the tip would drop it onto the
# neck, which is exactly what the first composite did.
# Measured from the finished base sprite rather than guessed. The right view
# spans y 1..143 (143 px tall) and its rows measure:
#   y  3  width 15   top of skull
#   y 15  width 29   widest part of the head
#   y 27  width 24   jaw / chin
#   y 30  width 27   neck and shoulder begin
#   y 42  width 33   chest
#   y 86  width 38   hips
#   y143  width 22   soles
# As fractions of the 143 px height: crown .014, chin .182, shoulder .203,
# chest .287, waist .50, hip .594, knee .79, ankle .93, sole 1.0.
LANDMARK = {
    "crown": 0.014,
    "chin": 0.182,
    "shoulder": 0.203,
    "chest": 0.287,
    "waist": 0.50,
    "hip": 0.594,
    "knee": 0.79,
    # Somewhere below the knee: a boot shaft starts around mid-shin, which is
    # what the footwear slot has to cover.
    "shin": 0.86,
    # A boot covers the foot AND the lower shin. Using shin->sole alone is only
    # 18 px, which squashed every 26 px boot sprite to 69% and left the boots
    # barely visible at the ankle. This reaches a little higher up the calf.
    "lowerShin": 0.82,
    "ankle": 0.93,
    "sole": 1.00,
}


def landmark_y(base, name):
    """Row in canvas coordinates for an anatomical landmark."""
    bbox = figure_bbox(base)
    if not bbox:
        return 0
    _, y0, _, y1 = bbox
    return y0 + int(round((y1 - y0) * LANDMARK[name]))


def head_anchor(base):
    """Centre-x of the head, measured from the crown-to-chin band.

    The head occupies the top of the silhouette. Measuring it from the actual
    opaque pixels keeps the helm on the skull even if the pose shifts the body
    sideways, which a hardcoded 48 would not.
    """
    bbox = figure_bbox(base)
    if not bbox:
        return SPEC_W // 2, 0
    x0, y0, x1, y1 = bbox
    band = landmark_y(base, "chin")
    total = 0
    count = 0
    px = base.load()
    for y in range(y0, min(band, SPEC_H)):
        for x in range(x0, min(x1, SPEC_W)):
            if px[x, y][3] > 128:
                total += x
                count += 1
    return (total // count if count else SPEC_W // 2), y0


def hand_anchor(base, side):
    """Centre of the lower-outer arm region, which is where a hand sits.

    A held item hangs from the hand, so anchoring to the arm's lower end beats
    anchoring to the canvas centre whenever the pose is asymmetric.
    """
    bbox = figure_bbox(base)
    if not bbox:
        return SPEC_W // 2, SPEC_H * 3 // 4
    x0, y0, x1, y1 = bbox
    # Lower half of the figure only: below the waist, above the knees.
    top = landmark_y(base, "waist")
    bot = landmark_y(base, "knee")
    px = base.load()
    xs = []
    for y in range(top, min(bot, SPEC_H)):
        for x in range(x0, min(x1, SPEC_W)):
            if px[x, y][3] > 128:
                xs.append(x)
    if not xs:
        return SPEC_W // 2, (top + bot) // 2
    if side == "left":
        target = min(xs)
    elif side == "right":
        target = max(xs)
    else:
        target = sum(xs) // len(xs)
    # Land on the PALM, not on the outermost arm pixel.
    #
    # Taking the extreme opaque column of the waist-to-knee band returns the
    # outside edge of the forearm (right view: x 66 against a body edge of 64),
    # which is where a weapon's blade would sit, not where its grip is. A grip
    # sits INSIDE the hand, roughly a quarter of the arm's thickness in from the
    # silhouette edge, so pull the anchor inboard by that much.
    rows_at_y = []
    mid = (top + bot) // 2
    for y in range(max(0, mid - 4), min(SPEC_H, mid + 5)):
        for x in range(SPEC_W):
            if px[x, y][3] > 128:
                rows_at_y.append(x)
    if rows_at_y:
        lo, hi = min(rows_at_y), max(rows_at_y)
        span = hi - lo
        inset = max(2, span // 8)
        if side == "left":
            target = lo + inset
        else:
            target = hi - inset
    return target, mid


def gear_bbox(img):
    return img.getbbox()


# Where each slot's item must end up vertically, as a landmark pair:
# (the row the item's top edge should sit at, the row its bottom edge should
# reach). A helm spans crown->chin; body armour spans shoulder->waist; a cape
# hangs shoulder->knee; footwear covers ankle->sole; a weapon is held from the
# hand and runs from about chest height to below the knee.
# Where each slot's item must end up vertically, as a landmark pair.
#
# These spans must match how tall the item actually is, because the compositor
# scales the item to fit the span. The first version used ankle->sole for
# footwear, which is only 9 px: every boot was squashed to 35% of its size and
# reported "13% visible". A boot covers the foot AND the lower shin, so its span
# starts below the knee.
SLOT_SPAN = {
    "head":   ("crown", "chin"),
    "torso":  ("shoulder", "waist"),
    "back":   ("shoulder", "knee"),
    "weapon": ("chest", "knee"),
    "feet":   ("lowerShin", "sole"),
}


def compose(base_path, gear_path, slot, view, align=False, rescale=False, outline=True):
    """Return base with the gear layer stacked on top.

    `align` repositions the item onto the body's anatomical landmarks. The
    generator is told to size the item relative to a wearer, but it cannot know
    where that wearer's shoulders sit in a 96x144 frame, so the composite does
    the placement: the item is scaled to the slot's landmark span and centred
    on the body's own silhouette at that height. Without this step the pieces
    land wherever the generator happened to centre them and the result is
    armour floating over the face and boots through the shins.
    """
    base = load(base_path)
    gear = load(gear_path)

    if align:
        gb = gear_bbox(gear)
        if gb:
            # Crop the item out of its canvas FIRST. Normalisation centres each
            # item in a 96x144 frame, so the canvas and the item are different
            # sizes; resizing the whole canvas scaled the item but kept the
            # empty margin, and the composite then placed that margin at the
            # target row and buried the item inside the body (helm visible 0%).
            gear = gear.crop(gb)
            gw, gh = gear.size

            top_name, bot_name = SLOT_SPAN.get(slot, ("crown", "sole"))
            want_top = landmark_y(base, top_name)
            want_bot = landmark_y(base, bot_name)
            want_h = max(1, want_bot - want_top)

            # Weapons keep their own length. A weapon's reach is a property of
            # the weapon, not of a body band: forcing a dagger and a two-handed
            # sword into the same chest-to-knee height makes one oversized and
            # the other invisible. Normalisation already sized them; the
            # compositor only positions them.
            if rescale and gh > 0 and slot != "weapon":
                # Scale the item so its own height matches the slot's span.
                scale = want_h / gh
                if slot == "feet":
                    # Footwear is drawn as a matched PAIR and comes in two
                    # shapes: a wide pair side by side (~39 px) and a single
                    # boot (~19 px). Scale by height as usual, then only clamp
                    # the WIDTH if the pair is wider than the foot region.
                    #
                    # Clamping by width alone is wrong: for a single-boot
                    # sprite it would enlarge the boot 1.79x, taking its height
                    # from 26 px to 47 px and blowing it up to 1502% of its
                    # proper size. Width may only ever pull an item DOWN.
                    # Fit BOTH ways. A boot must end up about as wide as the
                    # foot it covers: the generator returns footwear at wildly
                    # different widths for the same 26 px height (9 px for
                    # windBoots, 49 px for phaseBoots), and the earlier
                    # one-sided clamp only ever shrank - so the narrow ones
                    # stayed narrow and read as ankle wraps rather than boots.
                    foot_w = body_width_at(base, landmark_y(base, "shin"),
                                           landmark_y(base, "sole"))
                    if foot_w and gw > 0:
                        # Footwear comes back in two incompatible framings: a
                        # single boot seen from the side (windBoots, 0.30 w/h) and
                        # a matched pair laid flat (phaseBoots, 2.12 w/h). Fit
                        # the sprite into the foot box on whichever axis is
                        # binding, so both framings land at the same worn size.
                        #
                        # Fitting by width alone turned a 9 px column into a
                        # 113 px column; fitting by height alone left the flat
                        # pair wider than the leg. Taking the smaller of the two
                        # ratios respects the foot box in both directions.
                        box_w = foot_w * 1.15
                        box_h = float(want_h)
                        scale = min(box_w / gw, box_h / gh)
                nw = max(1, int(round(gw * scale)))
                nh = max(1, int(round(gh * scale)))
                # Never let an item overflow the canvas; a wide pair of boots
                # or a two-handed sword can otherwise be clipped at the edge.
                if nw > SPEC_W or nh > SPEC_H:
                    fit = min(SPEC_W / nw, SPEC_H / nh)
                    nw = max(1, int(round(nw * fit)))
                    nh = max(1, int(round(nh * fit)))
                gear = gear.resize((nw, nh), Image.LANCZOS)
                gw, gh = nw, nh

            # Horizontal target: the body's own centre at that height band, so
            # a side view puts the helm on the visible head rather than the
            # canvas centre.
            cx = body_centre_x(base, want_top, want_bot)
            if slot == "weapon":
                # A weapon is not centred on the hand: the GRIP is. Aligning the
                # blade's midpoint to the hand pushed a two-handed sword 28 px
                # past the canvas edge and left it floating clear of the body.
                # The sprite already has the weapon drawn in its worn attitude,
                # so anchor the hand-side edge of the weapon to the hand.
                side = "left" if view == "left" else "right"
                hand_x, hand_y = hand_anchor(base, side)
                # Put the grip AT the hand and let the rest of the weapon lie
                # over the body. The weapon sprite is drawn in its worn
                # attitude, so its grip sits roughly one-fifth in from the
                # edge nearer the hand.
                #
                # Pushing the weapon OUTWARD from the hand is what made a
                # two-handed sword read as "floating 97% off the body": the
                # hand anchor is the outermost arm pixel, so extending further
                # put the whole blade in empty space beside the figure.
                if view == "left":
                    dx = hand_x - gw + max(1, gw // 5)
                else:
                    dx = hand_x - max(1, gw // 5)
                # Keep the weapon over the figure: at least a third of it must
                # overlap the body's own horizontal span.
                bx0, by0, bx1, by1 = figure_bbox(base)
                overlap = min(dx + gw, bx1) - max(dx, bx0)
                if overlap < gw // 3:
                    if dx < bx0:
                        dx = bx0 - gw // 6
                    else:
                        dx = bx1 - gw + gw // 6
                # Vertical: the GRIP goes at the hand, not the blade tip.
                #
                # Using the slot's chest row as the weapon's top edge put every
                # weapon at exactly y33-110 in all four views - a fixed band with
                # no relation to where the hand actually is (y96). A sword drawn
                # with its blade pointing up therefore had its pommel floating at
                # chest height instead of resting in the fist.
                #
                # The sprite is drawn in its worn attitude, so the grip sits
                # near the end of the weapon that is nearer the hand. Find that
                # end by measuring which extreme of the sprite is thinner - a
                # grip is narrow, a blade or an axe head is wide - and align it
                # to the hand's row.
                col_w = []
                for yy in range(gh):
                    row = [xx for xx in range(gw) if gear.getpixel((xx, yy))[3] > 0]
                    col_w.append((len(row), yy))
                row_w = []
                for xx in range(gw):
                    col = [yy for yy in range(gh) if gear.getpixel((xx, yy))[3] > 0]
                    row_w.append(len(col))
                # Split the sprite into grip-end and head-end by width profile.
                top_thin = sum(row_w[: max(1, gw // 4)])
                bot_thin = sum(row_w[-max(1, gw // 4):])
                # A vertical weapon: decide by which end is narrower.
                if gh > gw:      # sprite mostly vertical
                    top_narrow = sum(1 for yy in range(max(1, gh // 5)) if col_w[yy][0] < gw * 0.35)
                    bot_narrow = sum(1 for yy in range(gh - max(1, gh // 5), gh) if col_w[yy][0] < gw * 0.35)
                    grip_at_top = top_narrow >= bot_narrow
                    dy = hand_y - (0 if grip_at_top else gh) + gh // 6
                else:            # sprite mostly diagonal/horizontal: keep chest row
                    dy = want_top
                if dy < 0:
                    dy = 0
                if dy + gh > SPEC_H:
                    dy = max(0, SPEC_H - gh)
                if dx + gw > SPEC_W:
                    dx = SPEC_W - gw
                if dx < 0:
                    dx = 0
                shifted = Image.new("RGBA", (SPEC_W, SPEC_H), (0, 0, 0, 0))
                shifted.paste(gear, (dx, dy), gear)
                gear = shifted
                out = base.copy()
                out.alpha_composite(gear)
                if align and outline:
                    out = add_gear_outline(out, gear)
                return out

            dx = cx - gw // 2
            if slot == "feet":
                # Anchor footwear by its SOLE, not its top: a boot must stand on
                # the same ground line as the feet, otherwise it floats.
                dy = landmark_y(base, "sole") - gh + 1
            else:
                dy = want_top
            shifted = Image.new("RGBA", (SPEC_W, SPEC_H), (0, 0, 0, 0))
            shifted.paste(gear, (dx, dy), gear)
            gear = shifted

    out = base.copy()
    out.alpha_composite(gear)
    if align and outline:
        out = add_gear_outline(out, gear)
    return out


def add_gear_outline(worn, gear, color=(20, 16, 12)):
    """Darken the seam between a gear layer and the body under it.

    Boots and leather armour share the body's own warm brown ramp, so a worn
    boot composited straight onto the shin visually merged with the leg - the
    QA sheet showed a leg with no boot on it even though 346 pixels had
    changed. A one-pixel dark edge where the gear meets the body separates the
    two shapes the same way the woodcut's own ink outlines do, without altering
    either image's colours.
    """
    px = worn.load()
    gpx = gear.load()
    w, h = worn.size
    out = worn.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            if gpx[x, y][3] == 0:
                continue
            # A gear pixel that sits on an opaque body pixel gets a dark rim
            # on any side facing bare body, so the silhouette reads.
            if px[x, y][3] == 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and gpx[nx, ny][3] == 0 and px[nx, ny][3] > 128:
                    op[nx, ny] = (*color, 255)
    return out


def body_width_at(base, y_top, y_bot):
    """Width of the body silhouette between two rows."""
    px = base.load()
    xs = []
    for y in range(max(0, y_top), min(SPEC_H, y_bot + 1)):
        for x in range(SPEC_W):
            if px[x, y][3] > 128:
                xs.append(x)
    if not xs:
        return 0
    return max(xs) - min(xs) + 1


def body_centre_x(base, y_top, y_bot):
    """Horizontal centre of the body silhouette between two rows."""
    px = base.load()
    xs = []
    for y in range(max(0, y_top), min(SPEC_H, y_bot + 1)):
        for x in range(SPEC_W):
            if px[x, y][3] > 128:
                xs.append(x)
    if not xs:
        return SPEC_W // 2
    return (min(xs) + max(xs)) // 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sprites", default="docs/art/sprites")
    ap.add_argument("--outdir", default="docs/art/composites")
    ap.add_argument("--views", nargs="*", default=["right", "left", "back", "34"])
    ap.add_argument("--slots", nargs="*", default=["head", "torso", "back", "weapon", "feet"])
    ap.add_argument("--ids", nargs="*", help="only these equipment ids")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--no-align", action="store_true")
    ap.add_argument("--no-rescale", action="store_true",
                    help="keep the item's own size instead of fitting it to the slot span")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)

    made = skipped = 0
    for view in args.views:
        base_path = os.path.join(args.sprites, f"hero_base_{view}.png")
        if not os.path.exists(base_path):
            print(f"missing base for view {view}: {base_path}")
            continue
        for slot in args.slots:
            prefix = f"eq_{slot}_"
            names = sorted(
                f for f in os.listdir(args.sprites)
                if f.startswith(prefix) and f.endswith(f"_{view}.png")
            )
            if args.ids:
                wanted = set(args.ids)
                names = [n for n in names
                         if n[len(prefix):-len(f"_{view}.png")] in wanted]
            if args.limit:
                names = names[: args.limit]
            for n in names:
                eid = n[len(prefix):-len(f"_{view}.png")]
                dst = os.path.join(args.outdir, f"worn_{slot}_{eid}_{view}.png")
                try:
                    out = compose(
                        base_path,
                        os.path.join(args.sprites, n),
                        slot, view,
                        align=not args.no_align,
                        rescale=not args.no_rescale,
                    )
                    out.save(dst)
                    made += 1
                except Exception as e:
                    print(f"FAIL {n}: {type(e).__name__}: {e}")
                    skipped += 1

    print(f"composited {made} image(s) -> {args.outdir}"
          + (f" ({skipped} failed)" if skipped else ""))
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())
