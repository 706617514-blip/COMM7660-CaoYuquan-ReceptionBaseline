#!/bin/bash
#
# verify_shell.sh — 验证 Electron 外壳能否真正启动（验收判据 E1/E2）。
#
# 为什么需要这个脚本，而不是一句 `pnpm start`
# --------------------------------------------------
# DSH Harness 在 exec 层把 ELECTRON_RUN_AS_NODE 注入到每个子进程，
# 且**无法从子进程里清掉**（2026-11-15 实测：Python 传的 env 里明确
# 删掉了它，Node 仍读到 "1"）。在这个值下 Electron 只跑 Node、
# 没有窗口系统，`app.whenReady()` 会抛 undefined。
#
# 所以：**agent 在 DSH 会话里无法启动 GUI 版 Electron** —— 这是环境限制，
# 不是外壳坏了。这个脚本必须在**你自己的终端**里跑（不经过 DSH）。
#
# 用法：
#   bash tools/verify_shell.sh
#
# 它会：① 检查 ELECTRON_RUN_AS_NODE 是否干净 ② 启动应用 ③ 报告结果。

set -u

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

cd "$(dirname "$0")/.." || exit 1

echo "========================================================"
echo " Electron 外壳验证（E1 双击启动 / E2 离线可用）"
echo "========================================================"

# ---- 第 0 步：环境检查（这是最常见的失败原因）----------------
if [ -n "${ELECTRON_RUN_AS_NODE:-}" ]; then
  echo "${RED}✗ ELECTRON_RUN_AS_NODE 被设为 '$ELECTRON_RUN_AS_NODE'${RESET}"
  echo ""
  echo "  这个值下 Electron 不启动窗口系统，应用必然起不来。"
  echo "  它是 DSH Harness 注入的，在 DSH 会话里清不掉。"
  echo ""
  echo "  ${YELLOW}请在你自己的终端（不是 DSH）里运行本脚本。${RESET}"
  exit 1
fi
echo "${GREEN}✓${RESET} 环境干净（ELECTRON_RUN_AS_NODE 未设置）"

# ---- 第 1 步：依赖检查 --------------------------------------
if [ ! -x "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ] \
   && [ ! -x "node_modules/electron/dist/electron" ] \
   && [ ! -x "node_modules/electron/dist/electron.exe" ]; then
  echo "${RED}✗ 找不到 Electron 可执行文件${RESET}"
  echo "  先跑：pnpm install"
  exit 1
fi
echo "${GREEN}✓${RESET} Electron 二进制存在"

VER=$(cat node_modules/electron/dist/version 2>/dev/null || echo "?")
echo "${GREEN}✓${RESET} Electron 版本 $VER"

# ---- 第 2 步：离线可用的静态检查（不需要启动）----------------
echo ""
echo "--- 离线可用（E2）的静态检查 ---"

if grep -qE 'loadURL\s*\(\s*["'"'"'`]https?:' electron/main.js; then
  echo "${RED}✗ main.js 里有指向 http(s) 的 loadURL —— 离线可用会失败${RESET}"
  exit 1
fi
echo "${GREEN}✓${RESET} 用 loadFile 加载本地文件，无 http(s) 依赖"

if grep -rqE 'src="(https?:)?//' game/index.html; then
  echo "${RED}✗ index.html 有绝对 URL 引用${RESET}"
  exit 1
fi
echo "${GREEN}✓${RESET} index.html 的资源引用全是相对路径"

# ---- 第 3 步：真实启动 --------------------------------------
echo ""
echo "--- 启动应用（7 秒后自动关闭）---"
echo "    你应该看到游戏窗口出现。"

./node_modules/.bin/electron . &
PID=$!
sleep 7

if ps -p "$PID" > /dev/null 2>&1; then
  echo ""
  echo "${GREEN}========================================================"
  echo " ✅ 通过：应用启动并持续运行（E1）"
  echo "========================================================${RESET}"
  echo ""
  echo "  请再确认两件事："
  echo "   1. 窗口里就是游戏本身，不是空白或报错页"
  echo "   2. 拔掉网线后重跑本脚本，仍然能玩（E2）"
  kill "$PID" 2>/dev/null
  sleep 1
  kill -9 "$PID" 2>/dev/null
  exit 0
else
  echo ""
  echo "${RED}========================================================"
  echo " ✗ 失败：应用启动后退出"
  echo "========================================================${RESET}"
  exit 1
fi
