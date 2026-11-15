/*
 * 打击感四件套 —— 配置层测试（Task 26）。
 *
 * 为什么要有这个文件：
 * 「打击感」在代码里表现为三组数字（停顿帧长、火花数量、屏震强度），
 * 它们散落在渲染层里的话，调参就要改代码、就有改坏逻辑的风险。
 * 所以先把它们收进 config.js 的 FEEL 表，再让渲染层只读表。
 *
 * 这个文件只测**表本身**（存在性、取值范围、单调性），
 * 不测渲染 —— 渲染效果无法用桩测试证明，只能靠浏览器 smoke。
 *
 * 取值范围不是随手定的：
 *   - 停顿 > 130ms 会让割草游戏显得"粘滞"（连打时手感发木）
 *   - 停顿 = 0 等于没做，所以必须 > 0
 *   - 屏震 intensity 是 Phaser 的归一化值，> 0.02 在 960×540 上会晃出画面
 */
const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));

let passed = 0; const fails = [];
function ok(cond, label, detail) {
  if (cond) { passed += 1; return; }
  fails.push(label + (detail ? '  → ' + detail : ''));
}
function group(name, fn) { fn(); }

// ---------------------------------------------------------------- FEEL 表存在
group('FEEL 表存在', function () {
  ok(!!C.FEEL, 'config.js 导出 FEEL');
  const f = C.FEEL || {};
  ok(!!f.hitStop, 'FEEL.hitStop 存在');
  ok(!!f.spark, 'FEEL.spark 存在');
  ok(!!f.shake, 'FEEL.shake 存在');
});

// ---------------------------------------------------------------- 停顿
group('受击停顿 hitStop', function () {
  const h = (C.FEEL && C.FEEL.hitStop) || {};
  const per = h.perHit || [];

  ok(Array.isArray(per), 'hitStop.perHit 是数组');
  ok(per.length === C.COMBO.steps.length,
     'perHit 段数与 COMBO.steps 对齐',
     'perHit=' + per.length + ' steps=' + C.COMBO.steps.length);

  per.forEach(function (ms, i) {
    ok(ms > 0, '第 ' + (i + 1) + ' 段停顿 > 0（=0 等于没做）', String(ms));
    ok(ms <= 130, '第 ' + (i + 1) + ' 段停顿 <= 130ms（更大会发木）', String(ms));
  });

  // 第三段是重劈，停顿必须明显长于第一段 —— 否则三段打击感一样，
  // "连段越打越重"这件事在手感上就不成立。
  ok(per[2] > per[0], '第三段停顿 > 第一段（重劈要更沉）',
     per[2] + ' vs ' + per[0]);

  ok(h.killBonus > 0, '击杀额外停顿 > 0', String(h.killBonus));
  ok(h.max > 0 && h.max <= 200, 'hitStop.max 在 (0, 200]', String(h.max));
  // 上限必须真的能兜住最坏情况：否则连杀时每次叠加都会超过 max，上限形同虚设
  ok(h.max >= Math.max.apply(null, per), 'hitStop.max >= 单次最大停顿',
     h.max + ' vs ' + Math.max.apply(null, per));
  ok(h.max >= Math.max.apply(null, per) + h.killBonus,
     'hitStop.max >= 单次最大停顿 + 击杀奖励（否则连杀时上限会截断重劈）',
     h.max + ' vs ' + (Math.max.apply(null, per) + h.killBonus));
});

// ---------------------------------------------------------------- 火花
group('命中火花 spark', function () {
  const s = (C.FEEL && C.FEEL.spark) || {};
  const per = s.countPerHit || [];

  ok(Array.isArray(per), 'spark.countPerHit 是数组');
  ok(per.length === C.COMBO.steps.length, 'countPerHit 段数与 COMBO.steps 对齐');
  per.forEach(function (n, i) {
    ok(n > 0, '第 ' + (i + 1) + ' 段火花数 > 0', String(n));
    ok(n <= 24, '第 ' + (i + 1) + ' 段火花数 <= 24（再多会糊成一团）', String(n));
  });
  ok(per[2] > per[0], '第三段火花多于第一段', per[2] + ' vs ' + per[0]);

  ok(s.killBurst >= per[2], '击杀爆发 >= 第三段命中（击杀要更炸）',
     s.killBurst + ' vs ' + per[2]);

  ok(typeof s.spread === 'number' && s.spread > 0 && s.spread < Math.PI,
     'spark.spread 在 (0, π)：定向扇形，不是全向爆炸', String(s.spread));

  ok(s.lifeMin > 0 && s.lifeMax > s.lifeMin, 'spark 寿命区间合法',
     s.lifeMin + '..' + s.lifeMax);

  ok(s.speedMin > 0 && s.speedMax > s.speedMin, 'spark 速度区间合法',
     s.speedMin + '..' + s.speedMax);
});

// ---------------------------------------------------------------- 屏震
group('屏震 shake', function () {
  const s = (C.FEEL && C.FEEL.shake) || {};
  const d = s.duration || []; const it = s.intensity || [];

  ok(Array.isArray(d) && d.length === C.COMBO.steps.length, 'shake.duration 段数对齐');
  ok(Array.isArray(it) && it.length === C.COMBO.steps.length, 'shake.intensity 段数对齐');

  // 前两段不震 —— 这是设计决定，不是遗漏。每一刀都震会让人晕，
  // 而且会让 slam/nova 这两个真正的"重技能"失去对比。
  ok(d[0] === 0 && d[1] === 0, '第 1、2 段不震屏（震多了会晕）',
     JSON.stringify(d));
  ok(it[0] === 0 && it[1] === 0, '第 1、2 段强度为 0', JSON.stringify(it));

  ok(d[2] > 0, '第三段震屏', String(d[2]));
  ok(it[2] > 0, '第三段强度 > 0', String(it[2]));
  // 上界：Phaser 的归一化强度，超过 0.02 在 960 宽画布上会明显晃出画面
  ok(it[2] <= 0.02, '第三段强度 <= 0.02（更大就晃出画面了）', String(it[2]));

  ok(s.kill > 0 && s.killIntensity > 0, '击杀震屏已定义');

  // 普攻必须明显轻于技能，否则技能失去重量感。
  // slam=0.010 / nova=0.016 是既有的技能强度（app.js 里硬编码）。
  ok(it[2] < 0.010, '普攻第三段必须轻于 slam(0.010) —— 技能要更重',
     it[2] + ' vs 0.010');

  ok(s.max > 0 && s.max <= 0.05, 'shake.max 在 (0, 0.05]', String(s.max));
});

// ---------------------------------------------------------------- 不变式
group('不破坏既有约定', function () {
  // FEEL 是纯新增表，不能悄悄改掉战斗数值
  ok(C.COMBO.steps.length === 3, 'COMBO.steps 仍是三段');
  ok(C.ATTACK_DEPTH === 55, 'ATTACK_DEPTH 未被这次改动波及');
  ok(C.INVULN_AFTER_HIT === 0.8, 'INVULN_AFTER_HIT 未变');
  ok(Object.keys(C.AUDIO.sfx).length === 21, '音效仍是 21 个（本次不碰音频）');
});

console.log('\n  test_feel.js');
console.log('  通过 ' + passed + ' 条');
if (fails.length) {
  console.log('  失败 ' + fails.length + ' 条：');
  fails.forEach(function (f) { console.log('    ✗ ' + f); });
  process.exit(1);
}
console.log('  全部通过 ✓\n');
