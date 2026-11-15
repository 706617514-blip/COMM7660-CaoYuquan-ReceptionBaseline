#!/usr/bin/env python3
"""Build armed action prompts: the 12 existing actions, re-drawn with a weapon.

Why a separate set
------------------
The unarmed action set (hero_run, hero_combo1, ...) is the modelling reference:
it shows the body's pose with nothing in the hands. The armed set is what the
game actually shows, and the two must agree frame for frame, so each armed
prompt keeps its unarmed counterpart's body pose verbatim and adds only what the
weapon does.

The stance is pinned to the approved anchor: same character, same underlayer,
same body scale, weapon held in the right hand. The anchor image is passed as
the reference, so the figure matches the pose and proportions a reviewer already
approved.

There are two things this file must NOT do, both learned from the gear batch:
  - it must not describe the weapon by where it sits on the body ("laced to the
    shin" produced a leg instead of a boot), so weapons are described by their
    own form;
  - it must not leave the weapon out of the action - a run with the sword still
    hanging limp from a resting hand does not read as a run.

Output: docs/art/prompts/action-armed-prompts.json
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "action-armed-prompts.json")

BASE_SIZE = "96x144"

# The same weapon as the anchor, so the approved anchor pose carries over.
ANCHOR_WEAPON = "a plain straight one-handed sword, simple crossguard, wrapped grip"

# How the hand must sit on the weapon. Without this the model sometimes grips the
# blade instead of the handle, which reads as a mistake at game scale.
SWORD_STRUCTURE = (
    "SWORD STRUCTURE — read this before drawing the weapon. A sword is a SINGLE "
    "CONTINUOUS OBJECT. It has a handle at ONE end and a blade at the OTHER end, and "
    "nothing else. Reading outward from the far end: pommel (small knob), then the "
    "wrapped handle, then the crossguard, then the blade, then the tip. "
    "The hand closes around the WRAPPED HANDLE ONLY, between the pommel and the "
    "crossguard. The pommel is the only part of the weapon that appears behind the "
    "fist, and it is small. "
    "THE BLADE EXISTS ON ONE SIDE ONLY. There is exactly one blade, it starts at the "
    "crossguard on the far side of the fist, and it is the only long part of the "
    "weapon that extends away from the hand. The weapon must NEVER project steel out "
    "of both sides of the fist — no blade in front AND behind the hand, no second "
    "blade, no blade passing through the palm. If steel appears on both sides of the "
    "gripping hand, the drawing is wrong and must be redone with the blade on one "
    "side only."
)

GRIP_RULE = SWORD_STRUCTURE

# Direction-of-travel rule: in every locomotion pose the blade leads the movement.
BLADE_LEADS = (
    "BLADE DIRECTION: the character faces the direction of travel and the blade points the "
    "same way he is moving. A running or walking figure carries the sword with the tip "
    "FORWARD, ahead of the body, angled slightly down; the tip never trails behind the "
    "back and the sword is never dragged behind him."
)

# Global grip rule. The first armed run put the hand on the BLADE (hand wrapped
# Direction rule. In the first armed run the run pose carried the sword tip
# trailing backwards, which reads wrong for a forward sprint.
DIRECTION_RULE = (
    "DIRECTION: when the character travels forward (run, dash, charge), the weapon "
    "points FORWARD in the direction of travel with its tip leading ahead of the body, "
    "never dragging behind. Only when the pose explicitly swings the weapon backwards "
    "may the tip trail behind the figure."
)

IDENTITY = (
    "IDENTITY LOCK: the attached reference image is the single source of truth for this "
    "character AND for how he holds his weapon. Reproduce that exact individual — same "
    "facial structure, same hairline and hair shape, same stubble, same eye colour, same "
    "head-to-body ratio, same shoulder width, same limb length, same grip. Do NOT "
    "redesign, restyle, age, slim, lengthen or beautify the character. "
    "CLOTHING: keep the plain tight undergarment layer the reference shows — a collarless "
    "undershirt and close-fitting trousers, bare forearms, bare shins, bare feet. No belt, "
    "no shoulder strap, no outer tunic, no armour, no helmet, no boots. "
    "The character holds ONE weapon and wears nothing else. "
    + SWORD_STRUCTURE
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
    "centred horizontally, no perspective distortion. The weapon is PART OF THIS IMAGE and "
    "must follow the action — draw it attached to the hand, in the same rendering style and "
    "palette, swinging or carried as the pose requires. Do not draw it as a separate object "
    "floating beside the figure and do not leave it hanging in a resting position when the "
    "pose is a swing."
)

LOCKS = (
    "LOCKS: preserve the character's identity, stocky proportions, head shape, palette and "
    "line weight exactly as in the reference; preserve the upper-left light direction; keep "
    "the same carved-woodcut rendering language and the same weapon."
)

EXCLUDE = (
    "EXCLUDE: text, labels, watermarks, mockup frames, borders, background scenery, ground, "
    "floor shadow, duplicate characters, cropped edges, signature, UI chrome, colour "
    "swatches. Do not add a shield, a second weapon, armour, a helmet, a cape or any other "
    "equipment."
)

VIEWS = {
    "right": "strict orthographic SIDE VIEW facing RIGHT, no perspective",
    "left": "strict orthographic SIDE VIEW facing LEFT, no perspective (the same character "
            "seen from the opposite side)",
    "back": "strict orthographic BACK VIEW seen directly from behind, no perspective",
    "34": "THREE-QUARTER view from the front-side at roughly 45 degrees, near-orthographic, "
          "no strong perspective distortion",
}

# ---------------------------------------------------------------------------
# The armed actions.
#
# Each entry is (id, label, unarmed body pose, what the WEAPON does, views).
# The body pose strings are copied from the unarmed ACTIONS table so the two sets
# stay in lockstep; only the weapon clause is new.
# ---------------------------------------------------------------------------
ACTIONS_ARMED = [
    ("idle", "IDLE",
     "standing still in a calm neutral ready stance, weight balanced, both arms hanging "
     "slightly away from the body so the silhouette stays open, small relaxed breathing "
     "posture",
     "The weapon hangs loosely from a relaxed right hand, pointing diagonally down and "
     "forward with its tip near the ground beside the front foot.",
     ["right", "left", "back", "34"]),

    ("run", "RUN",
     "sprinting forward mid-stride, one leg driving back and the other swinging through, "
     "torso leaning into the run, both arms pumping in opposition to the legs, elbows bent",
     "The weapon is carried in the pumping right hand, held clear of the body, the blade "
     "pointing FORWARD in the direction of travel with its tip leading ahead of the "
     "figure, angled slightly down so it does not cross the legs.",
     ["right", "left", "back", "34"]),

    ("jump", "JUMP",
     "airborne at the top of a jump, knees tucked up, arms bent at the sides for balance, "
     "cloth lifted by the upward motion",
     "The weapon is gripped in the right hand and held out to the side for balance, angled "
     "down, its weight trailing the body's upward motion.",
     ["right", "left"]),

    ("combo1", "ATTACK 1",
     "mid horizontal right-hand strike thrown across the body at chest height, torso "
     "rotated into the strike, rear hand pulled back to the hip, weight on the front foot",
     "The weapon leads the strike: the blade is swept horizontally across the body at chest "
     "height, arm extended, the edge clearly cutting through the arc, the tip trailing the "
     "swing.",
     ["right", "left"]),

    ("combo2", "ATTACK 2",
     "return backhand sweep travelling the other way, forearm angled across the chest, "
     "body coiled and twisted, rear foot pivoting",
     "The weapon reverses direction with the body: the blade sweeps back the other way, "
     "edge leading, the arm crossing the chest as the torso uncoils.",
     ["right", "left"]),

    ("combo3", "ATTACK 3",
     "heavy overhead two-handed finishing blow, both fists clasped and raised high then "
     "driving straight down, deep lunge with the front knee bent, whole body leaning "
     "forward with the impact",
     "The weapon is gripped in BOTH hands and driven straight down overhead, the blade "
     "vertical and pointing at the ground, the whole line of the arm and blade committed to "
     "the downward strike.",
     ["right", "left"]),

    ("skill_slam", "GROUND SLAM",
     "crashing down into the ground, deep crouch with both knees bent wide, head down, "
     "shockwave posture, arms driven straight downward",
     "The weapon is driven point-first into the ground at the end of the swing, the blade "
     "buried at the impact point, both hands on the grip, the body braced over it.",
     ["right", "left"]),

    ("skill_blink", "BLINK DASH",
     "mid dash-step forward at high speed, body stretched low and leaning far forward, "
     "trailing leg extended, cloth streaming behind, one arm reaching forward",
     "The weapon is held low and trailing behind the body in the right hand, its blade "
     "skimming backward with the dash, adding a streak of motion to the silhouette.",
     ["right", "left"]),

    ("skill_wave", "WAVE SLASH",
     "sweeping forward and outward in a wide flat arc, torso rotated fully, rear arm angled "
     "back, front foot planted hard",
     "The weapon carves the arc: the blade sweeps forward and outward in a wide flat "
     "horizontal slash, arm fully extended, the edge leading the whole way through.",
     ["right", "left"]),

    ("skill_ult", "ULTIMATE",
     "unleashing a huge overhead strike, both arms raised high and fully extended upward, "
     "back arched, chest open, feet planted wide apart, aura posture",
     "The weapon is raised in BOTH hands straight overhead, blade pointing at the sky, the "
     "arms fully extended, the whole figure coiled beneath the raised blade.",
     ["right", "left"]),

    ("hurt", "HURT",
     "struck and reeling backward, torso twisted away from the blow, head snapped back, one "
     "arm flung out, knees buckling, losing balance",
     "The weapon is knocked off its line by the hit: the right arm is flung out and the "
     "blade swings wide and uncontrolled, its point dragged away from the body.",
     ["right", "left"]),

    ("block", "BLOCK",
     "bracing defensively, shoulders hunched, body compressed and turned side-on, both feet "
     "planted, clearly not moving",
     "The weapon is held up across the body as a barrier, gripped in the right hand with "
     "the flat of the blade turned outward, the left forearm braced behind it, the whole "
     "line of the blade covering the chest and face.",
     ["right", "left"]),
]


def main():
    items = []
    for aid, label, body, weapon, views in ACTIONS_ARMED:
        for view in views:
            items.append({
                "id": f"armed_{aid}_{view}",
                "category": "hero_armed",
                "action": aid,
                "view": view,
                "file": f"armed_{aid}_{view}.png",
                "prompt": (
                    f"{IDENTITY}\n"
                    f"ROLE/PURPOSE: armed action sprite ({label}) for the player-controlled "
                    f"protagonist of a 2D side-scrolling roguelite. This is the frame the "
                    f"game shows while the player carries a weapon.\n"
                    f"SUBJECT: the character from the reference image, holding "
                    f"{ANCHOR_WEAPON} in his right hand, {body}.\n"
                    f"WEAPON: {weapon}\n"
                    f"{GRIP_RULE}\n"
                    f"VIEW: {VIEWS[view]}.\n"
                    f"{STYLE}\n"
                    f"GAME-SCALE READ: at {BASE_SIZE} px the head, the shoulder line, the "
                    f"gripping hand and the weapon's silhouette must all be instantly "
                    f"readable; the figure must read as a carved wooden effigy, never as a "
                    f"cartoon.\n"
                    f"{TECH}\n{LOCKS}\n{EXCLUDE}"
                ),
            })

    with open(OUT, "w") as fh:
        json.dump({
            "generated_by": "build_action_armed_prompts.py",
            "purpose": "armed action set, derived from the approved anchor",
            "anchor_weapon": ANCHOR_WEAPON,
            "total": len(items),
            "items": items,
        }, fh, indent=1, ensure_ascii=False)

    print(f"wrote {OUT}")
    print(f"  armed actions : {len(items)}")
    from collections import Counter
    c = Counter(it["action"] for it in items)
    for a, n in c.items():
        print(f"    {a:<14} {n}")


if __name__ == "__main__":
    main()
