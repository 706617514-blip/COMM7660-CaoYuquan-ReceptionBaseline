#!/usr/bin/env python3
"""
demo_failed_test.py — 复现一个真实失败过并被修复的测试。

为什么需要这个文件
-----------------
作业 Table 8 要求 tests/ 里包含 "failed-and-repaired test"。这句话的意思不是
"放一个永远失败的测试"，而是**证明某个测试确实抓到过真实缺陷，且现在仍是常驻守卫**。

本脚本挑了一个真实案例，重演完整的 红 → 绿 循环：

  案例：percentileOf 在中段返回常数。
  - 原断言「百分位单调不减」，返回常数也满足它 → 测试保持绿色 → 缺陷逃逸。
  - 修复后断言「数据范围内每前进 5 个百分点必须上升」→ 同一缺陷立即变红。
  - 现在这条断言常驻在 tests/test_product_app.js 里，防止缺陷回归。

脚本做三件事：
  1. 用**原断言**测缺陷代码 → 期望通过（说明旧守卫是无效的）
  2. 用**新断言**测缺陷代码 → 期望失败（说明新守卫有效）
  3. 用**新断言**测正确代码 → 期望通过（说明新守卫不会误报）

任何一步与预期不符，脚本以非零码退出。

用法：
  python3 analysis/demo_failed_test.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "product" / "reference-distribution.json"


def percentile_correct(v: float, rates: list[float]) -> float:
    """产品里真实的定义：把输入线性插值到升序好评率上，再换算为 0–100。"""
    n = len(rates)
    if v <= rates[0]:
        return 0.0
    if v >= rates[-1]:
        return 100.0
    i = 0
    while i < n and rates[i] <= v:
        i += 1
    lo, hi = rates[i - 1], rates[i]
    frac = (v - lo) / (hi - lo) if hi > lo else 0.0
    return ((i - 1 + frac) / (n - 1)) * 100.0


def percentile_defective(v: float, rates: list[float]) -> float:
    """注入的缺陷：中段返回常数 50。"""
    if 0.5 < v < 0.9:
        return 50.0
    return percentile_correct(v, rates)


def assert_non_decreasing(fn, rates) -> tuple[bool, str]:
    """**旧**断言：单调不减。返回常数也能通过。"""
    prev = -1.0
    drops = 0
    for v in range(101):
        p = round(fn(v / 100, rates), 1)
        if v > 0 and p < prev:
            drops += 1
        prev = p
    return drops == 0, f"{drops} 处下降"


def assert_rises_every_5(fn, rates) -> tuple[bool, str]:
    """**新**断言：每前进 5 个百分点都必须上升（覆盖数据范围）。"""
    lo = int(rates[0] * 100) + 1
    hi = int(rates[-1] * 100) - 1
    last = None
    stagnant = 0
    first = None
    v = lo
    while v <= hi:
        p = round(fn(v / 100, rates), 1)
        if last is not None and p <= last:
            stagnant += 1
            if first is None:
                first = v
        last = p
        v += 5
    return stagnant == 0, f"{stagnant} 段未上升" + (f"，首个在输入 {first}" if first else "")


def main() -> int:
    rates = json.loads(DATA.read_text(encoding="utf-8"))["rates_sorted"]
    print(f"参照分布: {len(rates)} 款，好评率 {rates[0]:.3f}–{rates[-1]:.3f}")
    print()

    steps = [
        ("旧断言 + 缺陷代码", assert_non_decreasing, percentile_defective, True,
         "旧守卫无效：缺陷逃逸，测试保持绿色"),
        ("新断言 + 缺陷代码", assert_rises_every_5, percentile_defective, False,
         "新守卫有效：同一缺陷立即变红"),
        ("新断言 + 正确代码", assert_rises_every_5, percentile_correct, True,
         "新守卫不误报：正确代码保持绿色"),
    ]

    failures = 0
    for label, check, fn, expect_pass, why in steps:
        passed, detail = check(fn, rates)
        ok = passed == expect_pass
        verdict = "通过" if passed else "失败"
        mark = "OK " if ok else "!! "
        print(f"  {mark} {label:<24} → {verdict:<4} ({detail})")
        print(f"       {why}")
        if not ok:
            failures += 1

    print()
    if failures:
        print(f"结果不一致：{failures} 步与预期不符")
        return 1
    print("三步全部符合预期：旧守卫无效、新守卫有效、新守卫不误报。")
    print("这条断言常驻 tests/test_product_app.js，防止缺陷回归。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
