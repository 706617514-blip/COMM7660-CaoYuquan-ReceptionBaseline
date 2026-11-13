#!/usr/bin/env python3
"""部署产物自洽性检查：站点能不能自己把自己跑起来。

为什么要有这个脚本
------------------
2026-11-13 出过一次真实的发布事故：`game/` 里新增了 `sprites.js`、
`baghud.js`、`audio.js`、`bosspose.js` 四个脚本和 `game/assets/` 下六张
Boss 贴图，但 `deploy-pages.yml` 的 stage 步骤是**手写白名单**，一个都没
复制。工作流末尾自检也只查那 5 个写死的旧文件，于是构建**绿着**发布了
一个"首页引用了四个 404 脚本"的站点。CI 五项必需检查全 pass —— 因为
它们检查的是仓库里的文件，不是发布出去的那份。

判据
----
不是"我复制了我以为该复制的文件"，而是"页面自己声明的依赖都在磁盘上"：

1. `index.html` 里每个 `<script src="...">` 都要解析得到、非空；
2. `game/assets/` 下每个 `boss_*.png` 都要在站点里（这六张是运行期
   `load.image` 的，页面源码里查不到，所以单独钉住）；
3. 站点根下不允许出现 Phase 1 的 `reference-data.js`（放错层级会让
   `/phase1/` 整个工具 404）。

用法：
    python3 analysis/check_staged_site.py site

退出码 0 = 自洽；1 = 有缺口，并逐条打印缺了什么。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SCRIPT_SRC = re.compile(r'<script[^>]*\bsrc=["\']([^"\']+)["\']', re.I)


def check(site: Path) -> list[str]:
    """返回问题列表；空列表 = 通过。"""
    problems: list[str] = []

    index = site / "index.html"
    if not index.is_file() or index.stat().st_size == 0:
        return [f"站点根缺少 index.html（或为空）: {index}"]

    html = index.read_text(encoding="utf-8", errors="replace")

    # 1. 页面自己声明的每个脚本。
    srcs = SCRIPT_SRC.findall(html)
    if not srcs:
        problems.append("index.html 里一个 <script src> 都没有，解析可能失效了")
    for src in srcs:
        if re.match(r"^[a-z]+://", src, re.I) or src.startswith("//"):
            continue  # 外链不查
        target = site / src.lstrip("/")
        if not target.is_file():
            problems.append(f"index.html 引用了不存在的脚本: {src}")
        elif target.stat().st_size == 0:
            problems.append(f"index.html 引用的脚本是空文件: {src}")

    # 2. 运行期加载的 Boss 贴图。
    assets = Path(__file__).resolve().parent.parent / "game" / "assets"
    bosses = sorted(assets.glob("boss_*.png")) if assets.is_dir() else []
    if len(bosses) != 6:
        problems.append(f"game/assets 下的 boss_*.png 不是 6 张（实际 {len(bosses)} 张）")
    for png in bosses:
        target = site / "assets" / png.name
        if not target.is_file():
            problems.append(f"站点缺少 Boss 贴图: assets/{png.name}")

    # 3. Phase 1 工具必须在 /phase1/ 下，不能在根上。
    if (site / "reference-data.js").is_file():
        problems.append("reference-data.js 被放到了站点根，应该在 /phase1/ 下")
    for rel in ("phase1/index.html", "phase1/reference-data.js"):
        target = site / rel
        if not target.is_file() or target.stat().st_size == 0:
            problems.append(f"Phase 1 工具缺少文件: {rel}")

    return problems


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("用法: check_staged_site.py <site-dir>", file=sys.stderr)
        return 2

    site = Path(argv[1])
    if not site.is_dir():
        print(f"::error::站点目录不存在: {site}", file=sys.stderr)
        return 1

    problems = check(site)
    if problems:
        for p in problems:
            print(f"::error::{p}")
        print(f"\n站点不自洽：{len(problems)} 处缺口", file=sys.stderr)
        return 1

    scripts = len(SCRIPT_SRC.findall((site / "index.html").read_text(encoding="utf-8")))
    files = sum(1 for p in site.rglob("*") if p.is_file())
    print(f"站点自洽 ✓  {files} 个文件，index.html 声明的 {scripts} 个脚本全部存在，"
          f"6 张 Boss 贴图齐全，Phase 1 工具在 /phase1/")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
