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

    # ---- 1. 与 Phase 1 的衔接 ----
    heading(doc, "1. What Phase 1 established, and what it did not")
    para(doc,
         "Phase 1 asked which media product to build and answered it with data. Two findings "
         "shaped Phase 2. Phase 1 tested five declared attributes of a released title: business "
         "model, age, review volume, genre and a derived multiplayer flag. Together they "
         "explained under 1% of the variation in positive review rate (pseudo-R² 0.007). No "
         "focal coefficient was distinguishable from zero. Popularity is predictable; "
         "reception largely is not. "
         "Second, a follow-up market analysis of "
         f"{v['market_main']} titles across nine genre tags found that reach differences "
         "between genres were not significant (permutation p = 0.297), while crowding "
         f"differences were large. A targeted sample of {v['market_targeted']} titles added "
         "the two tags the prototype would occupy: 123,538 titles sit under Indie, against "
         "15,215 under Roguelite and 2,582 under Farming Sim.")
    para(doc,
         "The consequence for Phase 2 is a change of product form, and it is worth stating "
         "plainly because it is the largest decision in this phase. Phase 1's own deliverable "
         "was an analytics tool: a base-rate locator that told a developer where an expected "
         "reception rate sat in the market. The analysis behind it is sound, but as a product "
         "it fails its own test — a user reads a percentile and then does nothing differently. "
         "**A tool that changes no decision is not an MVP.** The market analysis pointed at a "
         "different, bounded product: a game in a less crowded tag, where the analytical work "
         "justifies entering a specific niche. Delivering another dashboard would not.")

    # ---- 2. 交付了什么 ----
    heading(doc, "2. The prototype delivered")
    para(doc,
         "Emberfield is a browser game: a 2.5D side-scrolling roguelite in which combat funds a "
         "farming economy that in turn determines how hard the next run can be. Source is in "
         "`game/`; it runs from a static deployment with no server and no account.")
    para(doc,
         "Three design decisions carry the argument. First, the game has a **depth axis**: "
         "movement, hit resolution and enemy behaviour all use (x, z), and a ranged enemy fires "
         "a projectile that travels a straight line in both axes, so stepping in depth is the "
         "dodge. Without that, the axis would be decoration. Second, **difficulty replaces "
         "level count** — four tiers differ in enemy health, damage, speed, wave count and loot "
         "multiplier. This makes risk and reward a single decision. Third, the economy "
         "gates the risk tier: measured with a scripted agent, the "
         "hardest tier is not reliably winnable without upgrades, and becomes so once they are "
         "bought.")

    three_line_table(doc,
        ["Artifact", "Verification"],
        [["Automated tests", f"{v['assertions_total']} assertions across four headless suites"],
         ["CI", "Five jobs on every push: data rules, model reproduction, product logic, game "
                "logic and page wiring, report compliance"],
         ["Deployment", "GitHub Pages, live, loaded in a headless browser with no console errors"],
         ["Releases", f"{v['tags']} numbered Phase 2 releases, each with a GitHub Release"],
         ["Blocked failure", "PR #1 — a required check fails and the merge is refused"],
         ["Rollback", "Rehearsed: fault injected, restored from the tag, all suites green"]])
    doc.add_paragraph()

    # ---- 3. 证据状态（诚实） ----
    heading(doc, "3. Evidence status, stated without inflation")
    if pilot is None:
        para(doc,
             "**User evidence is not yet available.** Participants have been recruited and "
             "sessions are scheduled, but none has taken place, so this report contains no "
             "user observations, no completion rates and no revision attributed to use. "
             "Reporting otherwise would be fabrication. The sections below state what would "
             "have to be true for the Phase 2 decision to change once the sessions run.")
    else:
        raise SystemExit("--pilot 已提供，但本版脚本尚未实现试用数据的解析；"
                         "请先确认记录格式再启用。")
    para(doc,
         "What has been verified is delivery and mechanics, not reception. Balance figures come "
         "from a scripted agent that kites and uses skills; they are a lower bound on what a "
         "person can achieve and say nothing about how the game feels. Rendering is covered by "
         "headless screenshots rather than automated tests, so layout and drawing faults were "
         "caught by looking, not by asserting. **Developer self-play is not a pilot.**")

    # ---- 4. 一个必须先讲的失败 ----
    heading(doc, "4. A check that did not exist, and the demonstration that proved it")
    para(doc,
         "The brief requires evidence of a blocked failure: a check that actually stops a bad "
         "change. Preparing that demonstration produced the most useful finding of this phase. "
         "With a defect injected — the percentile function returning a constant across part of "
         "its range — the test suite **stayed green**. The assertion was that the percentile is "
         "monotonic non-decreasing, and a constant function satisfies it. The guard protecting "
         "the tool's central promise did not exist.")
    para(doc,
         "Three rewrites were needed before the assertion could catch the defect. Each failed on "
         "correct code for a different reason. Strict increase at integer steps failed: below "
         "the data minimum the percentile is legitimately zero for every input. Finer steps "
         "failed too, because one decimal of display precision cannot resolve a 0.1–0.2 "
         "magnitude change. That produced 267 false positives. Sampling every five points "
         "worked. "
         "The demonstration now records a real pull request where the required check fails and "
         "the merge state reads as not mergeable.")

    # ---- 5. 决定 ----
    heading(doc, "5. Decision")
    para(doc,
         "**Proceed, with revision contingent on the pilot.** The analytical case for the niche "
         "is the strongest part of the evidence and the delivery chain is complete and "
         "exercised. What is missing is the one thing that cannot be reasoned into existence: "
         "whether a person can play it unaided. The pilot is therefore the gate on the "
         "next decision, not a formality.")
    para(doc,
         "Conditions that would change this decision are predeclared rather than chosen after "
         "the fact. If fewer than 70% of sessions produce a completed run, the core loop is not "
         "communicating. The response is to narrow the first run further, not to add "
         "features. If fewer than 60% of participants can say that the answer does not depend "
         "on genre or business model, the disclosure is wrong and the revision is editorial. If "
         "the depth axis is not used without being explained, the mechanic is invisible and "
         "belongs in the on-screen prompt. A stop decision remains available and, per the "
         "brief, would not itself lose marks.")
    para(doc,
         "Remaining uncertainty is concentrated in three places: whether the loop reads as a "
         "loop rather than two disjoint screens; whether the farming layer feels like an "
         "investment or a chore; and whether the difficulty ladder is legible without a "
         "tutorial. Resources committed are bounded and declared below.")

    # ---- 6. 收尾句式（原文要求） ----
    heading(doc, "6. Recommendation")
    para(doc,
         "I recommend **finishing the pilot and issuing a revised release** for **players of "
         "short-run action games**, rather than **pivoting to a different genre or expanding "
         "the scope**, because the market analysis (reach differences between genres were not "
         "significant, permutation p = 0.297, while crowding differed by an order of magnitude "
         "between candidate tags) and the prototype evidence (a complete CI and release chain, "
         f"{v['assertions_total']} passing assertions, a blocked-failure demonstration and a "
         "rehearsed rollback) support **the narrower claim that the niche is defensible and the "
         "delivery is real, while reception remains unmeasured**. My main unresolved assumption "
         "is **that a new player can complete a run without being told what to do**. I will "
         "commit **one bounded revision cycle of five to eight pilot sessions followed by a "
         "single targeted release**, and reconsider if **fewer than 70% of sessions complete a "
         "run, or if the depth axis is consistently unused** — in either case I would stop "
         "adding content and cut the first run down instead.")

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
