#!/usr/bin/env python3
"""
build_hero_prompts.py — 生成主角与装备的完整提示词清单（机器可读）。

为什么用脚本生成提示词而不是手写一个 JSON
------------------------------------------
138 条提示词手写必然出现风格漂移：第 40 条和第 90 条描述同一件装备的
材质时会不一致。这里把**不变量**（配色、光源、边缘处理、四层惯例、
EXCLUDE 清单）抽成常量，把**变量**（部位、档位、视图、机制可视化）
做成表，提示词由两者拼装 —— 与 config.js「数值集中在一张表」是同一个思路。

改风格只需改 STYLE_BLOCK 一处，138 条全部同步。

用法：
    python3 docs/art/prompts/build_hero_prompts.py
输出：
    docs/art/prompts/protagonist-prompts.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gear_colours import colour_block, ALL as GEAR_COLOURS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "protagonist-prompts.json")

# --------------------------------------------------------------------------
# 不变量：全 138 条逐字相同，保证风格不漂移
# --------------------------------------------------------------------------

BASE_SIZE = "96x144"

STYLE_BLOCK = (
    "ART DIRECTION: Dark-fantasy woodcut / late-medieval engraving. Every form is built as "
    "carved layered facets with hard chiselled edges and dense fine hatching strokes for "
    "shading. Absolutely NO soft gradients, NO smooth airbrushing, NO glossy anime rendering. "
    "Muted desaturated earth palette ONLY: ink outline #1a1611, shadow #251f18, body #393126, "
    "lit plane #655a49, top highlight #8a7d68. Skin #6b5a48. The single warm accent permitted "
    "in the whole image is a faint ember-orange #ff7a3c glint in the eyes. Light source is "
    "fixed at upper-left on every asset. Four-layer shading convention throughout: dark "
    "outline, body mass, lit face, small highlight."
)

# 装备专用风格块。
#
# 主角是棕色木刻小人，装备不是 —— 每件装备必须一眼看出是什么材质。
# 复用 STYLE_BLOCK 会冲突：那里写着 "Muted desaturated earth palette ONLY"，
# 模型会照做，把所有装备都画成主角同款棕色。所以装备单独一套：木刻的
# 刀法和排线照旧，但颜色交给 gear_colours.py 逐件指定。
GEAR_STYLE_BLOCK = (
    "ART DIRECTION: same carved-woodcut rendering as the reference figure — hard chiselled "
    "faceted forms, dense fine hatching strokes for shading, no soft gradients, no smooth "
    "airbrushing, no glossy anime rendering. Light source is fixed at upper-left. Four-layer "
    "shading convention throughout: dark outline, shadow, body mass, lit face. "
    "COLOUR IS DIFFERENT FROM THE WEARER: the character is a brown woodcut figure, but this "
    "equipment must be painted in its OWN material colours as specified below, NOT in the "
    "character's brown. The hatching and linework stay identical to the reference; only the "
    "hues change. Each item in this set must be instantly distinguishable from the others by "
    "colour, so that a player can tell a leather vest from a steel plate at a glance."
)

EXCLUDE_BLOCK = (
    "EXCLUDE: text, labels, watermarks, mockup frames, borders, background scenery, ground, "
    "floor shadow, duplicate characters, cropped edges, signature, UI chrome, colour swatches. "
    "ALSO EXCLUDE, and this is absolute: no weapon of any kind, no sword, no blade, no axe, no "
    "spear, no staff, no bow, no shield, no buckler, no armour piece, no helmet, no cape on the "
    "body layer. The body layer is a bare unarmed base figure in plain cloth: hands are empty "
    "and clearly visible. Equipment is composited on top of this layer later as separate images, "
    "so anything held or worn here would double up and collide."
)

LOCKS_BLOCK = (
    "LOCKS: preserve the character's identity, stocky proportions, head shape, palette, "
    "and line weight exactly across every asset; preserve the upper-left light direction; "
    "keep the same carved-woodcut rendering language."
)

TECH_BLOCK = (
    f"TECHNICAL OUTPUT: single isolated character or item, native size {BASE_SIZE} px, "
    "fully transparent background (real alpha channel, no checkerboard, no white or coloured "
    "matte), character standing on the bottom edge with feet at the very bottom, "
    "centred horizontally, no perspective distortion."
)

# 主角身份描述：所有动作/装备图共用，保证是"同一个人"
#
# 注意：这条描述在**纯文生图**下才有约束力。实测发现独立生成 172 张会得到
# 至少 4 张不同的脸（发型、脸型、眼睛颜色全不一致），所以正式出图走
# **图生图**：把 hero_base_right.png 作为参考图传给模型，身份由像素锁定，
# 而不是由文字描述锁定。此时 IDENTITY 退化为"说明用途"的上下文，
# 真正起作用的是 REF_BLOCK。
IDENTITY = (
    "a lone humanoid warrior-protagonist of compact stocky build, very short buzz-cut head with "
    "stubble, low centre of gravity, broad shoulders, short legs, wearing only a plain tight "
    "undergarment layer: a simple collarless undershirt tucked in and plain close-fitting "
    "trousers, with bare forearms and bare shins, no footwear. This is the bare base body and "
    "NOTHING ELSE: no belt, no shoulder strap, no outer tunic or robe or skirt, no cloak, no "
    "armour, no helmet, no boots or shoes, no gauntlets or bracers, no forearm or shin wraps, "
    "no sash, no pouches. Both hands are empty — no weapon and no shield. Everything worn is "
    "added later as separate composite layers, so the base body must stay visually neutral"
)

# 图生图模式下真正锁身份的一段。放在提示词最前，权重最高。
REF_BLOCK = (
    "IDENTITY LOCK: the attached reference image is the single source of truth for this "
    "character's FACE, HAIR, BODY and PROPORTIONS. Reproduce that exact individual — same "
    "facial structure, same hairline and hair shape, same stubble, same eye colour, same "
    "head-to-body ratio, same shoulder width, same limb length. Do NOT redesign, restyle, "
    "age, slim, lengthen or beautify the character. Change ONLY the pose and the facing "
    "direction. Do not copy the reference's pose or facing. "
    "CLOTHING RESET — this overrides the reference: strip the character down to his plain "
    "tight undergarment layer, a collarless undershirt and close-fitting trousers, with bare "
    "forearms, bare shins and bare feet. Remove every belt, shoulder strap, outer tunic, "
    "robe, skirt, sash, cloak, armour piece, helmet, boot, shoe, gauntlet, bracer, wrap, "
    "pouch and accessory the reference shows. Remove any weapon or shield the reference may "
    "show. The result must be the same man, unarmed and stripped to his underlayer, standing "
    "in a neutral stance with nothing for gear to rest on."
)

# 装备层用的参考块。
#
# 这里经历过一次方向修正。第一版要求"只画孤立物件、绝不出现人体"，理由是
# 合成时会变成两层人。实测发现这个方向是错的：孤立物件图（比如一个正面展示
# 的完整头盔）套到侧视图的角色身上时，视角和形态对不上，只能露出一点边缘，
# 看起来像贴在脖子上而不是戴在头上。位置和尺寸都精确校准过（头盔 29px、
# 胸甲 43px、靴子 25px，与身体完全吻合），观感依然不成立。
#
# 所以改成**穿戴态**：模型照着参考图里这个角色的**同一个视角、同一个姿势**
# 把装备画在他身上，然后**只保留装备**、把身体擦成透明。这样装备的形状天然
# 就是"穿在侧视角色身上"的形状，叠回去严丝合缝。
GEAR_REF_BLOCK = (
    "WEARING REFERENCE: the attached image shows the character who wears this "
    "item. Draw the described equipment AS WORN BY THAT EXACT FIGURE, in the "
    "same view and the same pose the reference shows, at the same scale and in "
    "the same position on the body. The equipment must be shaped by the body it "
    "sits on — a helm follows the skull, a breastplate follows the chest, a boot "
    "follows the foot — so that it lines up exactly when layered back over the "
    "reference figure.\n"
    # Footwear kept coming back as a product-style pair centred in the frame
    # instead of on the feet, which put the boots at the character's thighs once
    # composited. Name the body part's position explicitly rather than relying
    # on "as worn" to imply it.
    # The percentage bands matter: "as worn" alone kept producing a product
    # shot centred low in the frame. Footwear came back spanning 55-89% of the
    # image height when the feet occupy 83-99%, so the boots composited onto the
    # character's thighs. Naming the band removes the ambiguity.
    "WHERE IT SITS (measured from the TOP of the image): the item must occupy "
    "the same band of the frame as the body part it covers in the reference.\n"
    "  - headgear: the TOP band, roughly 0-27% of the image height\n"
    "  - body armour: the MIDDLE band, roughly 27-55%\n"
    "  - a back item: from about 27% down to 80%\n"
    "  - a weapon in hand: from about 35% to 80%, angled\n"
    "  - footwear: the BOTTOM band, roughly 82-100% of the image height, "
    "standing on the bottom edge, with the soles touching the very bottom of "
    "the frame\n"
    "Do not centre the item in the frame and do not put empty space below it. "
    "Every item sits where its body part already is in the reference.\n"
    "THEN OUTPUT THE EQUIPMENT ALONE: keep only the equipment's own pixels and "
    "make everything else fully transparent — the body, head, face, neck, "
    "shoulders, arms, hands, legs, feet, undershirt and trousers must all be "
    "invisible, leaving empty transparent space where they were. Do not draw a "
    "body, a person, or a mannequin. The result is the equipment in its worn "
    "position and worn silhouette, floating on transparency."
)

SCALE_READ = (
    "GAME-SCALE READ: at 96x144 px the head, the shoulder line and the empty hands must be "
    "instantly readable as a silhouette; the figure must read as a carved wooden effigy, "
    "never as a cartoon or a smooth 3D render."
)

# --------------------------------------------------------------------------
# 装备层专用 block
# --------------------------------------------------------------------------
#
# 为什么单独一套：把角色的 TECH/LOCKS 直接复用到装备上，模型会把整身人画出来。
# 实测 140 张装备中已生成的 39 张里，10 张（26%）出错，且**全部集中在
# left / right / back 三个视角，34 视角一张都没错**。逐句排查后确认是四处
# 文案在把模型往"画角色"上推：
#
#   1. VIEW 的 left 变体写着 "the same character seen from the opposite side"
#   2. TECH 要求 "character standing on the bottom edge with feet at the very
#      bottom" —— 对一顶头盔要求"脚贴底"，模型只能凭空补出一个人来满足
#   3. CONTEXT 写着 "the layer is worn by the character in the reference image"
#   4. LOCKS 要求 "preserve the character's identity ... head shape"
#
# 34 视角之所以侥幸过关，是因为它的 VIEW 文案提到了盾牌，把注意力从"角色"
# 上引开了。这不是模型随机性，是文案 bug，所以修文案而不是重试。
#
# 规则：装备 prompt 里 "character" 一词只允许出现在否定句中。
GEAR_TECH_BLOCK = (
    f"TECHNICAL OUTPUT: native size {BASE_SIZE} px, fully transparent background (real "
    "alpha channel, no checkerboard, no white, no grey and no coloured matte — in "
    "particular NOT a black or dark background). The equipment keeps the position and "
    "scale it has on the reference figure, so it will NOT be centred in the frame — a "
    "helm sits in the upper area, a boot in the lower area, and that is correct. The only "
    "opaque pixels are the equipment's own; every pixel of body, clothing and background "
    "is transparent. No perspective distortion, no cast shadow, no ground.\n"
    # 第二版补充：穿戴态下模型会为了"让装备有支撑"而保留一部分身体
    # （肩、颈、手），那样合成时就会变成两层人。必须显式要求把身体擦干净。
    "BODY ERASED: this is the critical step, and the most common failure is to leave a "
    "HEAD or a SKULL inside an open helm, or to draw a WHOLE SECOND FIGURE holding a "
    "weapon. After shaping the equipment on the reference "
    "figure, delete the figure completely. Every pixel that belongs to a living body must "
    "end up fully transparent — skin, cloth, hair, bone, shadow and outline included. An "
    "open helm must be an EMPTY SHELL: looking into it you see straight through to the "
    "background, with no skull, no cranium, no jaw, no teeth, no eye sockets and no face "
    "of any kind inside it. The same goes for every other opening. A viewer must see only "
    "the equipment floating on transparency, positioned exactly where it was worn."
)

GEAR_LOCKS_BLOCK = (
    "LOCKS: preserve the palette, the line weight and the upper-left light direction "
    "exactly as in every other asset of this set; keep the same carved-woodcut rendering "
    "language. The item's proportions must match the reference image's wearer so the layer "
    "registers when composited, but the wearer itself must not appear."
)

# 尺寸锚。第一轮 140 张装备图全部把物件画满整张画布：一个铁盔和一双靴子
# 占的像素一样多，合成到角色身上时比例完全崩掉（头盔比躯干还大）。
# 模型不知道物件相对身体该多大，必须显式给出占比。
#
# 数值来自基准人体：96x144 画布上，头高约 28px、肩宽约 44px、躯干高约 40px。
# 每项给出"物件应占画布高度的大致百分比"，让生成结果能直接叠合。
GEAR_SIZE_ANCHOR = {
    "head": (
        "SIZE ANCHOR: this item is HEADGEAR worn on the head. It must be exactly "
        "the size the reference figure's head requires — a helm covers the skull "
        "and stops at the jaw, and a circlet is a thin band around the brow. Do "
        "not enlarge it and do not shrink it: match the head in the reference."
    ),
    "torso": (
        "SIZE ANCHOR: this item is BODY ARMOUR worn on the torso. It must cover "
        "exactly the chest and waist the reference figure has — from the "
        "shoulders down to the belt line, and no further. Match the torso in the "
        "reference; do not extend it onto the head or the legs."
    ),
    "back": (
        "SIZE ANCHOR: this item is a BACK-SLOT item worn behind the shoulders. A "
        "cape or cloak hangs from the shoulder line down the back; a charm sits "
        "small on the upper back. Match the reference figure's own back — do not "
        "let it grow to cover the whole body."
    ),
    "weapon": (
        "SIZE ANCHOR: this item is a WEAPON, shown at the angle and position it "
        "occupies when held — a sword roughly from hand height to below the "
        "knee, angled forward and down. The weapon is the ONLY object in the "
        "image: draw the weapon itself, not a person holding it. There must be "
        "no hand, no arm, no shoulder, no body and no second figure anywhere in "
        "the image. The grip is empty space."
    ),
    "feet": (
        "SIZE ANCHOR: this item is FOOTWEAR worn on the feet. It must fit the "
        "reference figure's own foot and lower leg — ankle down to the sole. "
        "Match the foot in the reference exactly; do not make it larger."
    ),
}

# 装备图不给"脚贴底"这类要求，改为"物品居中"；这里也把 left 视角那句
# "the same character" 摘掉，只描述观察方向。
GEAR_VIEWS = {
    "left": "the same strict orthographic SIDE VIEW facing LEFT that the reference shows",
    "right": "the same strict orthographic SIDE VIEW facing RIGHT that the reference shows",
    "back": "the same strict orthographic BACK VIEW seen from directly behind that the reference shows",
    "34": "the same THREE-QUARTER view from the front-side that the reference shows",
}

# --------------------------------------------------------------------------
# 变量：视图
# --------------------------------------------------------------------------

VIEWS = {
    "right": (
        "strict orthographic SIDE VIEW facing RIGHT, no perspective",
        "hero_base_right.png",
    ),
    "left": (
        "strict orthographic SIDE VIEW facing LEFT, no perspective "
        "(the same character seen from the opposite side)",
        "hero_base_left.png",
    ),
    "back": (
        "strict orthographic BACK VIEW seen directly from behind, no perspective",
        "hero_base_back.png",
    ),
    "34": (
        "THREE-QUARTER view from the front-side at roughly 45 degrees, near-orthographic, "
        "no strong perspective distortion",
        "hero_base_34.png",
    ),
}

VIEW_EXTRA = {
    "right": "",
    "left": "",
    "back": (
        "Show the rear of the figure: the back of the bare head, the shoulder blades, the "
        "spine, the plain undershirt across the back, and both empty hands. Nothing is "
        "strapped, belted or worn across the back. "
    ),
    "34": (
        "Show the figure turned three-quarters toward the viewer so that the face, chest and "
        "both arms read clearly at an angle. "
    ),
}

# --------------------------------------------------------------------------
# 变量：场景动作
# --------------------------------------------------------------------------

ACTIONS = [
    ("idle", "IDLE", "standing still in a calm neutral ready stance, weight balanced, both arms hanging slightly away from the body so the silhouette stays open, small relaxed breathing posture", ["right", "left", "back", "34"]),
    ("run", "RUN", "sprinting forward mid-stride, one leg driving back and the other swinging through, torso leaning into the run, both arms pumping in opposition to the legs, elbows bent", ["right", "left", "back", "34"]),
    ("jump", "JUMP", "airborne at the top of a jump, knees tucked up, arms bent at the sides for balance, cloth lifted by the upward motion", ["right", "left"]),
    ("combo1", "ATTACK 1", "mid horizontal right-hand punch thrown across the body at chest height, torso rotated into the strike, rear hand pulled back to the hip, weight on the front foot", ["right", "left"]),
    ("combo2", "ATTACK 2", "return backhand hook sweeping the other way, forearm angled across the chest, body coiled and twisted, rear foot pivoting", ["right", "left"]),
    ("combo3", "ATTACK 3", "heavy overhead two-handed hammer blow, both fists clasped and raised high then driving straight down, deep lunge with the front knee bent, whole body leaning forward with the impact", ["right", "left"]),
    ("skill_slam", "GROUND SLAM", "crashing both fists down into the ground, deep crouch with both knees bent wide, head down, shockwave posture, arms driven straight downward", ["right", "left"]),
    ("skill_blink", "BLINK DASH", "mid dash-step forward at high speed, body stretched low and leaning far forward, trailing leg extended, cloth streaming behind, one arm reaching forward", ["right", "left"]),
    ("skill_wave", "WAVE SLASH", "sweeping one open hand forward and outward in a wide flat arc, palm leading, as if shoving the air away, torso rotated fully, rear arm angled back, front foot planted hard", ["right", "left"]),
    ("skill_ult", "ULTIMATE", "unleashing a huge overhead strike, both arms raised high and fully extended upward with fists open, back arched, chest open, feet planted wide apart, aura posture", ["right", "left"]),
    ("hurt", "HURT", "struck and reeling backward, torso twisted away from the blow, head snapped back, one arm flung out, knees buckling, losing balance", ["right", "left"]),
    ("block", "BLOCK", "bracing defensively with both forearms crossed in front of the chest and face, shoulders hunched, body compressed and turned side-on, both feet planted, clearly not moving", ["right", "left"]),
]

# --------------------------------------------------------------------------
# 变量：装备（严格对应 game/config.js 的 EQUIPMENT + EQUIP_FX）
# --------------------------------------------------------------------------

# (id, 中文名, 部位, 档位标签, 视觉描述)
EQUIPMENT = [
    # ---- 头部 head ----
    ("leatherHelm", "皮盔", "head", "base t0", "a simple low leather skullcap covering the crown, soft stitched seam, no brim"),
    ("ironHelm", "铁盔", "head", "base t1", "a rounded iron skullcap with a riveted band around its lower edge"),
    ("guardHelm", "护颊盔", "head", "base t2", "an iron helmet with hinged cheek guards flaring down over the jaw and a short nose bar"),
    ("hornHelm", "角盔", "head", "base t3", "a heavy iron helm with two swept horns curving up and outward from the temples, thick riveted brow band"),
    ("thunderHelm", "雷鸣角盔", "head", "special", "a horned iron helm crackling with thin blue-white lightning arcs across the horns and a small charge node at the brow"),
    ("stormRing", "雷鸣指环", "head", "special", "a plain iron circlet worn on the brow set with a single dark stone, thin electric arcs curling out of the stone"),
    # ---- 躯干 torso ----
    ("leatherVest", "皮甲", "torso", "base t0", "a simple stitched leather vest over the tunic, no shoulder coverage"),
    ("chestPlate", "胸甲", "torso", "base t1", "a solid iron breastplate over the chest with a plain rounded surface and simple leather straps"),
    ("pauldron", "肩甲", "torso", "base t2", "an iron breastplate with a large layered pauldron covering one shoulder, overlapping plates"),
    ("fullPlate", "全身板甲", "torso", "base t3", "a full heavy steel plate harness covering chest and shoulders with overlapping articulated lames and a thick gorget, massive and ornate"),
    ("frostArmor", "霜缚护甲", "torso", "special", "a plate harness sheathed in pale hoarfrost, sharp ice crystals growing from the shoulder plates, cold vapour curling off the metal"),
    ("thornMail", "荆棘甲", "torso", "special", "a leather-and-iron harness covered in dense rows of long curved thorn spikes pushing outward all over the chest and shoulders"),
    ("aegisPlate", "庇护胸铠", "torso", "special", "a polished breastplate with a faint translucent circular ward glowing softly across its face, geometric rune ring inset at the centre"),
    # ---- 背部 back ----
    ("shortCape", "短披风", "back", "base t0", "a short plain cloth cape ending at the waist, simple hem"),
    ("longCloak", "长斗篷", "back", "base t1", "a long heavy cloth cloak falling to the calves, deep vertical folds"),
    ("runeCloak", "符文披风", "back", "base t2", "a long cloak with a vertical column of carved rune marks down its centre and a stiff bordered hem"),
    ("wingCape", "翼形斗篷", "back", "base t3", "a dramatic cloak cut with long feathered wing-shaped panels flaring out at the shoulders, layered like pinions"),
    ("bloodCharm", "血滴护符", "back", "special", "a small dark stone pendant shaped as a hanging blood droplet on a cord, faint red glow inside the stone"),
    ("cinderCloak", "余烬披风", "back", "special", "a scorched tattered cloak with glowing ember sparks and small flame motes drifting off its burnt edges"),
    # ---- 武器 weapon ----
    ("rustySword", "锈剑", "weapon", "base t0", "a short notched blade heavily pitted with rust, crude worn crossguard, wrapped grip"),
    ("shortSword", "短剑", "weapon", "base t1", "a clean short straight blade, simple straight crossguard, plain grip"),
    ("broadSword", "阔剑", "weapon", "base t2", "a wide heavy broadsword with a thick blade, deep fuller, and a long straight quillons guard"),
    ("twinBlades", "双刀", "weapon", "base t3", "a matched pair of slender curved blades, one in each hand, minimal guards"),
    ("crystalStaff", "棱晶杖", "weapon", "base t4", "a tall staff crowned with a cluster of angular crystal shards, faceted and translucent, rune band below the head"),
    ("battleAxe", "战斧", "weapon", "special", "a massive two-handed war axe with a crescent blade and a thick reinforced haft"),
    ("voidBlade", "虚空之刃", "weapon", "special", "a blade that dissolves into blackness along its length, its edge fringed with wisps of dark void energy that peel off the steel"),
    ("trident", "三叉圣杖", "weapon", "special", "a tall ornate staff topped with a three-pronged trident head, prongs radiating faint light"),
    # "paired with" made the model draw a knight holding the pair - the shield
    # is a second object, and the generator resolves two objects by inventing a
    # bearer. Describe them as two items lying side by side instead.
    ("oathkeeper", "守誓者", "weapon", "special", "a broad knight's sword and, beside it, a large tower shield bearing a carved oath-knot emblem; two separate objects standing side by side, neither held nor worn, the sword upright and formal"),
    ("arcaneTome", "秘法之书", "weapon", "special", "a thick chained grimoire held open, its pages emitting drifting arcane glyphs and a soft violet glow"),
    # ---- 鞋 feet ----
    ("strawShoes", "草鞋", "feet", "base t0", "simple woven straw sandals with cord bindings around the ankles"),
    # Footwear wording matters more than for any other slot: "laced to the shin"
    # and "knee cop" both describe a place on a leg, so the generator drew a leg
    # wearing the item. Describe the item's own form instead of what it wraps.
    ("windBoots", "疾风靴", "feet", "base t1", "a pair of light leather ankle boots with thin soles and a streamlined shape, shown empty, as two loose objects side by side"),
    ("greaves", "护膝胫甲", "feet", "base t2", "a pair of armoured shin guards with riveted knee plates and strapped leather, shown empty as two loose objects side by side, with no leg inside them"),
    ("stoneBoots", "磐石靴", "feet", "base t3", "enormous heavy stone-and-iron boots, thick slab soles, chunky riveted plating, very massive"),
    ("emberBoots", "熔火战靴", "feet", "special", "armoured boots with glowing molten seams and cracks running across the metal, faint flame licking from the soles"),
    ("phaseBoots", "相位战靴", "feet", "special", "light boots whose lower half fades into translucency, faint afterimage echoes trailing behind the heels"),
]

SLOT_LABEL = {
    "head": "HEAD SLOT",
    "torso": "TORSO SLOT",
    "back": "BACK SLOT",
    "weapon": "WEAPON SLOT",
    "feet": "FEET SLOT",
}


def style_tag(view):
    """同一件衣服在不同视角下的可见性从句。"""
    return {
        "right": "seen from the character's right side",
        "left": "seen from the character's left side",
        "back": "seen from directly behind the character",
        "34": "seen from a three-quarter front-side angle",
    }[view]


def gear_style_tag(view):
    """装备件专用：只描述物品朝向，不提“角色”。

    装备 prompt 里 "character" 一旦出现在肯定句中，就会把模型推向“画一个人”，
    实测造成 26% 的装备图带上完整角色头像。详见 GEAR_TECH_BLOCK 上方注释。
    """
    return {
        "right": "seen from its right side",
        "left": "seen from its left side",
        "back": "seen from directly behind",
        "34": "seen from a three-quarter front-side angle",
    }[view]


def build():
    out = []

    # ---- 1. 本体 4 视图 ----
    for view, (view_desc, fname) in VIEWS.items():
        out.append({
            "id": "hero_base_" + view,
            "category": "hero_base",
            "view": view,
            "file": fname,
            "prompt": (
                f"{REF_BLOCK}\n"
                f"ROLE/PURPOSE: production base sprite for the player-controlled protagonist "
                f"of a 2D side-scrolling roguelite.\n"
                f"SUBJECT: the character from the reference image, in a calm neutral ready "
                f"stance, standing upright, arms slightly away from the body.\n"
                f"VIEW: {view_desc}.\n"
                f"{VIEW_EXTRA[view]}"
                f"{STYLE_BLOCK}\n{SCALE_READ}\n{TECH_BLOCK}\n{LOCKS_BLOCK}\n{EXCLUDE_BLOCK}"
            ),
        })

    # ---- 2. 动作 ----
    for aid, label, desc, views in ACTIONS:
        for view in views:
            view_desc, _ = VIEWS[view]
            out.append({
                "id": f"hero_{aid}_{view}",
                "category": "hero_action",
                "action": aid,
                "view": view,
                "file": f"hero_{aid}_{view}.png",
                "prompt": (
                    f"{REF_BLOCK}\n"
                    f"ROLE/PURPOSE: production action sprite for the player-controlled "
                    f"protagonist of a 2D side-scrolling roguelite.\n"
                    f"SUBJECT: the character from the reference image, {desc}.\n"
                    f"VIEW: {view_desc}.\n"
                    f"{VIEW_EXTRA[view]}"
                    f"{STYLE_BLOCK}\n{SCALE_READ}\n{TECH_BLOCK}\n{LOCKS_BLOCK}\n{EXCLUDE_BLOCK}"
                ),
            })

    # ---- 3. 装备 ----
    for eid, cname, slot, tier, visual in EQUIPMENT:
        for view in VIEWS:
            gear_view_desc = GEAR_VIEWS.get(
                view, VIEWS[view][0]
            )
            out.append({
                "id": f"eq-{slot}-{eid}-{view}",
                "category": "equipment",
                "slot": slot,
                "tier": tier,
                "name_zh": cname,
                "view": view,
                "file": f"eq_{slot}_{eid}_{view}.png",
                "prompt": (
                    f"{GEAR_REF_BLOCK}\n"
                    f"ROLE/PURPOSE: production equipment layer sprite for the {SLOT_LABEL[slot]} "
                    f"slot of a 2D side-scrolling roguelite. This image is a single equipment "
                    f"layer, composited over the body layer at runtime, so it must land on the "
                    f"body in exactly the worn position.\n"
                    f"SUBJECT: {visual}, {gear_style_tag(view)} — shown worn on the reference "
                    f"figure's {SLOT_LABEL[slot]} area, shaped by the body underneath it. Only "
                    f"the equipment's own pixels survive; the body is erased to transparency.\n"
                    f"VIEW: {gear_view_desc}, matching the reference figure's own view.\n"
                    f"CONTEXT: the item is worn by the figure in the reference image. Copy that "
                    f"figure's view, pose, scale and body placement, then output the equipment "
                    f"alone on transparency.\n"
                    f"{GEAR_STYLE_BLOCK}\n"
                    f"{colour_block(slot, eid)}\n"
                    f"{GEAR_SIZE_ANCHOR[slot]}\n"
                    f"GAME-SCALE READ: the {cname} must be identifiable by silhouette alone at "
                    f"96x144 px, and its {slot} placement must be obvious.\n"
                    f"{GEAR_TECH_BLOCK}\n{GEAR_LOCKS_BLOCK}\n{EXCLUDE_BLOCK}"
                ),
            })

    return out


def load_config_equipment_ids():
    """
    从 game/config.js 读出全部装备 id（基础 + 特效）。

    config.js 是 CommonJS（`module.exports`），所以直接让 node require 它，
    拿到的就是**运行时真正在用的那张表**——而不是从注释里抄来的数字。
    本脚本本身不跑 node，这里用 subprocess 借一次。

    node 不存在或 require 失败时返回 None：自检降级为"不跨文件核对"，
    但前面的结构自检（每件 4 视图、id 格式）仍然执行，不静默放过。
    """
    import subprocess

    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
    cfg = os.path.join(repo_root, "game", "config.js")
    if not os.path.exists(cfg):
        return None

    js = (
        "const C=require(process.argv[1]);"
        "const ALL=Object.assign({},C.EQUIPMENT,C.EQUIP_FX);"
        "process.stdout.write(JSON.stringify(Object.keys(ALL)));"
    )
    try:
        r = subprocess.run(
            ["node", "-e", js, cfg],
            capture_output=True, text=True, timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    try:
        return set(json.loads(r.stdout))
    except (ValueError, TypeError):
        return None


def main():
    items = build()

    # ---- 配置自检：装备必须与 game/config.js 的真实表格逐件对齐 ----
    #
    # 为什么不写死数字：config.js 的注释写「基础装备 16 件」「特效装备 12 件」，
    # 但两张表实际各有 21 和 14 项（共 35）—— 注释在后续扩表时没同步，已经过时。
    # 若这里照抄注释（28），就会漏掉 7 件装备。
    # 所以去 config.js 现数，注释与表格再漂移也能立刻发现。
    eq = [i for i in items if i["category"] == "equipment"]

    def prompt_ids(rows):
        """从 id 形如 eq-<slot>-<equipId>-<view> 反解出 equipId 集合。"""
        got = set()
        for r in rows:
            body = r["id"][len("eq-"):]          # <slot>-<equipId>-<view>
            slot = r["slot"]
            assert body.startswith(slot + "-"), f"id 与 slot 不一致：{r['id']}"
            rest = body[len(slot) + 1:]
            equip_id = rest.rsplit("-", 1)[0]    # 去掉末尾的 view
            got.add(equip_id)
        return got

    have = prompt_ids(eq)
    want = load_config_equipment_ids()

    if want is not None:
        assert have == want, (
            "装备清单与 game/config.js 不一致：\n"
            f"  config 有而提示词缺（{len(want - have)}件）：{sorted(want - have)}\n"
            f"  提示词有而 config 没有（{len(have - want)}件）：{sorted(have - want)}"
        )
        print(f"  cross-check: {len(want)} 件装备与 game/config.js 逐件对齐")

    assert len(eq) == len(have) * len(VIEWS), (
        f"每件装备应有 {len(VIEWS)} 视图，实得 {len(eq)} 张 / {len(have)} 件"
    )

    doc = {
        "generated_by": "docs/art/prompts/build_hero_prompts.py",
        "style_source": "game/assets/boss_*.png (palette extracted programmatically)",
        "native_size": BASE_SIZE,
        "total": len(items),
        "counts": {
            "hero_base": len([i for i in items if i["category"] == "hero_base"]),
            "hero_action": len([i for i in items if i["category"] == "hero_action"]),
            "equipment": len(eq),
        },
        "items": items,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)

    print(f"wrote {OUT}")
    print(f"  total   : {doc['total']}")
    for k, v in doc["counts"].items():
        print(f"  {k:12s}: {v}")


if __name__ == "__main__":
    main()
