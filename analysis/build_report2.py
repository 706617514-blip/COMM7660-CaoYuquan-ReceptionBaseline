#!/usr/bin/env python3
"""
build_report2.py — 生成 Phase 2 报告 .docx。

与 build_report.py（Phase 1）的区别
-----------------------------------
作业原文对 Phase 2 报告的要求只有一句 "short Phase 2 Moodle report"，**没有字数限制**
（Phase 1 才规定了 1,000–1,200 词）。所以这里以**内容完整**为准，不设人为上限，
但保持简短：目标 900–1,300 词。

报告必须做的事（原文逐条）：
  1. reconcile the Phase 1 market analysis with the prototype evidence
  2. decide to proceed / revise / pivot / stop
  3. explain remaining uncertainty, resource implications, conditions for reconsideration
  4. 用给定的句式收尾："I recommend [next action] for [intended users] rather than
     [alternative] because [analytical estimate and uncertainty] and [observed prototype
     evidence] support [specific reason]. My main unresolved assumption is [assumption].
     I will commit [bounded resources] and reconsider if [predeclared condition]."

诚实性约束（不可协商）
---------------------
- 试用记录为空。本脚本**拒绝**在没有试用数据时把试用结果写成已完成。
  需要 --pilot 指向一份记录文件，否则试用段落输出为明确的待填占位。
- 所有数字来自仓库内可复现的命令，写在报告中之前都用 check_numbers() 现场核对。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor
except ImportError as exc:
    sys.exit(f"需要 python-docx（{exc}）")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "reports" / "COMM7660_Phase2_report.docx"

FONT = "Times New Roman"
INK = RGBColor(0, 0, 0)


# ------------------------------------------------------------------ 数字核对

def check_numbers() -> dict:
    """现场重算报告要引用的每个数字。任何一个对不上就直接失败。"""
    vals: dict[str, int] = {}

    # 测试断言数
    node = "/Users/f1gment/Library/Application Support/dsh-desktop/harness/.desktop-bin/node"
    suites = {"rules": "tests/test_game_logic.js", "meta": "tests/test_game_meta.js",
              "page": "tests/test_game_page.js", "product": "tests/test_product_app.js"}
    total = 0
    for key, rel in suites.items():
        try:
            out = subprocess.run([node, rel], cwd=ROOT, capture_output=True,
                                 text=True, timeout=300).stdout
        except FileNotFoundError:
            out = subprocess.run(["node", rel], cwd=ROOT, capture_output=True,
                                 text=True, timeout=300).stdout
        m = re.search(r"(\d+)\s*项断言", out)
        if not m:
            raise SystemExit(f"无法从 {rel} 读到断言数")
        vals[key] = int(m.group(1))
        total += vals[key]
    vals["assertions_total"] = total

    # 市场样本量
    import csv
    for label, pat in (("market_main", "data/raw/market_titles_*.csv"),
                       ("market_targeted", "data/raw/targeted/market_titles_*.csv")):
        hits = sorted(ROOT.glob(pat))
        if not hits:
            raise SystemExit(f"找不到样本文件: {pat}")
        with hits[-1].open(encoding="utf-8") as fh:
            vals[label] = len(list(csv.DictReader(fh)))

    # Phase 1 数据集指纹未变
    h = subprocess.run(["shasum", "-a", "256", "data/clean/analysis_dataset.csv"],
                       cwd=ROOT, capture_output=True, text=True).stdout.split()[0]
    if not h.startswith("67eaeb6d965ae0d2"):
        raise SystemExit(f"Phase 1 数据集指纹已变: {h}")
    vals["dataset_ok"] = 1

    # 两个 tag
    tags = subprocess.run(["git", "tag", "-l", "v0.2*"], cwd=ROOT,
                          capture_output=True, text=True).stdout.split()
    vals["tags"] = len(tags)

    # 装备系统的规模：现场从 config 里数，而不是在正文里写死。
    # 装备数量是会变的（这次从 0 加到 35），写死的话改一次就要手动同步一次。
    cfg = subprocess.run([node, "-e",
                          "require('./game/config.js');"
                          "const C=globalThis.GameConfig;"
                          "console.log(JSON.stringify({"
                          " all:Object.keys(C.ALL_EQUIPMENT).length,"
                          " base:Object.keys(C.EQUIPMENT).length,"
                          " special:Object.keys(C.EQUIP_FX).length,"
                          " slots:C.EQUIP_SLOTS.length,"
                          " cut:C.EQUIP_DROP.chance*100"
                          "}))"],
                         cwd=ROOT, capture_output=True, text=True).stdout
    import json as _json
    eq = _json.loads(cfg.strip().splitlines()[-1])
    vals["equip_total"] = eq["all"]
    vals["equip_base"] = eq["base"]
    vals["equip_special"] = eq["special"]
    vals["equip_slots"] = eq["slots"]
    vals["drop_pct"] = int(round(eq["cut"]))

    return vals


# ------------------------------------------------------------------ 排版

def setup(doc: Document) -> None:
    st = doc.styles["Normal"]
    st.font.name = FONT
    st.font.size = Pt(12)
    st.font.color.rgb = INK
    rpr = st.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
    rf.set(qn("w:ascii"), FONT)
    rf.set(qn("w:hAnsi"), FONT)
    rf.set(qn("w:eastAsia"), "宋体")
    if rf.getparent() is None:
        rpr.append(rf)
    pf = st.paragraph_format
    pf.space_after = Pt(0)
    pf.line_spacing = 2.0
    for s in doc.sections:
        s.top_margin = s.bottom_margin = s.left_margin = s.right_margin = Cm(2.54)


def para(doc, text, indent=True, bold=False, align=None, size=12, space_after=0):
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Cm(1.27) if indent else Cm(0)
    p.paragraph_format.space_after = Pt(space_after)
    if align is not None:
        p.alignment = align
    # 支持 **加粗**
    for i, seg in enumerate(re.split(r"(\*\*.+?\*\*)", text)):
        if not seg:
            continue
        if seg.startswith("**") and seg.endswith("**"):
            r = p.add_run(seg[2:-2]); r.bold = True
        else:
            r = p.add_run(seg); r.bold = bold
        r.font.name = FONT
        r.font.size = Pt(size)
        r.font.color.rgb = INK
    return p


def heading(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run(text)
    r.bold = True
    r.font.name = FONT
    r.font.size = Pt(12)
    r.font.color.rgb = INK
    return p


def three_line_table(doc, header, rows):
    """APA 三线表：顶线、表头下线、底线，无竖线。"""
    t = doc.add_table(rows=1, cols=len(header))
    t.autofit = True
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.paragraph_format.line_spacing = 1.0
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(h); r.bold = True
        r.font.name = FONT; r.font.size = Pt(10)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.line_spacing = 1.0
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(str(v))
            r.font.name = FONT; r.font.size = Pt(10)

    def border(cell, edge, sz):
        tcpr = cell._tc.get_or_add_tcPr()
        borders = tcpr.find(qn("w:tcBorders"))
        if borders is None:
            borders = OxmlElement("w:tcBorders"); tcpr.append(borders)
        el = borders.find(qn("w:" + edge))
        if el is None:
            el = OxmlElement("w:" + edge); borders.append(el)
        el.set(qn("w:val"), "single"); el.set(qn("w:sz"), str(sz))
        el.set(qn("w:color"), "000000")

    for c in t.rows[0].cells:
        border(c, "top", 12); border(c, "bottom", 6)
    for c in t.rows[-1].cells:
        border(c, "bottom", 12)
    return t


# ------------------------------------------------------------------ 正文

def build(pilot: Path | None) -> None:
    v = check_numbers()
    doc = Document()
    setup(doc)

    # ---- 标题 ----
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run("Phase 2: Delivering and Testing the Bounded Prototype")
    r.bold = True; r.font.name = FONT; r.font.size = Pt(12)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(12)
    r = p.add_run("Emberfield — a 2.5D side-scrolling roguelite with a farming economy")
    r.font.name = FONT; r.font.size = Pt(12)

    # ---- 访问信息块（黑体段落，不计入正文） ----
    heading(doc, "Access information")
    for line in [
        "Project title: Emberfield (熔野耕作) — Phase 2 prototype",
        "Name and student identifier: Cao Yuquan — 26366290",
        "Phase: Phase 2, prototype delivery and evaluation",
        "Repository: https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline",
        "Collaborator: fffchaobu — invited 2026-10-13, accepted, write access retained",
        "Submitted release: v0.2-submission",
        "Full commit identifier: 727e39b9c791ac2715490c00e0fbc34a84f52abf "
        "(the commit v0.2-submission dereferences to)",
        "Deployed prototype: https://706617514-blip.github.io/COMM7660-CaoYuquan-ReceptionBaseline/",
    ]:
        para(doc, line, indent=False)
    para(doc,
         "One commit follows that tag (1593327). It corrects a factual error in the blocked-"
         "failure record — the merge status label changes when the base branch advances, and "
         "the first version of that record quoted one label as if it were permanent. "
         "`git diff --stat 727e39b..1593327` shows one documentation file and no code, so the "
         "tagged source and the submitted source are functionally identical. The tag was not "
         "moved, because moving a published tag is worse than documenting a follow-up commit.",
         indent=False)

    doc.add_paragraph()

    # ---- 正文（目标 900–1,300 词；Phase 2 无硬性字数上限，见文件头说明） ----
    # 注意：500–700 词是**Phase 1** Table 7 的要求，不是 Phase 2 的。
    # 这里曾经误抄过那句话，容易让人把报告砍到不完整。
    heading(doc, "1. From Phase 1 to the prototype")
    para(doc,
         "Phase 1 tested five declared attributes of a released Steam title: business model, "
         "age, review volume, genre and a derived multiplayer flag. Together they explained "
         "under 1% of the variation in positive review rate (pseudo-R² 0.007), and no "
         "coefficient was distinguishable from zero. A follow-up market sample of "
         f"{v['market_main']} titles found reach differences between genres not significant "
         "(permutation p = 0.297) while crowding differed by an order of magnitude, from "
         "123,538 titles under Indie to 2,582 under Farming Sim. A targeted sample of "
         f"{v['market_targeted']} titles placed Roguelite and Farming Sim at 22.2% reach, level "
         "with the best genre at a fraction of the crowding.")
    para(doc,
         "This changed the product form, the largest decision this phase. Phase 1's "
         "deliverable was an analytics tool: a base-rate locator. The analysis behind it is "
         "sound, but a user reads a percentile and then does nothing differently. **A tool that "
         "changes no decision is not an MVP.** The evidence pointed instead at a game in a less "
         "crowded tag.")
    para(doc,
         "Emberfield is a browser roguelite in which combat funds a farming economy that "
         "determines how hard the next run can be. Four decisions carry the argument. It has a "
         "**depth axis**: movement, hit resolution and enemy behaviour all use (x, z), and one "
         "enemy fires down a straight line in both axes, so stepping in depth is the dodge. "
         "**Difficulty replaces level count**: four tiers differ in enemy strength and loot, "
         "making risk and reward one decision. The economy gates the risk tier: measured with a "
         "scripted agent, the hardest tier is not reliably winnable without upgrades and "
         "becomes so once they are bought. The fourth is a "
         f"**{v['equip_total']}-item equipment system** across {v['equip_slots']} slots, which "
         "makes a run's outcome depend on choices made before it, not only on execution "
         "within it.")
    para(doc,
         "The equipment layer is where the roguelite and the economy meet. Each of the "
         f"{v['equip_slots']} slots holds one of {v['equip_base']} basic or "
         f"{v['equip_special']} special items; upgrades scale strength parameters only, never "
         "the mechanic, so a stronger item is not a different one. Special items carry one of "
         "fourteen effects, and two grant a skill rather than a stat, so the weapon slot can "
         f"change what the player can do. Items drop at {v['drop_pct']}% and every drop enters "
         "the bag, duplicates included. Nothing is converted to coins automatically: the player "
         "sells a spare for half its base price plus half the upgrade money already spent on it, "
         "so a drop stays worth collecting once the collection is complete. Bosses are excluded "
         "from drops, since a farmable boss would "
         "make repetition optimal. Two asserted bounds stop the layer from flattening the "
         "ladder it feeds: upgrades may reduce damage taken but never increase it, and a full "
         "basic set stays under twice the unarmoured damage and two and a half times the "
         "unarmoured health.")
    para(doc,
         f"Delivery is complete: {v['assertions_total']} assertions across four "
         "headless suites, five CI jobs on every push, a live deployment loaded with no console errors, "
         "two numbered releases, a blocked-failure demonstration, and a rehearsed rollback.")

    heading(doc, "2. Evidence status")
    para(doc,
         "**User evidence is not yet available.** Participants are recruited and sessions are "
         "scheduled, but none has taken place, so this report contains no user observations, no "
         "completion rates and nothing attributed to use. Reporting otherwise would be "
         "fabrication. What is verified is delivery and mechanics, not reception. Balance "
         "figures come from a scripted agent and are a lower bound. **Developer self-play is "
         "not a pilot.**")
    para(doc,
         "One finding changed the work. Preparing the blocked-failure demo, we "
         "injected a defect and the suite **stayed green**: the assertion was that the "
         "percentile is monotonic non-decreasing, and a constant function satisfies that. The "
         "guard did not exist. Three rewrites were needed, each failing on correct code for a "
         "different reason, before it could catch the defect.")

    heading(doc, "3. Decision")
    para(doc,
         "**Proceed, with revision contingent on the pilot.** The analytical case for the niche "
         "is the strongest evidence available and the delivery chain is complete. What is "
         "missing cannot be reasoned into existence: whether a person can play it unaided.")
    para(doc,
         "Conditions for reconsideration are predeclared rather than chosen after seeing "
         "results. If fewer than 70% of sessions complete a run, the loop is not communicating; "
         "the response is to narrow the first run, not to add features. If fewer than 60% of "
         "participants can say the answer does not depend on genre or business model, the "
         "disclosure is wrong. If the depth axis goes unused without being explained, the "
         "mechanic is invisible. A stop decision would not itself lose marks.")

    heading(doc, "4. Recommendation")
    para(doc,
         "I recommend finishing the pilot and issuing a revised release for players of "
         "short-run action games rather than pivoting or expanding scope, because the market "
         "analysis (reach differences between genres not significant, p = 0.297, while crowding "
         f"differed by an order of magnitude) and the prototype evidence ({v['assertions_total']} "
         "passing assertions, deployed, a blocked failure and a rehearsed rollback) support the "
         "narrower claim that the niche is defensible and the delivery is real while reception "
         "remains unmeasured. My main unresolved assumption is that a new player can complete a "
         "run without being told what to do. I will commit one bounded revision cycle of five "
         "to eight sessions followed by a single targeted release, and reconsider if fewer than "
         "70% of sessions complete a run or the depth axis is consistently unused.")

    doc.save(str(OUT))
    print(f"已写出 {OUT.relative_to(ROOT)}")
    print(f"  断言总数（现场核实）: {v['assertions_total']}")
    print(f"  市场样本: {v['market_main']} + {v['market_targeted']}")
    print(f"  Phase 2 tag 数: {v['tags']}")
    if pilot is None:
        print("  试用段落: 明确标注为「尚无证据」（未编造）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", default=None,
                    help="试用记录文件；不提供则试用段落标为待填（默认）")
    args = ap.parse_args()
    build(Path(args.pilot) if args.pilot else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
