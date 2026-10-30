#!/usr/bin/env python3
"""
export_docs_to_docx.py — 把仓库里的工作文档（.md）转成排版好的 .docx。

为什么自己写而不用 pandoc
--------------------------
这台机器没有 pandoc，也没有 python-markdown。这几个文档只用到 Markdown 的一个小子集
（标题、段落、加粗、行内代码、无序/有序列表、复选框、表格、引用块、围栏代码块、分隔线），
所以写一个针对该子集的转换器比引入依赖更可控，也顺手能处理中英混排字体。

覆盖的语法（超出部分会原样作为段落输出，不会丢内容）：
    # / ## / ###      标题
    **加粗**          行内加粗
    `代码`            行内等宽
    - 项目           无序列表
    - [ ] / - [x]    复选框（渲染成 ☐ / ☑，打印可见）
    1. 项目          有序列表（保留编号）
    > 引用           缩进引用块
    | a | b |        表格（需带分隔行）
    ```...```        代码块
    ---              分隔线

用法：
  python3 analysis/export_docs_to_docx.py                     # 转默认清单
  python3 analysis/export_docs_to_docx.py docs/release-notes.md # 转指定文件
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor
except ImportError as exc:                                    # noqa: BLE001
    sys.exit(f"需要 python-docx（{exc}）。用一个装了它的解释器运行本脚本。")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "exports" / "docx"

EN_FONT = "Calibri"
CN_FONT = "宋体"
MONO_FONT = "Consolas"
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x55, 0x5F, 0x6D)
ACCENT = RGBColor(0x1F, 0x4E, 0x79)

# 默认转换清单：Phase 2 的操作用文档
DEFAULT_FILES = [
    "evaluation/recruitment-message.md",
    "evaluation/consent-and-information.md",
    "evaluation/pilot-plan.md",
    "evaluation/facilitator-script.md",
    "evaluation/README.md",
    "docs/release-notes.md",
    "docs/blocked-defect-demo.md",
]


# ------------------------------------------------------------------ 排版基础


def set_font(run, size=None, bold=None, italic=None, mono=False, color=None):
    run.font.name = MONO_FONT if mono else EN_FONT
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:ascii"), MONO_FONT if mono else EN_FONT)
    rf.set(qn("w:hAnsi"), MONO_FONT if mono else EN_FONT)
    rf.set(qn("w:eastAsia"), CN_FONT)


def setup(doc: Document) -> None:
    st = doc.styles["Normal"]
    st.font.name = EN_FONT
    st.font.size = Pt(10.5)
    rpr = st.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:ascii"), EN_FONT)
    rf.set(qn("w:hAnsi"), EN_FONT)
    rf.set(qn("w:eastAsia"), CN_FONT)
    st.paragraph_format.space_after = Pt(5)
    st.paragraph_format.line_spacing = 1.2

    for s in doc.sections:
        s.top_margin = Cm(2.0)
        s.bottom_margin = Cm(2.0)
        s.left_margin = Cm(2.2)
        s.right_margin = Cm(2.2)

    # 页脚页码
    footer = doc.sections[0].footer
    p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    set_font(run, 8.5, color=MUTED)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    run._r.addnext(fld)


def inline_tokens(text):
    """把行内标记切成 (片段, 粗, 斜, 等宽) 四元组。

    用独立开关而不是正则整段匹配，因为强调可以嵌套：
    "**Record what you decided *not* to change.**" 里的 *not* 位于粗体内部，
    正则非贪婪匹配会把整段吞成一个粗体片段，内层星号就原样漏出来了。
    """
    # 下划线斜体 _text_ 也要支持，但下划线同时是标识符的组成部分
    # （positive_rate、is_free、phase1_analytics）。按标准 Markdown 的分隔符规则，
    # 只有两侧不是字母数字/下划线时才当作强调，先归一化成星号再统一分词。
    text = re.sub(r"(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])", r"*\1*", text)

    i, bold, italic = 0, False, False
    buf = []

    def flush():
        if buf:
            out.append(("".join(buf), bold, italic, False))
            buf.clear()

    out = []
    while i < len(text):
        if text.startswith("**", i):
            flush(); bold = not bold; i += 2; continue
        if text[i] == "*":
            flush(); italic = not italic; i += 1; continue
        if text[i] == "`":
            flush()
            j = text.find("`", i + 1)
            if j == -1:
                buf.append(text[i]); i += 1; continue
            out.append((text[i + 1:j], bold, italic, True))
            i = j + 1; continue
        buf.append(text[i]); i += 1
    flush()
    return out


def add_runs(par, text, size=10.5, base_bold=False, color=None):
    """按 inline_tokens 渲染，支持 **粗体**、*斜体*、嵌套、以及 `代码`。"""
    for seg, b, it, mono in inline_tokens(text):
        if not seg:
            continue
        r = par.add_run(seg)
        if mono:
            set_font(r, size - 0.5, bold=b or base_bold, italic=it, mono=True,
                     color=RGBColor(0x8B, 0x2E, 0x2E))
        else:
            set_font(r, size, bold=b or base_bold, italic=it, color=color)
    return par


def heading(doc, text, level):
    sizes = {1: 16, 2: 13, 3: 11.5, 4: 10.5}
    size = sizes.get(level, 10.5)
    color = ACCENT if level <= 2 else INK
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level <= 2 else 10)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    # 标题里也可能出现行内标记（例如 "## Question 4 — **scored measure**"）。
    # 早期版本直接 add_run(text)，导致标记原样出现在文档里。
    for seg, b, it, mono in inline_tokens(text):
        if not seg:
            continue
        r = p.add_run(seg)
        if mono:
            set_font(r, size - 0.5, bold=True, italic=it, mono=True, color=color)
        else:
            set_font(r, size, bold=True, italic=it, color=color)
    if level == 1:
        # 标题下加一条细线
        pPr = p._p.get_or_add_pPr()
        bd = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:color"), "1F4E79")
        bd.append(bottom)
        pPr.append(bd)
    return p


def bullet(doc, text, marker="•", indent=0.55):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(indent)
    p.paragraph_format.first_line_indent = Cm(-0.35)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(marker + "\u00a0")
    set_font(r, 10.5)
    add_runs(p, text)
    return p


def quote(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.8)
    p.paragraph_format.space_after = Pt(6)
    pPr = p._p.get_or_add_pPr()
    bd = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "12")
    left.set(qn("w:color"), "B9C6D6")
    left.set(qn("w:space"), "8")
    bd.append(left)
    pPr.append(bd)
    add_runs(p, text, size=10, color=MUTED)
    return p


def code_block(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.0
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), "F2F4F7")
    pPr.append(shd)
    for idx, line in enumerate(text.split("\n")):
        if idx:
            p.add_run().add_break()
        r = p.add_run(line if line else " ")
        set_font(r, 9, mono=True)
    return p


def hrule(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    pPr = p._p.get_or_add_pPr()
    bd = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:color"), "DCE1E8")
    bd.append(bottom)
    pPr.append(bd)


def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


SEP_ROW = re.compile(r"^\s*\|[\s:\-\|]+\|\s*$")


def split_row(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def add_table(doc, lines):
    header = split_row(lines[0])
    body = [split_row(ln) for ln in lines[2:]]
    ncols = len(header)
    t = doc.add_table(rows=1, cols=ncols)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True

    for i, h in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        add_runs(p, h, size=9.5, base_bold=True)
        shade(cell, "EAF0F6")

    for row in body:
        cells = t.add_row().cells
        for i in range(ncols):
            val = row[i] if i < len(row) else ""
            cell = cells[i]
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            add_runs(p, val, size=9.5)

    # 按各列内容长度分配列宽。
    # 只设 cell.width 不够：autofit 打开时 Word/预览器会重算布局，窄列表头会挤在一起。
    # 必须关掉 autofit、把 tblLayout 设为 fixed，并把宽度同时写进 tblGrid 与每个单元格。
    avail_cm = 16.6                       # A4 21cm 减去左右边距 4.4cm
    weights = []
    for ci in range(ncols):
        # 表头留 3 字符余量，否则 "Threshold" 这类较长的表头会和相邻列贴住
        longest = max([len(header[ci]) + 3] +
                      [len(r[ci]) if ci < len(r) else 0 for r in body])
        weights.append(max(6, min(longest, 60)))
    tot = float(sum(weights)) or 1.0
    widths = [Cm(max(1.9, avail_cm * w / tot)) for w in weights]

    t.autofit = False
    tblPr = t._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)

    grid = t._tbl.find(qn("w:tblGrid"))
    if grid is not None:
        for gc, w in zip(grid.findall(qn("w:gridCol")), widths):
            gc.set(qn("w:w"), str(int(w.twips)))

    for row in t.rows:
        for ci, w in enumerate(widths):
            row.cells[ci].width = w

    # 表格后留白
    gap = doc.add_paragraph()
    gap.paragraph_format.space_after = Pt(2)
    return t


# ------------------------------------------------------------------ 解析主循环


def convert(md_path: Path, out_path: Path, title: str | None = None) -> None:
    lines = md_path.read_text(encoding="utf-8").split("\n")
    doc = Document()
    setup(doc)

    # 抬头不再单独渲染：Markdown 的首个 H1 就是标题，重复一遍会出现两个标题。
    # 改为在首个标题之后插一行"来源文件"小字，便于追溯。
    note_added = False

    def add_source_note():
        nonlocal note_added
        if note_added:
            return
        note_added = True
        n = doc.add_paragraph()
        n.paragraph_format.space_after = Pt(10)
        r = n.add_run(f"来源文件：{md_path.name}　·　由 analysis/export_docs_to_docx.py 生成")
        set_font(r, 8.5, color=MUTED)

    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # 围栏代码块
        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            code_block(doc, "\n".join(buf))
            continue

        # 表格
        if stripped.startswith("|") and i + 1 < len(lines) and SEP_ROW.match(lines[i + 1]):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            add_table(doc, block)
            continue

        # 分隔线
        if re.fullmatch(r"-{3,}|\*{3,}|_{3,}", stripped):
            hrule(doc)
            i += 1
            continue

        # 空行
        if not stripped:
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            heading(doc, m.group(2).strip(), len(m.group(1)))
            add_source_note()
            i += 1
            continue

        # 引用块（连续多行合并）
        if stripped.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            quote(doc, " ".join(x for x in buf if x))
            continue

        # 列表项可能跨行（Markdown 里续行缩进 2 空格以上）。
        # 不合并的话，续行会变成脱离缩进的独立段落，看起来像排版错误。
        def take_continuation(first, j):
            parts = [first]
            while j < len(lines):
                nxt = lines[j]
                if not nxt.strip():
                    break
                # 只接受缩进的普通续行；缩进的子列表项另作新项处理
                if not re.match(r"^\s{2,}\S", nxt):
                    break
                if re.match(r"^\s*([-*]|\d+[.)])\s", nxt):
                    break
                parts.append(nxt.strip())
                j += 1
            return " ".join(parts), j

        # 复选框
        m = re.match(r"^[-*]\s+\[([ xX])\]\s+(.*)$", stripped)
        if m:
            marker = "\u2611" if m.group(1).lower() == "x" else "\u2610"
            text, i = take_continuation(m.group(2), i + 1)
            bullet(doc, text, marker=marker)
            continue

        # 无序列表
        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            text, i = take_continuation(m.group(1), i + 1)
            bullet(doc, text)
            continue

        # 有序列表
        m = re.match(r"^(\d+)[.)]\s+(.*)$", stripped)
        if m:
            text, i = take_continuation(m.group(2), i + 1)
            bullet(doc, text, marker=f"{m.group(1)}.")
            continue

        # 普通段落（把紧随其后的非空、非特殊行并入同一段）
        buf = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if (not nxt or nxt.startswith(("#", "|", ">", "```", "-", "*"))
                    or re.match(r"^\d+[.)]\s", nxt) or re.fullmatch(r"-{3,}", nxt)):
                break
            buf.append(nxt)
            i += 1
        p = doc.add_paragraph()
        add_runs(p, " ".join(buf))

    add_source_note()      # 没有 H1 的文件也要有来源标注
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="要转换的 .md（默认转 Phase 2 文档清单）")
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    outdir = Path(args.outdir) if args.outdir else OUT_DIR
    if not outdir.is_absolute():
        outdir = ROOT / outdir

    paths = [Path(f) for f in args.files] if args.files else [ROOT / f for f in DEFAULT_FILES]

    ok, failed = 0, []
    for p in paths:
        p = p if p.is_absolute() else ROOT / p
        if not p.exists():
            failed.append(f"{p}（不存在）")
            continue
        # 用文档的一级标题作为抬头，找不到就用文件名
        text = p.read_text(encoding="utf-8")
        m = re.search(r"^#\s+(.+)$", text, re.M)
        title = m.group(1).strip() if m else None

        # 去掉首个 H1（已作为正文标题渲染），避免重复
        if m and not text.startswith("\n"):
            pass  # 保留：H1 作为正文的一级标题更清晰
        out = outdir / (p.stem + ".docx")
        try:
            convert(p, out, title=title)
            size = out.stat().st_size / 1024
            print(f"  ok   {p.name:38} -> {out.relative_to(ROOT)}  ({size:.0f} KB)")
            ok += 1
        except Exception as exc:                              # noqa: BLE001
            failed.append(f"{p.name}: {type(exc).__name__} {exc}")

    print(f"\n转换 {ok} 个" + (f"，失败 {len(failed)} 个" if failed else ""))
    for f in failed:
        print(f"  FAIL {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
