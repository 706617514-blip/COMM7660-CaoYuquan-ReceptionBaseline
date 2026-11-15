#!/usr/bin/env python3
"""Build prompt sets for the non-character, non-equipment game entities.

The game draws 26 entities procedurally at runtime. Everything the player
actually looks at while playing needs real art: the three enemies they fight,
the scenery they run past, the plots they farm, and the effects that fire when
something hits. This script writes prompt sets for all of them.

Styling rules, matching the decisions already made for this project:
  - The environment is the same carved-woodcut world as the protagonist. The
    linework, the hatching and the light direction come from the hero art.
  - Colour follows the entity's own nature. The protagonist is a brown figure
    because he is one man; a venom sac is green because it is venom. Colour is
    how the player tells a spitter from a runner at a glance in a dark scene.
  - Enemies are authored in four views because they move and get knocked back.
    Scenery is authored once, because the world does not turn.

Output:
    entity-prompts.json      all entities, ready for gen_direct.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "entity-prompts.json")

# ---------------------------------------------------------------------------
# Shared style. Same world as the protagonist, different subject matter.
# ---------------------------------------------------------------------------
WORLD = (
    "ART DIRECTION: dark-fantasy woodcut / late-medieval engraving, the same carved "
    "world as the game's protagonist. Every form is built from hard chiselled facets "
    "with dense fine hatching for shading. Absolutely NO soft gradients, NO smooth "
    "airbrushing, NO glossy anime rendering. Light source is fixed at upper-left. "
    "Four-layer shading throughout: dark outline, shadow, body mass, lit face. "
    "COLOUR: paint the subject in its own natural colours. Do not tint it brown to "
    "match the protagonist — colour is how the player identifies what they are "
    "looking at."
)

TECH_COMMON = (
    "TECHNICAL OUTPUT: single isolated subject, fully transparent background (real "
    "alpha channel, no checkerboard, no white or coloured matte). No ground, no cast "
    "shadow, no scenery behind it, no frame, no text, no watermark."
)

VIEWS_ENEMY = {
    "right": "strict orthographic SIDE VIEW facing RIGHT, no perspective",
    "left": "strict orthographic SIDE VIEW facing LEFT, no perspective "
            "(the same creature seen from the opposite side)",
    "back": "strict orthographic BACK VIEW seen directly from behind, no perspective",
    "34": "THREE-QUARTER view from the front-side at roughly 45 degrees, "
          "near-orthographic, no strong perspective distortion",
}

# ---------------------------------------------------------------------------
# ENEMIES - four views each. These are what the player fights.
# ---------------------------------------------------------------------------
ENEMIES = [
    ("crawler", "爬虫", 4, 46, 46,
     "a low scuttling insect-like crawling horror, wedge-shaped armoured carapace "
     "tapering to a forward point, two small glowing pale-yellow eyes set low, a "
     "row of short spikes along the spine, six stubby legs braced wide",
     "rust-red and burnt umber chitin: base #a8402a, lit plate #d97a5c, deep shadow "
     "#5a2515, eye glow #ffd9a0"),

    ("runner", "冲刺虫", 4, 46, 43,
     "a lean sprinting insect predator, forward-leaning aerodynamic body, long "
     "powerful hind legs coiled to spring, a sharp horn spike on the head, small "
     "bright eyes",
     "charcoal and ember: dark carapace #2a2118, lit carapace #6b5232, hot orange "
     "underside glow #ff7a3c, eye shine #ffd9a0"),

    ("spitter", "吐酸虫", 4, 50, 50,
     "a bloated squat acid-spitting creature, heavy rounded body, a swollen "
     "translucent green venom sac on its back, ridged wrinkled hide, wide dark eyes, "
     "a small dripping maw",
     "violet hide with a green sac: hide #5a4d80, lit hide #7a68a8, deep shadow "
     "#241f33, venom sac #7ab84a with highlight #bfe88a"),
]

# ---------------------------------------------------------------------------
# SCENERY - one view each. The world does not turn, so one is enough.
# ---------------------------------------------------------------------------
SCENERY = [
    ("treeA", "枯树", 68, 120,
     "a tall dead tree, bare twisted trunk splitting into stark clawing branches, "
     "bark deeply scored and gnarled, no leaves",
     "ash-grey weathered bark: base #4a4038, lit #7a6a58, shadow #241e19, "
     "bleached dead wood #9a8a72"),

    ("treeB", "枯树(小)", 68, 90,
     "a shorter gnarled dead tree with a forked trunk and a few broken branch stubs, "
     "bark cracked and peeling",
     "ash-grey weathered bark: base #4a4038, lit #7a6a58, shadow #241e19, "
     "bleached dead wood #9a8a72"),

    ("bush", "灌木", 60, 40,
     "a low dense thorn bush, tangled woody stems, small dark leaves, a few pale "
     "dry berries",
     "deep green scrub: base #3f4a2a, lit #6b7a44, shadow #202616, berries #b84a3a"),

    ("post", "木桩", 8, 34,
     "a short weathered fence post driven into the ground, split and splintered at "
     "the top, wood grain visible",
     "grey weathered wood: base #5a4a3a, lit #8a7458, shadow #2e2419"),

    ("torch", "火把", 13, 34,
     "a wooden torch with a wrapped pitch-soaked head, burning with a small orange "
     "flame and a wisp of smoke",
     "wood #5a3a22, flame core #ffd166, flame outer #ff7a3c, glow #ffb066"),

    ("anvil", "铁砧", 60, 58,
     "a heavy blacksmith's anvil on a wooden stump base, horned on one end, flat "
     "scarred top, worn edges",
     "dark iron: base #4a4f58, lit #7d8794, shadow #22262c, rust patch #8a4a2a, "
     "stump wood #5a3a22"),

    ("altar", "祭坛", 64, 54,
     "a squat stone altar with carved relief panels on its face, a shallow offering "
     "bowl on top, cracks and moss in the joints",
     "old grey stone: base #6a6a66, lit #9a9a94, shadow #383834, moss #4a5a3a, "
     "offering stain #8a2a2a"),

    ("shop", "商店", 80, 68,
     "a small timber market stall with a striped awning, a counter board across the "
     "front, crates and bundles stacked behind",
     "warm timber #7a5230, lit #a87a4c, shadow #452e1a, awning cloth #8a3a2a with "
     "#c9a06a stripes"),

    ("rack", "武器架", 90, 70,
     "a wooden weapon rack with three horizontal crossbars, a few plain blades and "
     "hafts resting in it",
     "timber frame #5a3a22, lit #8a5a34, shadow #2e1e14, steel blades #8a95a3"),

    ("gate", "石门", 76, 88,
     "a heavy stone archway gate with iron-banded timber doors, a barred window "
     "above, runes cut into the lintel",
     "grey stone #6a6a66, lit #9a9a94, shadow #383834, iron bands #3a4048, "
     "rune glow #7fb8e8"),
]

# ---------------------------------------------------------------------------
# FARMING - one view each. Plot state changes, so these are small and simple.
# ---------------------------------------------------------------------------
FARMING = [
    ("soil", "耕地", 52, 34,
     "a tilled plot of dark soil seen at a slight angle, neat furrow ridges running "
     "across it, loose clods at the edges",
     "rich dark earth: base #4a3826, lit #7a5c3a, shadow #241a10"),

    ("sprout", "幼苗", 19, 23,
     "a young seedling with two small unfolding leaves on a short stem, just broken "
     "through the soil",
     "fresh green: base #5a8a3a, lit #8ac25a, shadow #2a4a1a"),

    ("crop", "成熟作物", 20, 32,
     "a mature crop plant heavy with grain, nodding seed heads on tall stalks, "
     "leaves curling as they dry",
     "golden ripe grain: base #c9a44e, lit #f0d98a, shadow #6a5424, stem #7a8a3a"),

    ("seed", "种子", 13, 11,
     "a single seed kernel with a hard papery husk, slightly tapered, a fine seam "
     "along one side",
     "pale husk: base #b8a070, lit #e0cfa0, shadow #6a5838"),

    ("clod", "土块", 4, 8,
     "a small clump of earth, irregular and crumbly, a few darker specks in it",
     "dark earth: base #4a3826, lit #6a5034, shadow #241a10"),
]

# ---------------------------------------------------------------------------
# EFFECTS - one view each, drawn small and bright. These are additive in game,
# so they are authored on transparent backgrounds with strong cores.
# ---------------------------------------------------------------------------
EFFECTS = [
    ("spark", "火星", 6, 6,
     "a single bright spark, a tiny four-pointed star of hot light",
     "white-hot core #fff4e0, orange flare #ff7a3c"),

    # A glow is an ADDITIVE light pool, not an object. Drawing it as a solid ball
    # would occlude the ground it is meant to light up.
    ("glow", "光晕", 112, 112,
     "a formless radial gradient of warm light: brightest at the very centre and "
     "fading smoothly outward until it disappears completely at the rim. It has NO "
     "outline, NO hard edge, NO texture and NO solid body — it is pure smooth light, "
     "like the halo a lantern casts on the ground",
     "warm light: solid #ffc06a only within the inner third, then a smooth falloff "
     "to fully transparent. No dark outline anywhere in this image."),

    ("acid", "酸弹", 18, 18,
     "a small globule of corrosive green liquid, glossy and slightly lumpy, with a "
     "faint dripping tail",
     "venom green: base #7ab84a, lit #bfe88a, shadow #3a5a24"),

    ("shadow", "影", 48, 16,
     "a flat dark ellipse used as a contact shadow under a standing creature, "
     "soft-edged and empty",
     "near-black #000000 at low opacity, no internal detail"),

    ("bladeA", "刀光A", 20, 34,
     "a short crescent slash of white-blue energy, thin and sharply tapered at both "
     "ends",
     "cold white core #e8f2fa, blue edge #8fd4ff"),

    ("bladeB", "刀光B", 20, 46,
     "a longer crescent slash arc of white-blue energy, wider in the middle, sharp "
     "at the tips",
     "cold white core #e8f2fa, blue edge #8fd4ff"),

    ("bladeC", "刀光C", 26, 40,
     "a heavy broad crescent slash of white-blue energy, thick and blunt, the mark "
     "of a two-handed blow",
     "cold white core #e8f2fa, blue edge #8fd4ff"),

    ("bladeS", "刀光S", 20, 52,
     "a long singular thrusting streak of white-blue energy, narrow and driving "
     "straight forward",
     "cold white core #e8f2fa, blue edge #8fd4ff"),
]


def build_item(eid, cname, size_w, size_h, subject, colour, views, kind):
    """One dict per entity (per view for enemies)."""
    out = []
    for view in views:
        view_desc = VIEWS_ENEMY[view] if view else None
        view_line = ""
        if view_desc:
            view_line = (
                f"VIEW: {view_desc}. For the left view, the creature must face the "
                f"opposite way — render it from that side rather than mirroring the "
                f"right view.\n"
            )
        out.append({
            "id": f"ent-{eid}" + (f"-{view}" if view else ""),
            "category": f"entity_{kind}",
            "entity": eid,
            "name_zh": cname,
            "view": view,
            "size": [size_w, size_h],
            "file": f"ent_{eid}" + (f"_{view}" if view else "") + ".png",
            "prompt": (
                f"{WORLD}\n"
                f"ROLE/PURPOSE: game art for a 2D side-scrolling roguelite. This is "
                f"the {cname} as the player sees it during play.\n"
                f"SUBJECT: {subject}.\n"
                f"{view_line}"
                f"MATERIAL AND COLOUR: {colour}. Paint it in exactly these material "
                f"colours — the hatching and linework are the protagonist's, but the "
                f"hues belong to this subject.\n"
                f"SILHOUETTE: drawn to read at roughly {size_w}x{size_h} px in game, "
                f"so the outline alone must identify what this is.\n"
                f"{TECH_COMMON}"
            ),
        })
    return out


def main():
    items = []
    for eid, cname, _n, w, h, subject, colour in ENEMIES:
        items += build_item(eid, cname, w, h, subject, colour,
                            ["right", "left", "back", "34"], "enemy")
    for eid, cname, w, h, subject, colour in SCENERY:
        items += build_item(eid, cname, w, h, subject, colour, [None], "scenery")
    for eid, cname, w, h, subject, colour in FARMING:
        items += build_item(eid, cname, w, h, subject, colour, [None], "farming")
    for eid, cname, w, h, subject, colour in EFFECTS:
        items += build_item(eid, cname, w, h, subject, colour, [None], "effect")

    with open(OUT, "w") as fh:
        json.dump({
            "generated_by": "build_entity_prompts.py",
            "purpose": "non-character game entities: enemies, scenery, farming, effects",
            "total": len(items),
            "items": items,
        }, fh, indent=1, ensure_ascii=False)

    from collections import Counter
    c = Counter(it["category"] for it in items)
    print(f"wrote {OUT}")
    print(f"  total : {len(items)}")
    for k, n in sorted(c.items()):
        print(f"    {k:<20} {n}")


if __name__ == "__main__":
    main()
