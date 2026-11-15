#!/usr/bin/env python3
"""Per-item colour specs for the 35 equipment pieces.

The protagonist stays a brown woodcut figure - that is the approved look and it
does not change. Equipment is the opposite: each piece must read as what its
name says it is. A frost breastplate should look cold, a cinder cloak should
look burnt, a crystal staff should look like crystal. Right now every item is
the same desaturated brown, so at 96x144 the player cannot tell a leather vest
from a steel plate.

Each entry gives the item's material and a small palette. The palette is
deliberately narrow - four to six values - because the sprite is quantised to
32 colours and the woodcut's four-layer shading (outline, shadow, body, lit
face) has to survive. Colours are chosen for the material, not for the game's
existing vector art, which is being replaced.

Structure per entry:
    material   what the thing is made of, in words the model can draw
    base       the dominant colour
    light      the lit plane
    dark       the shadow
    accent     the one detail that makes the item recognisable
"""

# ---------------------------------------------------------------------------
# head
# ---------------------------------------------------------------------------
HEAD = {
    "leatherHelm": {
        "material": "boiled leather, stitched panels, soft worn surface",
        "base": "#6b4a2a", "light": "#9a7048", "dark": "#3d2a17",
        "accent": "#c9a06a",
    },
    "ironHelm": {
        "material": "forged iron, riveted band, cold hammered steel",
        "base": "#6e7782", "light": "#a8b1bb", "dark": "#3a4048",
        "accent": "#c9d2dc",
    },
    "guardHelm": {
        "material": "blued steel with hinged cheek plates and a brass nose bar",
        "base": "#5a6470", "light": "#8d96a1", "dark": "#2f353d",
        "accent": "#b08d4a",
    },
    "hornHelm": {
        "material": "dark iron helm with two pale bone horns",
        "base": "#5c5a55", "light": "#8d8a82", "dark": "#302f2b",
        "accent": "#d8cfb4",
    },
    "thunderHelm": {
        "material": "iron helm with horns crackling with blue-white lightning",
        "base": "#4a5566", "light": "#7d8ba0", "dark": "#252c36",
        "accent": "#8fd4ff",
    },
    "stormRing": {
        "material": "thin iron circlet set with a dark storm stone",
        "base": "#5a5f68", "light": "#8b919b", "dark": "#2e3238",
        "accent": "#7fb8e8",
    },
}

# ---------------------------------------------------------------------------
# torso
# ---------------------------------------------------------------------------
TORSO = {
    "leatherVest": {
        "material": "stitched leather vest, oiled and worn",
        "base": "#7a5230", "light": "#a87a4c", "dark": "#452e1a",
        "accent": "#c9a06a",
    },
    "chestPlate": {
        "material": "polished steel breastplate with a raised centre ridge",
        "base": "#7d8794", "light": "#b6c0cc", "dark": "#414a55",
        "accent": "#dde5ee",
    },
    "pauldron": {
        "material": "layered steel shoulder plates over a leather harness",
        "base": "#6b7480", "light": "#9ea8b4", "dark": "#383f48",
        "accent": "#8a5f34",
    },
    "fullPlate": {
        "material": "full steel plate armour, riveted and articulated",
        "base": "#727c88", "light": "#aab4c0", "dark": "#3c434c",
        "accent": "#d2dae4",
    },
    "frostArmor": {
        "material": "pale blue-white ice-forged plate, frost crusting the edges",
        "base": "#7fa8c4", "light": "#c2e0f0", "dark": "#3f5f78",
        "accent": "#e8f6ff",
    },
    "thornMail": {
        "material": "dark iron mail bristling with long rust-brown thorns",
        "base": "#4a4038", "light": "#7a6a58", "dark": "#241e19",
        "accent": "#8a4a2a",
    },
    "aegisPlate": {
        "material": "gilded ceremonial plate with engraved knotwork",
        "base": "#8a6b2f", "light": "#c9a44e", "dark": "#4a3818",
        "accent": "#f0d98a",
    },
}

# ---------------------------------------------------------------------------
# back
# ---------------------------------------------------------------------------
BACK = {
    "shortCape": {
        "material": "short wool cape, plain weave",
        "base": "#6b3a2a", "light": "#9a5a42", "dark": "#3a1f16",
        "accent": "#b87a5a",
    },
    "longCloak": {
        "material": "long heavy travelling cloak, coarse dark cloth",
        "base": "#3f4a3a", "light": "#63705a", "dark": "#222a1f",
        "accent": "#8a9a78",
    },
    "runeCloak": {
        "material": "deep indigo cloak embroidered with glowing runes",
        "base": "#3a3a6b", "light": "#5c5c9a", "dark": "#1f1f3a",
        "accent": "#8fa8ff",
    },
    "wingCape": {
        "material": "cloak of layered dark feathers, raven-like",
        "base": "#2f2a33", "light": "#544c5c", "dark": "#17141a",
        "accent": "#7a6a8a",
    },
    "bloodCharm": {
        "material": "small bone charm strung on a leather cord, stained red",
        "base": "#8a3a2a", "light": "#c25a42", "dark": "#4a1f16",
        "accent": "#e8c8a0",
    },
    "cinderCloak": {
        "material": "charred cloak, embers glowing through the burnt holes",
        "base": "#3a2a22", "light": "#6a4a32", "dark": "#1a1210",
        "accent": "#ff7a3c",
    },
}

# ---------------------------------------------------------------------------
# weapon
# ---------------------------------------------------------------------------
WEAPON = {
    "rustySword": {
        "material": "pitted rust-brown iron blade, crude worn guard",
        "base": "#7a4a2a", "light": "#a8703f", "dark": "#3f2413",
        "accent": "#c98a4a",
    },
    "shortSword": {
        "material": "clean bright steel short blade, plain guard",
        "base": "#8a95a3", "light": "#c2ccd8", "dark": "#4a525c",
        "accent": "#e8f0f8",
    },
    "broadSword": {
        "material": "heavy steel broadsword, deep fuller, long quillons",
        "base": "#7d8794", "light": "#b6c0cc", "dark": "#414a55",
        "accent": "#dde5ee",
    },
    "twinBlades": {
        "material": "matched pair of slender curved steel blades",
        "base": "#8a95a3", "light": "#c2ccd8", "dark": "#4a525c",
        "accent": "#e8f0f8",
    },
    "crystalStaff": {
        "material": "tall staff crowned with translucent violet crystal shards",
        "base": "#6a4a8a", "light": "#a87ac2", "dark": "#35244a",
        "accent": "#d8b0ff",
    },
    "battleAxe": {
        "material": "heavy iron war axe, dark haft, chipped edge",
        "base": "#5a5f68", "light": "#8b919b", "dark": "#2e3238",
        "accent": "#a8b1bb",
    },
    "voidBlade": {
        "material": "black blade that swallows light, violet edge glow",
        "base": "#2a2438", "light": "#4a3f5c", "dark": "#12101a",
        "accent": "#9a6aff",
    },
    "trident": {
        "material": "bronze trident with three barbed prongs",
        "base": "#8a6b2f", "light": "#c9a44e", "dark": "#4a3818",
        "accent": "#f0d98a",
    },
    "oathkeeper": {
        "material": "ceremonial silver sword and matching tower shield",
        "base": "#9aa3ad", "light": "#d2dae4", "dark": "#525a64",
        "accent": "#f0f4fa",
    },
    "arcaneTome": {
        "material": "thick leather-bound tome, brass clasps, glowing pages",
        "base": "#5a3a2a", "light": "#8a5a3a", "dark": "#2e1e14",
        "accent": "#ffd166",
    },
}

# ---------------------------------------------------------------------------
# feet
# ---------------------------------------------------------------------------
FEET = {
    "strawShoes": {
        "material": "woven straw sandals, pale dry fibre",
        "base": "#a89060", "light": "#d4bc88", "dark": "#6a5838",
        "accent": "#e8d8b0",
    },
    "windBoots": {
        "material": "light leather boots, thin soles, pale tan",
        "base": "#8a6a48", "light": "#b89468", "dark": "#4a3826",
        "accent": "#d8b890",
    },
    "greaves": {
        "material": "steel shin guards with riveted knee plates",
        "base": "#6e7782", "light": "#a8b1bb", "dark": "#3a4048",
        "accent": "#c9d2dc",
    },
    "stoneBoots": {
        "material": "massive grey stone-and-iron boots, slab soles",
        "base": "#6a6a66", "light": "#9a9a94", "dark": "#383834",
        "accent": "#b8b8b0",
    },
    "emberBoots": {
        "material": "dark iron boots with molten orange seams",
        "base": "#4a3a32", "light": "#7a5a42", "dark": "#241a16",
        "accent": "#ff7a3c",
    },
    "phaseBoots": {
        "material": "boots whose lower half fades into pale blue translucency",
        "base": "#5a7a8a", "light": "#8ab0c2", "dark": "#2e4450",
        "accent": "#b8e0f0",
    },
}

ALL = {}
for slot, table in (("head", HEAD), ("torso", TORSO), ("back", BACK),
                    ("weapon", WEAPON), ("feet", FEET)):
    for eid, spec in table.items():
        ALL[(slot, eid)] = spec


def colour_block(slot, eid):
    """Return the palette sentence for one item, or '' if unknown."""
    spec = ALL.get((slot, eid))
    if not spec:
        return ""
    return (
        f"COLOUR — this item is {spec['material']}. Paint it in its own material "
        f"colours, NOT the character's brown: base {spec['base']}, lit plane "
        f"{spec['light']}, shadow {spec['dark']}, and {spec['accent']} for the "
        f"detail that identifies it. Keep the woodcut's four-layer shading "
        f"(dark outline, shadow, body, lit face) and keep the hatching, but the "
        f"hues must read as this material at a glance. The item must be clearly "
        f"distinguishable from every other item in the set by colour alone."
    )


if __name__ == "__main__":
    print(f"{len(ALL)} items")
    for (slot, eid), spec in sorted(ALL.items()):
        print(f"  {slot:7s} {eid:14s} {spec['base']} / {spec['accent']}")
