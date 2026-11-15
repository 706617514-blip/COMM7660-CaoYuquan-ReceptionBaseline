#!/usr/bin/env python3
"""Build the four anchor prompts: the protagonist holding a weapon, one per view.

Why an anchor
-------------
Every alignment problem in this project came from trying to place a gear layer
onto a body after the fact. The fix is to solve alignment ONCE, on an image a
human has approved, and then reuse that solution for every other weapon:

  1. Draw the protagonist holding one named weapon, in all four views, at the
     same body scale as the finished base sprites. This is the anchor.
  2. A reviewer confirms the anchor looks right - the grip is in the hand, the
     blade sits naturally, nothing clips.
  3. Every other weapon is then drawn as a standalone item and composited at
     the anchor's grip position, so no new alignment decision is made per weapon.

The stance is deliberately the same relaxed standing pose as hero_idle, with the
weapon hand hanging naturally and the blade angled toward the ground. That keeps
the anchor close to the existing idle art, so the armed action set built on top
of it (run, attack, skills) can reuse the unarmed silhouettes instead of being
redrawn from scratch.

Output: docs/art/prompts/anchor-prompts.json, four items
        anchor_right / anchor_left / anchor_back / anchor_34
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "anchor-prompts.json")

BASE_SIZE = "96x144"

# The weapon the anchor is drawn with. A plain straight sword is the least
# ambiguous to render and the easiest to read at 96x144, so it makes the
# clearest reference for measuring the grip.
ANCHOR_WEAPON = "a plain straight one-handed sword, simple crossguard, wrapped grip"

# Same identity block as the base sprites, so the anchor is the same person.
IDENTITY = (
    "IDENTITY LOCK: the attached reference image is the single source of truth for this "
    "character's FACE, HAIR, BODY and PROPORTIONS. Reproduce that exact individual — same "
    "facial structure, same hairline and hair shape, same stubble, same eye colour, same "
    "head-to-body ratio, same shoulder width, same limb length. Do NOT redesign, restyle, "
    "age, slim, lengthen or beautify the character. "
    "CLOTHING: keep the plain tight undergarment layer the reference shows — a collarless "
    "undershirt and close-fitting trousers, bare forearms, bare shins, bare feet. No belt, "
    "no shoulder strap, no outer tunic, no armour, no helmet, no boots. "
    "The ONLY addition is the weapon in the hand: this is the armed anchor pose, so the "
    "character holds the weapon described below and wears nothing else."
)

STANCE = (
    "POSE: standing upright and relaxed, weight balanced on both feet, body facing the "
    "viewer as the VIEW specifies. The right arm hangs naturally down at the side with a "
    "slight bend at the elbow, the hand closed around the weapon's grip at hip height. "
    "The weapon is held loosely, pointing diagonally DOWN and FORWARD so its tip is near "
    "the ground beside the front foot. The left arm hangs relaxed and empty. This is a "
    "calm resting stance, not a combat guard: the weapon is carried, not raised."
)

STYLE = (
    "ART DIRECTION: Dark-fantasy woodcut / late-medieval engraving. Every form is built as "
    "carved layered facets with hard chiselled edges and dense fine hatching strokes for "
    "shading. Absolutely NO soft gradients, NO smooth airbrushing, NO glossy anime "
    "rendering. Muted desaturated earth palette ONLY: ink outline #1a1611, shadow #251f18, "
    "body #393126, lit plane #655a49, top highlight #8a7d68. Skin #6b5a48. The single warm "
    "accent permitted in the whole image is a faint ember-orange #ff7a3c glint in the eyes. "
    "Light source is fixed at upper-left on every asset. Four-layer shading convention "
    "throughout: dark outline, body mass, lit face, small highlight."
)

TECH = (
    f"TECHNICAL OUTPUT: single isolated character, native size {BASE_SIZE} px, fully "
    "transparent background (real alpha channel, no checkerboard, no white or coloured "
    "matte). The character stands on the bottom edge with the feet at the very bottom, "
    "centred horizontally, no perspective distortion. The weapon is PART OF THIS IMAGE — "
    "draw it attached to the hand, in the same rendering style and palette, as if it were "
    "always there. Do not draw the weapon as a separate object floating beside the figure."
)

LOCKS = (
    "LOCKS: preserve the character's identity, stocky proportions, head shape, palette and "
    "line weight exactly as in the reference; preserve the upper-left light direction; keep "
    "the same carved-woodcut rendering language."
)

EXCLUDE = (
    "EXCLUDE: text, labels, watermarks, mockup frames, borders, background scenery, ground, "
    "floor shadow, duplicate characters, cropped edges, signature, UI chrome, colour "
    "swatches. Do not add a shield, a second weapon, armour, a helmet, a cape or any other "
    "equipment: the character wears only the plain underlayer and holds exactly one weapon."
)

VIEWS = {
    "right": (
        "strict orthographic SIDE VIEW facing RIGHT, no perspective",
        "Show the figure in profile facing right, the weapon arm on the far side so the "
        "blade is partly hidden behind the legs, and the tip pointing forward and down.",
    ),
    "left": (
        "strict orthographic SIDE VIEW facing LEFT, no perspective (the same character "
        "seen from the opposite side)",
        "Show the figure in profile facing left, the weapon arm on the near side so the "
        "whole blade is visible in front of the legs, tip pointing forward and down.",
    ),
    "back": (
        "strict orthographic BACK VIEW seen directly from behind, no perspective",
        "Show the rear of the figure: the back of the bare head, the shoulder blades, the "
        "plain undershirt across the back, both arms, and the weapon held down at the "
        "character's right side with the blade angled down and away.",
    ),
    "34": (
        "THREE-QUARTER view from the front-side at roughly 45 degrees, near-orthographic, "
        "no strong perspective distortion",
        "Show the figure turned three-quarters toward the viewer so the face, chest and "
        "both arms read clearly at an angle, with the weapon held down at the side, its "
        "blade crossing in front of the nearer leg.",
    ),
}


def main():
    items = []
    for view, (view_desc, view_extra) in VIEWS.items():
        items.append({
            "id": f"anchor_{view}",
            "category": "anchor",
            "view": view,
            "file": f"anchor_{view}.png",
            "prompt": (
                f"{IDENTITY}\n"
                f"ROLE/PURPOSE: the master anchor image for the armed version of the "
                f"player-controlled protagonist of a 2D side-scrolling roguelite. Every "
                f"other weapon and every armed animation is aligned against this image.\n"
                f"SUBJECT: the character from the reference image, holding {ANCHOR_WEAPON} "
                f"in his right hand.\n"
                f"{STANCE}\n"
                f"VIEW: {view_desc}.\n"
                f"{view_extra}\n"
                f"{STYLE}\n"
                f"GAME-SCALE READ: at {BASE_SIZE} px the head, the shoulder line, the "
                f"gripping hand and the weapon's silhouette must all be instantly readable; "
                f"the figure must read as a carved wooden effigy, never as a cartoon.\n"
                f"{TECH}\n{LOCKS}\n{EXCLUDE}"
            ),
        })

    with open(OUT, "w") as fh:
        json.dump({
            "generated_by": "build_anchor_prompts.py",
            "purpose": "armed alignment anchor, four views",
            "anchor_weapon": ANCHOR_WEAPON,
            "total": len(items),
            "items": items,
        }, fh, indent=1, ensure_ascii=False)

    print(f"wrote {OUT}")
    print(f"  anchor : {len(items)}")
    for it in items:
        print(f"    {it['id']:<16} {it['file']}")


if __name__ == "__main__":
    main()
