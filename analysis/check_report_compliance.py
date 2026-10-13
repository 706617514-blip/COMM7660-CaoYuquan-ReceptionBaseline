#!/usr/bin/env python3
"""
check_report_compliance.py — verify the produced .docx against the assignment brief's rules.

Why a separate checker when build_report.py already counts words
----------------------------------------------------------------
The builder counts what it *intends* to write. This checker reads the finished .docx from disk
and counts what is *actually* in it. If the two ever disagree, the file is wrong regardless of
what the builder believed, so the check is run against the artifact rather than trusted.

Rules checked, quoted from the brief:

  * "Submit an individual 1,000-1,200-word Phase 1 report... Word counts exclude the access
    block, references, tables, and figures."
  * "Use at most two main tables/figures in each report; full outputs and appendices belong in
    GitHub."
  * "Access block in each report: Project title, your name and student identifier, phase,
    repository address, collaborator username fffchaobu and invitation date/status, submitted
    release/tag, and full commit identifier."
  * "12-point Times New Roman, black text, one-inch margins, double-spaced prose, and 0.5-inch
    first-line paragraph indents."

Run with the bundled office interpreter:

  "/Applications/DSH Desktop.app/Contents/Resources/office-runtime/primary-runtime/\
dependencies/python/bin/python3" analysis/check_report_compliance.py

Exit code 0 = all checks pass.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.shared import Pt
except ImportError as exc:                                    # noqa: BLE001
    sys.exit(f"python-docx unavailable ({exc}). See the module docstring.")

ROOT = Path(__file__).resolve().parent.parent
WORD_MIN, WORD_MAX = 1000, 1200

ACCESS_FIELDS = ["Project title", "Student", "Student identifier", "Phase",
                 "Repository", "Collaborator", "Submitted release", "Full commit identifier"]

# Headings whose content is excluded from the word count.
EXCLUDED_SECTIONS = {"references"}


def paragraph_texts(doc) -> list[str]:
    return [p.text for p in doc.paragraphs]


def body_word_count(doc) -> tuple[int, list[str]]:
    """Count words in body prose only: skip the access block, any excluded section, and tables."""
    words = 0
    counted_paras = []
    in_access = True
    in_excluded = False
    for p in doc.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        # the access block runs until the report title (first bold, centred heading after it)
        if in_access:
            if "Access block" not in t and ":" not in t:
                in_access = False
            else:
                continue
        low = t.lower().rstrip(":")
        if low in EXCLUDED_SECTIONS:
            in_excluded = True
            continue
        if in_excluded:
            continue
        words += len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'\u2019\-\.]*", t))
        counted_paras.append(t)
    return words, counted_paras


def check(path: Path, expect_bilingual: bool) -> list[str]:
    problems: list[str] = []
    doc = Document(str(path))
    texts = paragraph_texts(doc)
    joined = "\n".join(texts)

    # --- access block
    # Match the label loosely: the block writes "Submitted release / tag: phase1-analytics", so a
    # strict "label:" pattern misses it. Require the label text and a colon on the same line.
    for field in ACCESS_FIELDS:
        if not re.search(re.escape(field) + r"[^\n:]*:", joined, re.I):
            problems.append(f"access block missing field: {field}")
    if not re.search(r"fffchaobu", joined, re.I):
        problems.append("access block does not name the collaborator fffchaobu")

    # --- at most two main tables/figures
    n_tables = len(doc.tables)
    n_images = len(doc.inline_shapes)
    total = n_tables + n_images
    if total > 2:
        problems.append(f"{total} main tables/figures (max 2): {n_tables} table(s), "
                        f"{n_images} figure(s)")

    # --- no appendix in the Moodle report
    for bad in ("appendix", "附录"):
        if re.search(rf"^\s*{bad}\b", joined, re.I | re.M):
            problems.append(f"report contains an appendix section ('{bad}'); "
                            "appendices belong in GitHub")

    # --- word count (English report only; the Chinese copy is a reading aid)
    if not expect_bilingual:
        words, _ = body_word_count(doc)
        if not (WORD_MIN <= words <= WORD_MAX):
            problems.append(f"body word count {words} outside {WORD_MIN}-{WORD_MAX}")

    # --- APA formatting
    for s in doc.sections:
        for name, val in (("top", s.top_margin.inches), ("bottom", s.bottom_margin.inches),
                          ("left", s.left_margin.inches), ("right", s.right_margin.inches)):
            if abs(val - 1.0) > 0.01:
                problems.append(f"{name} margin is {val:.2f} in, expected 1.00")
    normal = doc.styles["Normal"]
    if normal.font.name != "Times New Roman":
        problems.append(f"base font is {normal.font.name}, expected Times New Roman")
    if normal.font.size != Pt(12):
        problems.append(f"base font size is {normal.font.size}, expected 12 pt")

    # first-line indent on body paragraphs
    indents = [p.paragraph_format.first_line_indent for p in doc.paragraphs
               if p.paragraph_format.first_line_indent is not None
               and p.paragraph_format.first_line_indent > 0]
    if indents:
        weird = [i.inches for i in indents if abs(i.inches - 0.5) > 0.01]
        if weird:
            problems.append(f"first-line indents not 0.5 in: {sorted(set(round(w, 3) for w in weird))}")

    # --- three-line table borders (top and bottom rules, no vertical rules)
    if doc.tables:
        first = doc.tables[0]
        tcpr = first.rows[0].cells[0]._tc.find(qn("w:tcPr"))
        borders = tcpr.find(qn("w:tcBorders")) if tcpr is not None else None
        if borders is None:
            problems.append("first table has no explicit borders (not a three-line table?)")
        else:
            got = {e.tag.split("}")[1]: e.get(qn("w:val")) for e in borders}
            if got.get("top") != "single":
                problems.append("first table has no top rule")
            if got.get("left") != "nil":
                problems.append("first table has a vertical rule on the left")

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default="reports/COMM7660_Phase1_report.docx")
    ap.add_argument("--zh", default="reports/COMM7660_Phase1_report_ZH.docx")
    args = ap.parse_args()

    failed = False
    targets = [(Path(args.report), False)]
    zh = Path(args.zh)
    if zh.exists():
        targets.append((zh, True))

    for path, bilingual in targets:
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            print(f"MISSING  {path}")
            failed = True
            continue
        if bilingual:
            # The Chinese file is a reading aid, not a submission. The brief's access-block and
            # formatting rules do not apply to it. The one thing worth asserting is that it says
            # so, because a file that looks submittable but is not is a real hazard.
            doc = Document(str(path))
            text = "\n".join(p.text for p in doc.paragraphs)
            print(f"--- {path.name}  [reading copy] ---")
            if re.search(r"不是提交件|not (a )?submission", text, re.I):
                print("  PASS  labelled as a non-submission reading copy")
            else:
                failed = True
                print("  FAIL  reading copy is not labelled as a non-submission")
            print(f"  info  tables={len(doc.tables)}  figures={len(doc.inline_shapes)}")
            continue

        label = path.name
        print(f"--- {label} ---")
        problems = check(path, bilingual)
        if problems:
            failed = True
            for p in problems:
                print(f"  FAIL  {p}")
        else:
            print("  PASS  all checked rules satisfied")
        doc = Document(str(path))
        words, _ = body_word_count(doc)
        print(f"  info  body words={words}  tables={len(doc.tables)}  "
              f"figures={len(doc.inline_shapes)}")

    print()
    print("RESULT: " + ("FAIL" if failed else "PASS"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
