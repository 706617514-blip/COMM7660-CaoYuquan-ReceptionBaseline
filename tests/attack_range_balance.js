#!/usr/bin/env node
/**
 * attack_range_balance.js — V18（攻击范围 +5%）的前后对照读数。
 *
 * 为什么需要这个脚本
 * ------------------
 * V18 改的是**战斗数值**，它必然抬高胜率；判断「抬得对不对」只能靠同口径对照。
 * 但改动已经落进 `game/config.js`，之后任何人跑 `tests/balance_report.js` 拿到的
 * 都只是「改后」那一半 —— 改前的那一半会变成"报告里写了、仓库里算不出"的数字，
 * 而这正是 `tests/balance_report.js` 当初被造出来修掉的那个毛病。
 *
 * 所以本脚本把改前的数值（`OLD`）写死成常量，运行时临时把 `game/config.js`
 * 的四个战斗参数换回旧值再跑一遍，跑完换回来。它不修改任何文件。
 *
 * 用法：
 *   node tests/attack_range_balance.js            # 每格 n=100 × 4 步长 = 400 局
 *   node tests/attack_range_balance.js 40 4       # 与 balance_report.js 默认口径对齐
 *   node tests/attack_range_balance.js 20 1       # 用户基线那张表的口径（噪声很大，慎用）
 *
 * 判据（用户定稿启发式，不是 PM 批准的验收标准）：任一档上升超过 8 个百分点
 * 要**报上来**，不是自动失败 —— 脚本打印告警行并以 0 退出。
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
const B = require(path.join(__dirname, 'bot.js'));

const N = Math.max(5, parseInt(process.argv[2], 10) || 100);
const STRIDES = Math.max(1, parseInt(process.argv[3], 10) || 4);
const STRIDE_SET = [137, 211, 977, 1231, 1777, 2011].slice(0, STRIDES);

// V18 之前的定稿值（`game/config.js` 的 61/66/78、66/55/15 由它 ×1.05 得出）。
// 2026-11-13：Boss 近战够不到（三段射程都短于贴身间距 69px），
// 三段又整体 +12（61/66/78 -> 73/78/90）；下面的 NEW 跟着更新。
// OLD 保持不动 —— 它代表「用户定稿 V18 之前」的口径。
const OLD = { steps: [58, 62, 74], range: 62, depth: 52, back: 14 };
const NEW = { steps: [73, 78, 90], range: 78, depth: 55, back: 15 };

const LEVELS = [['零强化', B.ZERO_UP], ['半满', B.HALF_UP], ['全满', B.FULL_UP]];
const FLAG_PP = 8;   // 上升超过这个百分点数就要上报（用户定稿的启发式门槛）

function apply(v) {
  C.COMBO.steps.forEach(function (st, i) { st.range = v.steps[i]; });
  C.ATTACK_RANGE = v.range;
  C.ATTACK_DEPTH = v.depth;
  C.ATTACK_BACK = v.back;
}

function table() {
  const t = {};
  LEVELS.forEach(function (pair) {
    C.DIFFICULTIES.forEach(function (d) {
      const rs = STRIDE_SET.map(function (s) { return B.winRate(d.id, pair[1], N, s).rate; });
      t[pair[0] + ':' + d.id] = rs.reduce(function (a, b) { return a + b; }, 0) / rs.length * 100;
    });
  });
  return t;
}

// 难度 id 回显：`C.difficultyById()` 找不到时**静默回退成林地**
// （`config.js` 里 `DIFFICULTIES.find(...) || DIFFICULTIES[1]`），
// 传错一个字（例如 "hard"）就会让四档打印出一模一样的数字，看着像引擎 bug。
console.log('难度 id 回显: ' + C.DIFFICULTIES.map(function (d) { return d.id; }).join(' / '));
console.log('每格 n=' + N + (STRIDES > 1 ? ' × ' + STRIDES + ' 个步长' : '') +
            '（' + (N * STRIDES) + ' 局）；单位 %');

apply(OLD); const before = table();
apply(NEW); const after = table();

const ids = C.DIFFICULTIES.map(function (d) { return d.id; });
const flagged = [];

LEVELS.forEach(function (pair) {
  const name = pair[0];
  const fmt = function (t) {
    return ids.map(function (id) { return t[name + ':' + id].toFixed(1).padStart(5); }).join('');
  };
  const diffs = ids.map(function (id) { return after[name + ':' + id] - before[name + ':' + id]; });
  console.log();
  console.log(name.padEnd(4) + '改前' + fmt(before));
  console.log('    改后' + fmt(after));
  console.log('    差值' + diffs.map(function (d) {
    return ((d >= 0 ? '+' : '') + d.toFixed(1)).padStart(5);
  }).join(''));
  diffs.forEach(function (d, i) {
    if (d > FLAG_PP) flagged.push(name + '×' + C.difficultyById(ids[i]).name + ' +' + d.toFixed(1) + 'pp');
  });
});

console.log();
console.log(flagged.length
  ? '⚠ 上升超过 ' + FLAG_PP + 'pp 的格子: ' + flagged.join('、')
    + '（用户定稿的启发式：要如实上报，不等于必须回滚）'
  : '没有格子上升超过 ' + FLAG_PP + 'pp');
