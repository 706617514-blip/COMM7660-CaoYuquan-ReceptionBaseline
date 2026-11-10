#!/usr/bin/env node
/**
 * balance_report.js — 打印难度曲线。**这是唯一应当被引用的平衡数字来源。**
 *
 * 为什么需要它
 * ------------
 * 之前向用户/报告提供的胜率（零强化 100/95/40/5）与测试里那个 bot 实际跑出来的
 * （100/93/68/8）不一致，而仓库里没有任何脚本能复现那组数字 —— 等于报了一个
 * 无法核实的结论。现在所有平衡数字都必须由本脚本生成。
 *
 * 用法：
 *   node tests/balance_report.js            # 默认 n=40，单一步长
 *   node tests/balance_report.js 60 3       # n=60，跨 3 个步长取平均（更稳）
 *
 * 注意 bot 是**下限代理**：它能稳过的档位人类也能过；它过不了的档位人类仍可能靠操作赢。
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
const B = require(path.join(__dirname, 'bot.js'));

// 默认 n=40 且跨 4 个种子步长。
// 单步长 n=20 时，密林会随机给出 0%~80% 的胜率 —— 那不是回归，是小样本噪声。
// 一个会随运气跳动的平衡报告比没有报告更糟：它会让人去调根本没变的东西。
const N = Math.max(20, parseInt(process.argv[2], 10) || 40);
const STRIDES = Math.max(1, parseInt(process.argv[3], 10) || 4);
const STRIDE_SET = [137, 211, 977, 1231, 1777, 2011].slice(0, STRIDES);

const LEVELS = [
  ['零强化', B.ZERO_UP],
  ['半满', B.HALF_UP],
  ['全满', B.FULL_UP],
];

function rate(diffId, up) {
  const rs = STRIDE_SET.map((s) => B.winRate(diffId, up, N, s).rate);
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

console.log('熔野耕作 · 难度曲线报告');
console.log(`  每格 n=${N}${STRIDES > 1 ? ` × ${STRIDES} 个种子步长` : ''}；代理 = tests/bot.js`);
console.log();

const header = ['强化水平'].concat(C.DIFFICULTIES.map((d) => d.name));
console.log(header.map((h) => h.padEnd(9)).join(''));
console.log('-'.repeat(9 * header.length));

const table = {};
LEVELS.forEach(([name, up]) => {
  const cells = C.DIFFICULTIES.map((d) => {
    const r = rate(d.id, up);
    table[name + ':' + d.id] = r;
    return (r * 100).toFixed(0) + '%';
  });
  console.log([name].concat(cells).map((c) => c.padEnd(9)).join(''));
});

console.log();
const zero = C.DIFFICULTIES.map((d) => table['零强化:' + d.id]);
const monotone = zero.every((v, i) => i === 0 || v <= zero[i - 1] + 0.02);
console.log('零强化阶梯: ' + zero.map((v) => (v * 100).toFixed(0) + '%').join(' > ')
            + '  → ' + (monotone ? '单调递减 ✓' : '非单调 ✗'));
console.log('  注：单档 ±8 个百分点内的差异在噪声范围内，不要据此调参。');
console.log('战利品倍率: '
  + C.DIFFICULTIES.map((d) => d.name + ' ×' + d.lootMul).join(' · '));
console.log();

// 档位参数一览，便于核对文档里的描述是否与代码一致
console.log('档位参数:');
C.DIFFICULTIES.forEach((d) => {
  console.log(`  ${d.name.padEnd(4)} hp×${d.hpMul} dmg×${d.dmgMul} 速度×${d.speedMul} `
              + `${d.waves} 波 每波起 ${d.baseCount} 只 战利品×${d.lootMul}`);
});

process.exit(monotone ? 0 : 1);
