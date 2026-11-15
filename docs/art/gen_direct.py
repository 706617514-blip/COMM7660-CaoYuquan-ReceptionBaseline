#!/usr/bin/env python3
"""
Direct Seedream (火山方舟) generation, bypassing the dsh-image-gen plugin.

Why this exists: the plugin fails to load because '@deepseek-ai/cordis' and
'react' are not injected into the plugin profile, so the generate_image tool
falls back to a built-in handler that demands a Gemini key. Confirmed by
preflight state: dsh-image-gen -> unresolved, recorded 2026-11-13T16:37Z,
which predates the Seedream credential save at 2026-11-14T01:00 +08:00.

Contract: read prompts from protagonist-prompts.json, POST each to
/api/v3/images/generations, save the returned bytes next to the prompt's
declared filename. Never invents prompts; never overwrites without --force.
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
MODEL = "doubao-seedream-5-0-pro-260628"
CRED = os.path.expanduser(
    "~/Library/Application Support/dsh-desktop/harness/.credentials.yaml"
)


def load_key():
    """Read the Seedream key from the DSH credential store."""
    if not os.path.exists(CRED):
        sys.exit(f"credential store not found: {CRED}")
    text = open(CRED, encoding="utf-8", errors="replace").read()
    m = re.search(
        r"dsh-image-generation/configuration:.*?key:\s*(\S+)", text, re.S
    )
    if not m:
        sys.exit("no image-generation key in credential store")
    return m.group(1)


def load_prompts(path):
    data = json.load(open(path, encoding="utf-8"))
    items = (
        data
        if isinstance(data, list)
        else data.get("items") or data.get("prompts") or []
    )
    if not items:
        sys.exit(f"no prompts found in {path}")
    return items


def reference_uri(path):
    """Encode a reference image as a data URI.

    The endpoint rejects a bare base64 string outright ("invalid url specified")
    and only accepts a ``data:image/...;base64,`` URI, so the prefix is not
    optional. Confirmed by probing both forms against the live API.
    """
    with open(path, "rb") as f:
        blob = f.read()
    ext = os.path.splitext(path)[1].lower().lstrip(".") or "jpeg"
    if ext == "jpg":
        ext = "jpeg"
    return "data:image/%s;base64,%s" % (ext, base64.b64encode(blob).decode())


def generate(key, prompt, size="1024x1024", timeout=240, image=None):
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "size": size,
        "response_format": "url",
        "watermark": False,
    }
    if image:
        # Image-to-image: the reference pins the character's identity so the
        # 172 independently generated views all depict the same person. Without
        # it the model invents a new face per prompt.
        payload["image"] = image
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        ARK_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def sniff_ext(blob):
    """Seedream serves JPEG bytes even when the prompt asks for PNG alpha.

    Storing JPEG bytes under a .png name makes strict readers reject the file,
    so pick the extension from the magic number. Normalisation to real PNG
    happens later in the pipeline.
    """
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if blob[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return ".webp"
    return None


def download(url, dest, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-art/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        blob = r.read()
    ext = sniff_ext(blob)
    if ext and not dest.lower().endswith(ext):
        dest = os.path.splitext(dest)[0] + ext
    with open(dest, "wb") as f:
        f.write(blob)
    return dest, len(blob)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompts", default="docs/art/prompts/protagonist-prompts.json")
    ap.add_argument("--outdir", default="docs/art/generated")
    ap.add_argument("--category", help="only this category, e.g. hero_base")
    ap.add_argument("--ids", help="comma-separated prompt ids")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument(
        "--ref",
        help="reference image that pins the character's identity; every prompt "
             "is generated image-to-image against it",
    )
    ap.add_argument(
        "--prompt-file",
        help="generate one image from this prompt file instead of the prompt "
             "set; the file's stem becomes the output id",
    )
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.prompt_file:
        # Single-shot mode, used for the identity anchor and for one-off
        # corrections that have no entry in the frozen prompt set.
        text = open(args.prompt_file, encoding="utf-8").read().strip()
        if not text:
            sys.exit(f"empty prompt file: {args.prompt_file}")
        pid = os.path.splitext(os.path.basename(args.prompt_file))[0]
        items = [{"id": pid, "category": "adhoc", "file": pid + ".png",
                  "prompt": text}]
    else:
        items = load_prompts(args.prompts)
    if args.category:
        items = [i for i in items if i.get("category") == args.category]
    if args.ids:
        want = {s.strip() for s in args.ids.split(",") if s.strip()}
        items = [i for i in items if i.get("id") in want]
    if args.limit:
        items = items[: args.limit]

    os.makedirs(args.outdir, exist_ok=True)
    print(f"selected {len(items)} prompt(s) -> {args.outdir}")

    if args.dry_run:
        for i in items:
            dest = os.path.join(args.outdir, i.get("file") or f"{i['id']}.png")
            print(f"  [dry] {i['id']:<24} -> {dest}")
        return

    key = load_key()
    ref = None
    ref_dir = None
    if args.ref:
        if not os.path.exists(args.ref):
            sys.exit(f"reference image not found: {args.ref}")
        # --ref may be a single file OR a directory of per-view references.
        # Equipment must be drawn against the reference of ITS OWN view: a
        # left-facing gear layer generated from a right-facing reference comes
        # back facing the wrong way and cannot be composited. A directory is
        # expected to hold hero_base_<view>.jpg / .png.
        if os.path.isdir(args.ref):
            ref_dir = args.ref
            print(f"reference dir: {ref_dir} (per-view)")
        else:
            ref = reference_uri(args.ref)
            print(f"reference: {args.ref} ({len(ref) / 1024:.0f} KB encoded)")

    def ref_for(item):
        """Pick the reference image matching this item's view."""
        if ref_dir is None:
            return ref
        view = item.get("view")
        if not view:
            return ref
        for ext in (".jpg", ".jpeg", ".png"):
            cand = os.path.join(ref_dir, f"hero_base_{view}{ext}")
            if os.path.exists(cand):
                return reference_uri(cand)
        return ref
    ok = fail = 0
    for n, item in enumerate(items, 1):
        pid = item.get("id", f"item{n}")
        fname = item.get("file") or f"{pid}.png"
        dest = os.path.join(args.outdir, fname)
        if os.path.exists(dest) and not args.force:
            print(f"[{n}/{len(items)}] skip {pid} (exists; use --force)")
            continue
        prompt = item.get("prompt", "").strip()
        if not prompt:
            print(f"[{n}/{len(items)}] FAIL {pid}: empty prompt")
            fail += 1
            continue
        t0 = time.time()
        try:
            resp = generate(key, prompt, args.size, image=ref_for(item))
            data = resp.get("data") or []
            if not data:
                raise RuntimeError(f"no data in response: {str(resp)[:200]}")
            url = data[0].get("url")
            if not url:
                raise RuntimeError(f"no url in response: {str(data[0])[:200]}")
            dest, size_bytes = download(url, dest)
            print(
                f"[{n}/{len(items)}] OK   {pid} -> {os.path.basename(dest)} "
                f"({size_bytes/1024:.0f} KB, {time.time()-t0:.1f}s)"
            )
            ok += 1
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            print(f"[{n}/{len(items)}] FAIL {pid}: HTTP {e.code} {detail}")
            fail += 1
        except Exception as e:
            print(f"[{n}/{len(items)}] FAIL {pid}: {type(e).__name__}: {e}")
            fail += 1

    print(f"\ndone: {ok} ok, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
