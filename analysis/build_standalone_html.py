#!/usr/bin/env python3
"""
build_standalone_html.py — 把 product/ 的三件套打包成**单个自包含 HTML 文件**。

为什么需要
----------
产品正常形态是 index.html + reference-data.js（数据用 <script src> 加载，
这样双击也能开，不受 file:// 的 CORS 限制）。但要在邮件里发给老师时，
三个文件互相依赖就成了障碍：老师只点开 index.html 会看到空白页。

这个脚本把 CSS、JS、数据全部内联进一个 .html，产出：

    product/reception-baseline-standalone.html

单文件、无外部依赖（唯一的站外链接是用户点击时才访问的 Steam 商店页）、
能在任何浏览器离线打开。

注意：这个文件是**分发副本**，不是产品本体。产品本体仍是 product/index.html，
测试（tests/test_product_app.js）也仍然针对产品本体运行。改完本体要重新生成它。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCT = ROOT / "product"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="product/reception-baseline-standalone.html")
    args = ap.parse_args()

    index = PRODUCT / "index.html"
    data_js = PRODUCT / "reference-data.js"
    for p in (index, data_js):
        if not p.exists():
            sys.exit(f"缺少 {p}。请先运行 analysis/build_product_data.py。")

    html = index.read_text(encoding="utf-8")
    payload = data_js.read_text(encoding="utf-8")

    # 1. 把 <script src="reference-data.js"></script> 换成内联数据
    inline = "<script>\n" + payload + "</script>"
    pattern = re.compile(r'<script\s+src="reference-data\.js"\s*></script>')
    if not pattern.search(html):
        sys.exit("在 index.html 中找不到 reference-data.js 的 <script src> 标签；"
                 "产品结构变了，请同步更新本脚本。")
    html = pattern.sub(lambda _m: inline, html, count=1)

    # 2. 加一句"这是分发副本"的可见标注，避免和产品本体混淆
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    banner = (
        "<!-- 分发副本（standalone）：由 analysis/build_standalone_html.py 生成，"
        f"数据已内联。生成时间 {stamp}。产品本体是 product/index.html。 -->\n"
    )
    html = banner + html

    # 3. 自检：不得残留任何对本地文件的引用。
    #    要排除 JS 里拼出来的属性（形如 href="' + url + '"）——那是运行时生成的，
    #    不是静态本地引用，否则检查会误报。
    candidates = re.findall(r'(?:src|href)="([^"]*)"', html)
    leftovers = []
    for ref in candidates:
        if ref.startswith(("https:", "http:", "#", "mailto:", "data:")):
            continue
        if "+" in ref or "'" in ref or "{" in ref:      # JS 拼接 / 模板占位
            continue
        leftovers.append(ref)
    if leftovers:
        sys.exit(f"仍存在对本地文件的引用，单文件版会在别处打开失败：{leftovers}")

    if "window.REFERENCE_DATA" not in html:
        sys.exit("内联后找不到 window.REFERENCE_DATA，数据没有正确嵌入。")

    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    kb = out.stat().st_size / 1024
    n = len(json.loads(re.search(r"window\.REFERENCE_DATA\s*=\s*(\{.*?\});",
                                 payload, re.S).group(1))["titles"])
    print(f"已生成 {out}")
    print(f"  单个文件，{kb:.1f} KB，内联 {n} 款作品的参照分布")
    print(f"  双击即可打开，无需服务器、无需其他文件")
    print(f"  自检：无本地文件引用 ✓  数据已内联 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
