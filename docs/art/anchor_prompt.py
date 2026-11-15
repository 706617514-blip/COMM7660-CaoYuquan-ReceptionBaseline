#!/usr/bin/env python3
"""
Build the single identity-anchor prompt for the protagonist.

Why this exists: the 172-view batch is generated image-to-image against one
reference. That reference must itself be correct before the batch starts,
because any hair or face defect in it is copied into every downstream view.

The previous candidate `hero_base_34.jpg` was rejected by the user for its
hair: it reads as a short mohawk / spiked crest. The user chose a very short
buzz cut with stubble instead. This script takes that image as a shape
reference for build, gear and clothing, and rewrites only the head.

Prints the prompt to stdout so gen_direct.py's caller can pipe it; no network,
no writes.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROMPTS = os.path.join(HERE, "prompts", "protagonist-prompts.json")

# Reused verbatim from the frozen art brief so the anchor matches the batch's
# rendering language instead of introducing a second style.
STYLE = (
    "ART DIRECTION: Dark-fantasy woodcut / late-medieval engraving. Every form "
    "is built as carved layered facets with hard chiselled edges and dense fine "
    "hatching strokes for shading. Absolutely NO soft gradients, NO smooth "
    "airbrushing, NO glossy anime rendering. Muted desaturated earth palette "
    "ONLY: ink outline #1a1611, shadow #251f18, body #393126, lit plane #655a49, "
    "top highlight #8a7d68. Skin #6b5a48. The single warm accent permitted in "
    "the whole image is a faint ember-orange #ff7a3c glint in the eyes. Light "
    "source is fixed at upper-left on every asset. Four-layer shading convention "
    "throughout: dark outline, body mass, lit face, small highlight."
)

TECHNICAL = (
    "TECHNICAL OUTPUT: single isolated character, native size 96x144 px, fully "
    "transparent background (real alpha channel, no checkerboard, no white or "
    "coloured matte), character standing on the bottom edge with feet at the "
    "very bottom, centred horizontally, no perspective distortion."
)

EXCLUDE = (
    "EXCLUDE: text, labels, watermarks, mockup frames, borders, background "
    "scenery, ground, floor shadow, duplicate characters, cropped edges, "
    "signature, UI chrome, colour swatches."
)

HEAD_FIX = (
    "HEAD — CORRECTION, THIS OVERRIDES THE REFERENCE: the reference image's "
    "hair is WRONG and must not be copied. Remove the raised spiked crest "
    "entirely. Give the character a VERY SHORT BUZZ CUT: dense uniform stubble "
    "shaved down to the scalp, roughly 2-3 mm, following the natural rounded "
    "curve of the skull with no parting, no spikes, no volume and no visible "
    "individual hair strands. The scalp silhouette must be the bare head shape, "
    "smooth and close to the bone. Add short coarse dark STUBBLE on the jaw, "
    "chin and upper lip, patchy and uneven, never a styled beard or a moustache "
    "shape. Keep the same face, same brow, same nose, same eye colour as the "
    "reference."
)

GEAR_LOCK = (
    "EVERYTHING ELSE — COPY FROM THE REFERENCE EXACTLY: the same stocky compact "
    "build, same shoulder width, same limb length, same head-to-body ratio, same "
    "plain rough cloth tunic and trousers, same worn leather belt, same shoulder "
    "strap, same forearm wraps, same shin wraps, same round wooden shield, same "
    "short straight sword. Do not restyle, slim, lengthen, age or beautify the "
    "body or the gear."
)


def build(category="hero_base", view="34"):
    items = json.load(open(PROMPTS, encoding="utf-8"))["items"]
    pid = "%s_%s" % (category, view)
    src = next((i for i in items if i.get("id") == pid), None)
    if src is None:
        sys.exit("no prompt %s in %s" % (pid, PROMPTS))

    # Take the frozen prompt and splice the head correction in ahead of the
    # art direction, so the batch prompt's body/gear wording is preserved
    # exactly rather than paraphrased here.
    text = src["prompt"]
    marker = "ART DIRECTION:"
    head, sep, tail = text.partition(marker)
    if not sep:
        sys.exit("prompt %s has no ART DIRECTION marker" % pid)

    return "\n".join(
        [
            "IDENTITY ANCHOR: this image will be used as the single reference "
            "for every other asset of this character, so it must be correct and "
            "fully self-consistent.",
            head.strip(),
            HEAD_FIX,
            GEAR_LOCK,
            marker + tail.strip(),
        ]
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="hero_base")
    ap.add_argument("--view", default="34", choices=["left", "right", "back", "34"])
    ap.add_argument("--out", help="write prompt to this file instead of stdout")
    args = ap.parse_args()

    text = build(args.category, args.view)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote %s (%d chars)" % (args.out, len(text)))
    else:
        print(text)


if __name__ == "__main__":
    main()
