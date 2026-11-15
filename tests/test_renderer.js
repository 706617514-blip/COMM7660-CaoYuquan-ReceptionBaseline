/**
 * test_renderer.js — 渲染器必须显式是 WEBGL（Task 2 的守卫）。
 *
 * 为什么需要一条测试盯着这个
 * --------------------------
 * 彩蛋的"全屏泛光"只有 WebGL 能做。如果哪天有人把 `type: Phaser.WEBGL`
 * 改回 `Phaser.AUTO` 或 `Phaser.CANVAS`，**不会报错、不会崩、测试也不会红** ——
 * 泛光会静默失效，只有当玩家真的打到彩蛋那一刻才发现。
 *
 * 这正是"静默退化"，必须用测试钉住。
 *
 * 关于 AUTO 的一个实测事实（2026-11-15）
 * -------------------------------------
 * 在支持 WebGL 的机器上 `AUTO` 实际选的就是 WebGL，所以**在本机无法用截图
 * 区分 AUTO 与 WEBGL**。差异只在"不支持 WebGL 的机器上会不会静默回退到
 * Canvas" —— 那种机器上 AUTO 的泛光会失效而 WEBGL 会直接报错。
 * 显式写 WEBGL 的收益是：**失败变成可见的，而不是静默降级**。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let count = 0;

function ok(cond, label) {
  count += 1;
  assert.ok(cond, label);
  console.log('  PASS  ' + label);
}

console.log('========================================================');
console.log('渲染器配置');
console.log('========================================================');

const appJs = fs.readFileSync(path.join(ROOT, 'game', 'app.js'), 'utf8');

// 只找 new Phaser.Game({...}) 里的 type 字段，避免匹配到注释里的示例。
const m = appJs.match(/new Phaser\.Game\(\{[\s\S]*?type:\s*(Phaser\.\w+)/);
ok(!!m, '找得到 Phaser.Game 的渲染器配置');
ok(m && m[1] === 'Phaser.WEBGL',
   '渲染器显式是 Phaser.WEBGL（不能用 AUTO —— 泛光会静默失效）');

// 反向断言：不能是 AUTO 或 CANVAS。
ok(m && m[1] !== 'Phaser.AUTO',
   '不是 Phaser.AUTO（AUTO 在不支持 WebGL 的机器上会静默回退）');
ok(m && m[1] !== 'Phaser.CANVAS',
   '不是 Phaser.CANVAS（Canvas 做不出加法泛光）');

/*
 * BlendModes.ADD 是切 WebGL 时的真实风险点（WebGL 受预乘 alpha 影响）。
 *
 * 数量沿革：
 *   8 处  Task 2 切换时实测核对（商店三色药水光 / 兵器架宝石光 /
 *         祭坛符文光 / 田地暖光）—— 这是**既有发光效果**，已逐一目视通过。
 *   11 处 Task 3.2 新增 3 处，全在彩蛋里（发现阶段的七彩光晕 1 处 +
 *         光爆的核心与光环 2 处）。它们**尚未经 PM 目视** —— 见下。
 *
 * 这里钉住数量，防"顺手删掉一个发光效果"这种悄悄退化。
 * 数量变化时**必须重新目视**，所以断言失败信息里写清该看什么。
 *
 * 必须剥注释再数 —— 代码里就有解释这件事的注释本身含 "BlendModes.ADD"
 * 字样，裸数会多数一个（踩到过）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const addCount = (stripComments(appJs).match(/BlendModes\.ADD/g) || []).length;
ok(addCount === 11,
   'BlendModes.ADD 共 11 处（8 既有 + 3 彩蛋）；变化需重新目视');

console.log('========================================================');
console.log('全部通过：' + count + ' 项断言');
