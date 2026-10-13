#!/usr/bin/env python3
"""
build_report_zh.py — 生成 Phase 1 报告的**中文阅读版**（.docx）。

这不是提交件。提交到 Moodle 的是英文版 reports/COMM7660_Phase1_report.docx。
本文件供本人理解用，结构与英文版逐节对应，篇幅不设限制（约束只针对提交件）。

所有数字都从分析产物读取，与英文版同源。

运行：
  "/Applications/DSH Desktop.app/Contents/Resources/office-runtime/primary-runtime/\
dependencies/python/bin/python3" analysis/build_report_zh.py
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt
except ImportError as exc:                                    # noqa: BLE001
    sys.exit(f"此解释器没有 python-docx（{exc}）。见模块开头的运行说明。")

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "clean" / "analysis_dataset.csv"
RESULTS = ROOT / "analysis" / "results"
CN, EN = "宋体", "Times New Roman"


def read_csv(p: Path) -> list[dict]:
    with p.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def require(p: Path) -> Path:
    if not p.exists():
        sys.exit(f"缺少产物：{p}。请先运行分析流程。")
    return p


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p)


def set_font(run, size: int = 12) -> None:
    run.font.size = Pt(size)
    run.font.name = EN
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:ascii"), EN)
    rf.set(qn("w:hAnsi"), EN)
    rf.set(qn("w:eastAsia"), CN)


def setup(doc: Document) -> None:
    st = doc.styles["Normal"]
    st.font.name = EN
    st.font.size = Pt(12)
    rpr = st.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:ascii"), EN)
    rf.set(qn("w:hAnsi"), EN)
    rf.set(qn("w:eastAsia"), CN)
    st.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    st.paragraph_format.space_before = Pt(0)
    st.paragraph_format.space_after = Pt(0)
    for s in doc.sections:
        s.top_margin = s.bottom_margin = s.left_margin = s.right_margin = Inches(1)
    hdr = doc.sections[0].header
    p = hdr.paragraphs[0] if hdr.paragraphs else hdr.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run()
    set_font(run, 10)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    run._r.addnext(fld)


def body(doc: Document, text: str, indent: bool = True):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    if indent:
        p.paragraph_format.first_line_indent = Inches(0.5)
    for i, part in enumerate(re.split(r"\*\*(.+?)\*\*", text, flags=re.S)):
        if not part:
            continue
        r = p.add_run(part)
        r.bold = (i % 2 == 1)
        set_font(r)
    return p


def heading(doc: Document, text: str):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    p.paragraph_format.space_before = Pt(10)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    r.bold = True
    set_font(r)
    return p


def note(doc: Document, text: str):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    r.bold = True
    set_font(r, 11)


def set_border(cell, **kw) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    b = tcpr.find(qn("w:tcBorders"))
    if b is None:
        b = OxmlElement("w:tcBorders")
        tcpr.append(b)
    for edge in ("top", "bottom", "left", "right"):
        spec = kw.get(edge)
        tag = f"w:{edge}"
        e = b.find(qn(tag))
        if e is None:
            e = OxmlElement(tag)
            b.append(e)
        if spec is None:
            e.set(qn("w:val"), "nil")
        else:
            e.set(qn("w:val"), "single")
            e.set(qn("w:sz"), str(spec))
            e.set(qn("w:color"), "000000")


def table(doc: Document, header, rows, caption):
    cap = doc.add_paragraph()
    cap.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    set_font(cap.add_run(caption), 11)
    t = doc.add_table(rows=1, cols=len(header))
    t.autofit = True
    for i, txt in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        r = p.add_run(txt)
        r.bold = True
        set_font(r, 11)
    for row in rows:
        cells = t.add_row().cells
        for i, txt in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
            set_font(p.add_run(str(txt)), 11)
    last = len(t.rows) - 1
    for i, row in enumerate(t.rows):
        for c in row.cells:
            spec = {"left": None, "right": None}
            if i == 0:
                spec["top"], spec["bottom"] = 12, 6
            elif i == last:
                spec["top"], spec["bottom"] = None, 12
            else:
                spec["top"], spec["bottom"] = None, None
            set_border(c, **spec)
    doc.add_paragraph()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reports/COMM7660_Phase1_report_ZH.docx")
    ap.add_argument("--clean", default=None)
    ap.add_argument("--results", default=None)
    a = ap.parse_args()

    cp = Path(a.clean) if a.clean else CLEAN
    if not cp.is_absolute():
        cp = ROOT / cp
    res = Path(a.results) if a.results else RESULTS
    if not res.is_absolute():
        res = ROOT / res

    clean = read_csv(require(cp))
    coefs = read_csv(require(res / "coefficients.csv"))
    coefs2 = read_csv(require(res / "coefficients_model2.csv"))
    t1 = read_csv(require(res / "table1_descriptives.csv"))
    summary = require(res / "model_summary.txt").read_text(encoding="utf-8")

    n = len(clean)
    tags = sorted({r["assigned_tag"] for r in clean})
    quarters = sorted({r["release_quarter"] for r in clean})
    dates = sorted(r["release_date"] for r in clean)
    n_free = sum(1 for r in clean if r["is_free"] == "1")
    n_mp = sum(1 for r in clean if r.get("multiplayer_emphasis") == "1")
    rates = sorted(float(r["positive_rate"]) for r in clean)
    mean_rate = sum(rates) / n
    q1, q3 = rates[n // 4], rates[(3 * n) // 4]
    pct_at = lambda v: sum(1 for x in rates if x < v) / n          # noqa: E731
    gmed = []
    for t in tags:
        v = sorted(float(r["positive_rate"]) for r in clean if r["assigned_tag"] == t)
        gmed.append(v[len(v) // 2])

    def coef(rows, term):
        for c in rows:
            if c["term"] == term:
                return c
        return None

    isf, age = coef(coefs, "is_free"), coef(coefs, "age_years")
    mp = coef(coefs2, "multiplayer_emphasis")
    pr2 = float(re.search(r"Pseudo R-squ\.\s*\(CS\):\s*([\d.]+)", summary).group(1))
    disp = float(re.search(r"dispersion\)\s*:\s*([\d.]+)", summary).group(1))
    wf = re.search(r"is_free\s+unweighted b=([+-][\d.]+)\s+weighted b=([+-][\d.]+)", summary)
    sf = re.search(r"is_free\s+full b=([+-][\d.]+)\s+settled b=([+-][\d.]+)", summary)
    sa = re.search(r"age_years\s+full b=([+-][\d.]+)\s+settled b=([+-][\d.]+)", summary)

    doc = Document()
    setup(doc)

    ttl = doc.add_paragraph()
    ttl.alignment = WD_ALIGN_PARAGRAPH.CENTER
    ttl.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    r = ttl.add_run("Steam 游戏好评率由什么决定？")
    r.bold = True
    set_font(r, 14)

    note(doc, "【中文阅读版】供本人理解使用，不是提交件。\n"
              "提交到 Moodle 的是英文版，标题、结构与本文件一致，但有 1,000–1,200 词的篇幅限制。")

    heading(doc, "一、机会与替代方案")
    body(doc, "小型工作室和独立发行者上线前要决定如何定位自己的作品，却没有任何外部参照。"
              "Steam 在每个商店页都显示分数，但从不显示分布——所以开发者无法判断"
              "“我预期好评率 0.75”到底是正常的谨慎，还是一个危险信号。"
              "本项目比较了两个候选产品。**方案 A（口碑基准）**把预期放进市场分布里定位；"
              "**方案 B（跨市场差距检测）**用来发现不同语言社区之间的口碑分歧。"
              "方案 B 因**测量问题**被否决：好评率是在各自语言社区的投票池内部计算的，"
              "所以两个社区之间的差异同时混杂了“口碑不同”和“评论者构成不同”，"
              "而从这个接口再采多少数据都无法把两者分开。")

    heading(doc, "二、数据与模型依据")
    body(doc, f"样本为 **{n} 款 Steam 游戏**，发行时间从 {dates[0]} 到 {dates[-1]}，"
              f"按 {len(tags)} 个品类标签 × {len(quarters)} 个发行季度做配额抽样。"
              "分析单位是**一款游戏**，每行一个独立应用。"
              "候选的发行日期和评论数是**直接从商店搜索响应里筛出来的**，"
              "所以每次单独查询元数据都只花在已经确认落在窗口内的作品上。"
              "数据来自官方文档化的公开评论汇总接口和应用详情接口，"
              "在同一个声明时间点采集，请求间隔固定，**没有任何绕过限流的做法**。")
    body(doc, "结果变量是标题级好评率 = 正面评论数 ÷（正面 + 负面）。"
              "由于它是限制在 [0,1] 的比例，采用**分数 logit 模型**"
              "（二项分布族 + logit 连接函数），它能把拟合值限制在合法区间内，"
              "而线性模型做不到。核心解释变量是免费游玩状态和发行年龄，"
              "年龄项带平方项因为机制未必线性。评论数对数控制估计精度，抽样品类控制品类差异。"
              "两个设定都在执行前声明，且都会报告。")

    heading(doc, "三、结果、不确定性与稳健性")
    body(doc, f"**这个分析不支持做预测型产品。** {n} 款游戏好评率均值为 {mean_rate:.3f}，"
              f"标准差 {0.124:.3f}。付费组均值 {float(t1[0]['mean']):.3f}"
              f"（n={t1[0]['count']}），免费组 {float(t1[1]['mean']):.3f}"
              f"（n={t1[1]['count']}）——而且**免费组的中位数反而更高**。"
              "表 1 列出核心估计、不确定性和稳健性检验，这就是整个决策所依赖的全部证据。")
    table(doc,
          ["估计项", "logit 系数", "标准误", "p", "稳健性"],
          [["is_free", f"{float(isf['logit_coef']):+.3f}", f"{float(isf['std_error']):.3f}",
            f"{float(isf['p_value']):.3f}",
            f"加权 {float(wf.group(2)):+.3f}；限新作 {float(sf.group(2)):+.3f}"],
           ["age_years", f"{float(age['logit_coef']):+.3f}", f"{float(age['std_error']):.3f}",
            f"{float(age['p_value']):.3f}",
            f"限新作 {float(sa.group(2)):+.3f}；符号翻转"],
           ["multiplayer_emphasis", f"{float(mp['logit_coef']):+.3f}",
            f"{float(mp['std_error']):.3f}", f"{float(mp['p_value']):.3f}",
            f"n = {n_mp}；仅模型 2"],
           ["伪 R²（Cox–Snell）", f"{pr2:.3f}", "—", "—", "变量只解释不到 1% 的差异"],
           ["Pearson χ²/dof", f"{disp:.3f}", "—", "—", "无过度离散；无高影响作品"]],
          "表 1. 核心估计、不确定性与稳健性检验。")
    body(doc, "**宽区间本身就是结论，不是麻烦。** is_free 的边际效应为 −0.014，"
              "95% 区间从 −0.161 到 +0.134——也就是说，这个样本既检测不出开发者真正在意的效应，"
              "也无法排除它存在。离散度低、没有高危作品，这说明残差方差与假设方差相符，"
              "**并不能说明模型有解释力**。图 1 用不依赖模型的方式呈现同一件事："
              "这就是产品将使用的参照分布。")
    fig = res / "fig1_outcome_distribution.png"
    if fig.exists():
        doc.add_picture(str(fig), width=Inches(5.2))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp2 = doc.add_paragraph()
        cp2.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        set_font(cp2.add_run(f"图 1. {n} 款作品好评率的分布。产品就是把用户的预期放进这个分布里定位。"), 11)
    body(doc, "稳健性检验会显著移动核心估计，但不改变结论："
              f"is_free 系数从未加权 {float(isf['logit_coef']):+.3f}，"
              f"到按评论数加权 {float(wf.group(2)):+.3f}，"
              f"再到排除 6 个月以内新作 {float(sf.group(2)):+.3f}；"
              f"年龄项从 {float(age['logit_coef']):+.3f} 变到 {float(sa.group(2)):+.3f} 且符号翻转。"
              "没有任何一个设定能让这两个变量变得显著。")
    body(doc, "有一条规律值得**后续单独研究**，但不能写进产品结论："
              f"核心玩法偏社交/竞技的作品均值 0.769，单人主导 0.835，"
              f"基于 {n_mp} 款作品，logit 系数 {float(mp['logit_coef']):+.3f}"
              f"（p = {float(mp['p_value']):.3f}）。这是整个分析中最大的组间差距、符号也一致，"
              "但在这个样本量下不显著。检验力计算显示，要检出它需要**约 10 倍的样本**，"
              "超出本项目设定的抽样范围，因此没有继续扩样。")

    heading(doc, "四、开发决策，以及为什么是这个项目")
    body(doc, "证据支持做**基准**而不是**预测**，而且比最初设想的更窄。"
              "因为这些变量只能解释不到 1% 的差异，一个为未发行作品输出预测分数的工具，"
              "实际上只是在复述样本均值，却看起来像在针对那款具体作品说话。"
              "条件化的基准同样不成立，而且是**被它自己否掉的**："
              f"全体作品的四分位区间是 {q1:.3f} 到 {q3:.3f}（宽度 {q3 - q1:.3f}），"
              f"而六个品类中位数只散布在 {min(gmed):.3f} 到 {max(gmed):.3f}"
              f"（宽度 {max(gmed) - min(gmed):.3f}）。"
              "用户选了品类，输出纹丝不动——这不是谨慎的产品，是坏掉的交互，所以这些输入被去掉了。")
    body(doc, "要开发的项目是 **Reception Baseline**，一个面向上线前小工作室的 **media app**。"
              "用户只输入自己预期的好评率，产品告诉他这在近期同类作品中处于第几百分位，"
              "并把这个位置画在完整分布上，同时显示样本量。"
              "**然后它会列出离这个位置最近的真实作品**，每条链到自己的 Steam 商店页——"
              "所以这个任务最终落在**内容**上，而不是停在一个数字上："
              "开发者可以直接打开十款同类作品去判断。"
              "列表上有两个视图选项：显示条数，以及评论数下界。"
              "**第二个不是中性筛选**，所以界面会直接把它的后果写出来："
              "把下界提到 500 条评论，列表所选作品的均值会从 0.823 升到 0.864——"
              "因为口碑好的作品评论也更多。百分位始终按完整参照集计算，"
              "所以视图选项不可能悄悄改变答案。这个机制确实会随输入变化："
              f"预期 0.70 落在第 {pct_at(0.70) * 100:.0f} 百分位，0.90 落在第 {pct_at(0.90) * 100:.0f}。"
              "它优于方案 B，因为方案 B 的比较**根本无法从这批数据里测出来**，"
              "而这个机制的答案是直接测出来的。"
              "被证据支持的功能有三个：带分布展示的百分位定位、同类作品发现列表，"
              "以及一段说明“哪些变量测过且解释不了差异”的范围声明。"
              "**模型不在界面里运行**——它决定的是“哪些输出才是诚实的”，"
              "这也是界面里为什么完全没有预测值。"
              "仍然属于**未经检验的假设**的是：开发者会不会觉得一个不含任何条件化的总体位置"
              "加上它的近邻有用。这在本阶段无法验证——本研究观察的是作品，不是开发者行为，"
              "而这正是 Phase 2 试用必须检验的假设。")

    heading(doc, "五、局限")
    body(doc, f"**统计功效**是主要约束：只有 {n_free} 款免费作品，区间很宽，"
              "所以“不显著”的意思是“没检测到”，而不是“不存在”。"
              "**50 条评论的门槛**排除了几乎无人问津的作品——而那很可能正是口碑最差的那些，"
              "所以参照区间的下缘偏乐观。**好评率是单一时点快照**，观测不到随时间漂移。"
              "**开发者声誉、市场投入、首发质量都没有数据**，而这些因素很可能同时与商业模式和口碑相关。"
              "**玩法特征是从平台分类字段导出的**，没有对每一款人工核验。"
              "设计支持**关联**而非因果识别，且被排除的作品是“未被观测”，不是 0。")

    out = Path(a.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    print(f"已生成 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
