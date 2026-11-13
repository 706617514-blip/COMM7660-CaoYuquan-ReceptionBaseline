/**
 * test_bosspose.js — Boss 姿态纯函数（game/bosspose.js）的测试。
 *
 * 为什么要单独把姿态抽出来测
 * --------------------------
 * Boss 一直只做 setPosition：位置变了、图没变，观感就是"一张贴图在平移"。
 * 修法是在 PNG 躯干上程序化画两条分节藤蔓手臂（设计文档 §3.1），
 * 而"手臂该抬多高、走路起伏多大、哪一帧踩下"这些**如果错了只能靠肉眼看截图发现**。
 * 截图一天只能看几张，所以把姿态计算做成纯函数，在这里钉死。
 *
 * 这里钉的不是"函数不报错"，是那些如果坏了玩家立刻看得出来的事实：
 *   - 蓄力抬手必须真的比走路高（否则"抬手"看不出）
 *   - 下砸必须比走路还低（砸下去要有落差）
 *   - 走路起伏必须比站着大，且站 3 秒一次踩下都不许有（否则站着也在抖）
 *   - 走 2 秒踩下的次数有限（每帧都踩 = 脚下扬尘爆炸）
 *   - 位移 0 是 idle、位移大才是 walk（判据边界 0.5 是 `>` 不是 `>=`）
 *   - segments() 返回 6 节、swing=0 时是一条直线
 *   - 同输入两次 → 同输出（纯函数；带 Math.random 或写全局状态的实现过不了）
 *
 * 用法: node tests/test_bosspose.js
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
// 模块可能还不存在（红阶段就是这样）：不在这里直接 require 崩掉，
// 否则只有一段 stack trace、一条断言都看不到。降级成空对象，让每段自己红。
let P = {};
let loadErr = null;
try { P = require(path.join(__dirname, '..', 'game', 'bosspose.js')); }
catch (e) { loadErr = e; }
if (loadErr) console.log('  [红] game/bosspose.js 加载失败：' + loadErr.message.split('\n')[0]);

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else {
    fail++; failures.push(label);
    console.log(`  FAIL  ${label}` + (detail !== undefined ? `  -> ${detail}` : ''));
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function near(actual, expected, tol, label) {
  ok(Math.abs(actual - expected) <= tol, label, `got ${actual}, want ${expected}±${tol}`);
}
function section(t) { console.log(`\n=== ${t} ===`); }

// 段内抛异常（API 还没实现时 compute 不存在）记一次失败并继续，
// 不让整个套件崩掉，把后面所有断言藏起来 —— 红阶段要看得到"哪几条红"。
function group(label, fn) {
  try { fn(); }
  catch (e) { ok(false, label + '（段落抛异常）', e.message); }
}

const DT = 1 / 60;
const TAU = Math.PI * 2;

function inp(o) {
  return Object.assign({
    dx: 0, dz: 0, casting: null, facing: 1, phase: 0, dt: DT, time: 0,
  }, o || {});
}
function pose(o) { return P.compute(inp(o)); }

// 逐帧跑一段：调用方给每帧的额外输入（位移 / 施法），相位按上一帧回传。
// 返回每帧的 pose 数组 —— 这是"时间是推进的"那类断言（踩下次数、起伏幅度）唯一的测法：
// 单帧 compute 看不到周期性，只有连续跑才能数出 footfall。
function runFrames(seconds, each) {
  const n = Math.round(seconds / DT);
  const out = [];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const extra = (each ? each(i) : {}) || {};
    const p = P.compute(inp(Object.assign({
      phase: phase, dt: DT, time: i * DT * 1000,
    }, extra)));
    phase = p.phase;
    out.push(p);
  }
  return out;
}
function countFootfalls(frames) {
  return frames.reduce((n, p) => n + (p.footfall ? 1 : 0), 0);
}

// ---------------------------------------------------------------- 1. 状态判据
section('1. 状态判据（设计文档 §3.1）');
group('状态判据', () => {
  group('idle', () => {
    eq(pose({}).state, 'idle', '不动、不施法 → idle');
    eq(pose({ dx: 0.2, dz: 0.1 }).state, 'idle',
      '|dx|+|dz| = 0.3 < 0.5 → idle（阈值边界）');
    eq(pose({ dx: 0.5 }).state, 'idle',
      '恰好 0.5 是 idle（判据是 > 0.5，不是 >=）');
    eq(pose({ dx: 0.25, dz: 0.25 }).state, 'idle',
      '两轴各 0.25，和正好 0.5 → idle');
  });

  group('walk', () => {
    eq(pose({ dx: 3 }).state, 'walk', 'dx=3 → walk');
    eq(pose({ dx: -3 }).state, 'walk', '向左走（负位移）也是 walk');
    eq(pose({ dz: 0.9 }).state, 'walk', '只有深度轴位移也算走');
    eq(pose({ dx: 0.5000001 }).state, 'walk',
      '刚过 0.5 → walk（证明边界是 > 而不是 >=）');
    eq(pose({ dx: 1.2, dz: -0.8 }).state, 'walk', '斜着走也是 walk');
  });

  group('windup / strike', () => {
    eq(pose({ casting: { timer: 0.8, windup: 1.0 } }).state, 'windup',
      'timer/windup = 0.8 > 0.35 → windup');
    eq(pose({ casting: { timer: 0.2, windup: 1.0 } }).state, 'strike',
      'timer/windup = 0.2 <= 0.35 → strike');
    eq(pose({ casting: { timer: 0.35, windup: 1.0 } }).state, 'strike',
      '边界 0.35 属于 strike（<=）');
    eq(pose({ casting: { timer: 0.3500001, windup: 1.0 } }).state, 'windup',
      '0.3500001 → windup（证明是 > 不是 >=）');
    eq(pose({ casting: { timer: 0.3, windup: 0.55 } }).state, 'windup',
      '按各自的 windup 归一：0.3/0.55 = 0.55（slam 的前摇）');
    eq(pose({ casting: { timer: 0.3, windup: 1.40 } }).state, 'strike',
      '同样是 0.3 秒，枯萎领域 1.4 秒前摇已进入后半段 → strike');
    eq(pose({ dx: 5, casting: { timer: 0.9, windup: 1.0 } }).state, 'windup',
      '施法中位移再大也不许判成 walk（判据顺序：casting 优先）');
  });
});

// ---------------------------------------------------------------- 2. 抬手不变量
section('2. 抬手（不变量 1、2、7）');
group('抬手', () => {
  const idle = pose({});
  const walk = pose({ dx: 3 });
  // windup 的判据是 timer/windup > 0.35，所以 timer 必须 > 0.35 才是"抬手"；
  // charge 单独给（派生值最多 0.65，够不到设计表里 0.95 那一端）。
  const wu = pose({ casting: { timer: 0.5, windup: 1.0 }, charge: 0.9 });
  const st = pose({ casting: { timer: 0.1, windup: 1.0 } });

  ok(wu.armRaise > walk.armRaise, '不变量1：蓄力抬手(0.9) 比走路高',
    `windup=${wu.armRaise}, walk=${walk.armRaise}`);
  ok(st.armRaise < walk.armRaise, '不变量2：下砸比走路还低',
    `strike=${st.armRaise}, walk=${walk.armRaise}`);
  ok(st.armRaise < wu.armRaise, '下砸比蓄力低得多（落差能被看出来）',
    `strike=${st.armRaise}, windup=${wu.armRaise}`);
  ok(walk.armSwing > idle.armSwing, '不变量7：走路手臂摆动 > 站着',
    `walk=${walk.armSwing}, idle=${idle.armSwing}`);

  near(wu.armRaise, 0.935, 0.02, '蓄力到 0.9 时 armRaise ≈0.935（0.80→0.95）');
  ok(pose({ casting: { timer: 0.9, windup: 1.0 } }).armRaise < wu.armRaise,
    '蓄力越深抬得越高（charge 0.1 < 0.9）');
  ok(pose({ casting: { timer: 0.9, windup: 1.0 } }).armRaise >= 0.78,
    '刚开始蓄力就已经抬起来了（>=0.78），不是从下垂慢慢抬');
  near(idle.armRaise, 0.08, 0.03, '站着 armRaise ≈0.08（自然下垂）');
  near(st.armRaise, 0.02, 0.03, '下砸 armRaise ≈0.02（几乎是砸到最低）');

  // armRaise 是 0..1 的比例，越界会让手臂翻到身体另一侧
  ['idle', 'walk', 'windup', 'strike'].forEach((k) => {
    const list = runFrames(1.2, () => {
      if (k === 'walk') return { dx: 3 };
      if (k === 'windup') return { casting: { timer: 0.9, windup: 1.0 } };
      if (k === 'strike') return { casting: { timer: 0.1, windup: 1.0 } };
      return {};
    });
    ok(list.every((p) => p.armRaise >= 0 && p.armRaise <= 1),
      `${k}：armRaise 全程在 0..1`);
  });

  ok(idle.armSwing <= 0.1 && wu.armSwing <= 0.1 && st.armSwing <= 0.1,
    '站着/蓄力/下砸时手臂几乎不摆（armSwing <= 0.1）',
    `idle=${idle.armSwing}, windup=${wu.armSwing}, strike=${st.armSwing}`);
});

// ---------------------------------------------------------------- 3. 起伏 / 踩下
section('3. 走路起伏与踩下（不变量 3、5、6）');
group('起伏与踩下', () => {
  const idleF = runFrames(2.0, () => ({}));
  const walkF = runFrames(2.0, () => ({ dx: 3 }));
  const maxIdleBob = Math.max.apply(null, idleF.map((p) => Math.abs(p.bob)));
  const maxWalkBob = Math.max.apply(null, walkF.map((p) => Math.abs(p.bob)));

  ok(maxWalkBob > maxIdleBob, '不变量3：走路起伏最大值 > 站着',
    `walk=${maxWalkBob.toFixed(3)}, idle=${maxIdleBob.toFixed(3)}`);
  ok(maxWalkBob <= 3.001, '走路起伏不超过 3 个贴图像素（再大就跳起来了）', maxWalkBob);
  ok(maxIdleBob <= 2.001, '站着起伏不超过 2 个贴图像素（呼吸，不是发抖）', maxIdleBob);

  eq(countFootfalls(runFrames(3.0, () => ({}))), 0, '不变量5：站 3 秒，踩下 0 次');

  const walk2s = countFootfalls(walkF);
  ok(walk2s >= 2 && walk2s <= 6, '不变量6：走 2 秒踩下 2~6 次（不是每帧一次）', walk2s);
  ok(countFootfalls(runFrames(2.0, () => ({ dx: 3, dz: 1 }))) >= 2,
    '斜着走也有踩下（不是只在 x 轴上数）');

  const wuF = runFrames(1.0, () => ({ casting: { timer: 0.95, windup: 1.0 } }));
  eq(countFootfalls(wuF), 0, '蓄力期间踩下 0 次（脚是钉在地上的）');

  // 下砸：整个前摇跑完，footfall 只许出现一次（落手那帧）
  let timer = 1.0;
  const strikeFrames = [];
  let phase = 0;
  for (let i = 0; i < 70 && timer > 0; i++) {
    const p = P.compute(inp({ casting: { timer: timer, windup: 1.0 }, phase: phase }));
    phase = p.phase;
    strikeFrames.push(p);
    timer = Math.max(0, timer - DT);
  }
  const strikeHit = strikeFrames.filter((p) => p.state === 'strike');
  ok(strikeHit.length > 5, '前摇后半段确实是 strike（不止一帧）', strikeHit.length);
  eq(countFootfalls(strikeFrames), 1, '下砸全程 footfall 恰好 1 次（落手那帧）');
  ok(strikeHit[0] && strikeHit[0].footfall === true,
    'footfall 出现在刚进入 strike 的那一帧（落手瞬间有扬尘）');

  const bobStrike = strikeHit.every((p) => p.bob >= 0);
  ok(bobStrike, '下砸时 bob 向下（>=0），不是往上飘');
  const sqStrike = strikeHit.every((p) => p.squash > 1);
  ok(sqStrike, '下砸时 squash > 1（拉长）');

  const walkSq = walkF.map((p) => p.squash);
  ok(Math.min.apply(null, walkSq) <= 0.965, '踩下瞬间压扁到 0.96 一带', Math.min.apply(null, walkSq));
  ok(Math.max.apply(null, walkSq) >= 1.0, '抬起时回升（squash >= 1）', Math.max.apply(null, walkSq));

  // charge 由调用方直接给：windup 判据是 timer/windup > 0.35，派生 charge 最多到 0.65，
  // 只有显式传 0.95 才测得到"蓄满"那一端（设计表里的 1 − charge×0.10）。
  const wuSq = pose({ casting: { timer: 0.5, windup: 1.0 }, charge: 0.95 }).squash;
  near(wuSq, 0.905, 0.006, '蓄满 squash ≈0.90（1 − charge×0.10）');
});

// ---------------------------------------------------------------- 4. 倾角
section('4. 倾角跟随朝向（不变量 4）');
group('倾角', () => {
  const walkR = runFrames(1.0, () => ({ dx: 3, facing: 1 }));
  const walkL = runFrames(1.0, () => ({ dx: -3, facing: -1 }));
  ok(walkR.every((p) => p.lean > 0), '向右走 lean > 0');
  ok(walkL.every((p) => p.lean < 0), '向左走 lean < 0');
  ok(walkR.every((p) => p.lean <= 0.021), '走路倾角不超过 0.02 弧度', Math.max.apply(null, walkR.map((p) => p.lean)));

  // 后仰量按 charge 缩放；timer=0.5 让状态是 windup（>0.35），charge 显式给满。
  const wuR = pose({ casting: { timer: 0.5, windup: 1.0 }, charge: 1.0, facing: 1 });
  const wuL = pose({ casting: { timer: 0.5, windup: 1.0 }, charge: 1.0, facing: -1 });
  ok(wuR.lean < 0 && wuL.lean > 0, '蓄力是后仰（与 facing 反向）',
    `right=${wuR.lean}, left=${wuL.lean}`);
  near(Math.abs(wuR.lean), 0.045, 0.001, '蓄满后仰 = 0.045 弧度');

  const stR = runFrames(0.05, () => ({ casting: { timer: 0.1, windup: 1.0 }, facing: 1 }))[0];
  const stL = runFrames(0.05, () => ({ casting: { timer: 0.1, windup: 1.0 }, facing: -1 }))[0];
  ok(stR.lean > 0 && stL.lean < 0, '下砸是前倾（跟 facing 同向）',
    `right=${stR.lean}, left=${stL.lean}`);

  eq(pose({}).lean, 0, '站着不倾');
});

// ---------------------------------------------------------------- 5. 相位推进
section('5. 相位与步态');
group('相位', () => {
  const p0 = pose({ dx: 3, phase: 0 });
  ok(p0.phase > 0, 'dt > 0 时相位前进');
  eq(pose({ dx: 3, phase: 0, dt: 0 }).phase, 0, 'dt = 0 时相位不动（暂停不能跳步）');
  const p1 = pose({ dx: 3, phase: p0.phase });
  ok(p1.phase > p0.phase, '相位单调递增');

  const walkF = runFrames(1.0, () => ({ dx: 3 }));
  ok(walkF.every((p) => p.stepPhase >= 0 && p.stepPhase < 1),
    'stepPhase 在 0..1');
  const steps = walkF.map((p) => p.stepPhase);
  ok(Math.max.apply(null, steps) - Math.min.apply(null, steps) > 0.5,
    '1 秒内 stepPhase 走过半圈以上（真的在迈步）',
    (Math.max.apply(null, steps) - Math.min.apply(null, steps)).toFixed(3));

  // time 只影响站着的呼吸，不该影响手臂推动的相位
  const a = pose({ phase: 0.7, time: 0 });
  const b = pose({ phase: 0.7, time: 5000 });
  eq(a.phase, b.phase, '同一相位下 time 不影响相位推进');
});

// ---------------------------------------------------------------- 6. segments()
section('6. segments()');
group('segments', () => {
  const seg = P.segments;
  eq(typeof seg, 'function', 'segments 是函数');

  const s6 = seg(1, 0, 0);
  eq(s6.length, 6, '默认 6 节');
  ok(Array.isArray(s6), '返回数组');
  ok(s6.every((v) => typeof v === 'number' && isFinite(v)), '每节都是有限数');

  const flat = seg(0.7, 0, 1.3);
  ok(flat.every((v) => Math.abs(v - 0.7) < 1e-12), 'swing=0 时每节都等于 baseAngle', JSON.stringify(flat));

  const waved = seg(0.5, 0.3, 0.9);
  ok(waved.some((v, i) => i > 0 && Math.abs(v - waved[0]) > 1e-6),
    'swing>0 时逐节不同（否则就是一根直线）', JSON.stringify(waved));
  let formulaOK = true;
  for (let i = 0; i < 6; i++) {
    const want = 0.5 + Math.sin(0.9 + i * 0.6) * 0.3;
    if (Math.abs(waved[i] - want) > 1e-12) formulaOK = false;
  }
  ok(formulaOK, '每节 = baseAngle + sin(armPhase + i*0.6) * swing', JSON.stringify(waved));

  eq(seg(0, 0.2, 0, 3).length, 3, 'count=3 时返回 3 节');
  eq(seg(0, 0.2, 0, 1).length, 1, 'count=1 时返回 1 节');
  ok(seg(0, 0.2, 0, 0).length >= 1, 'count=0 退化时至少 1 节（不返回空数组让画手消失）');
  ok(seg(0, 0.2, 0, undefined).length === 6, 'count 缺省是 6');

  const d1 = seg(0, 0.25, 0.2);
  const d2 = seg(0, 0.25, 0.2 + Math.PI);
  ok(d1.some((v, i) => Math.abs(v - d2[i]) > 1e-6), 'armPhase 不同时姿态不同（左右手反相能画出来）');
});

// ---------------------------------------------------------------- 7. 纯函数
section('7. 纯函数（不变量 9）');
group('纯函数', () => {
  const args = inp({ dx: 1.4, dz: -0.6, casting: null, facing: -1, phase: 1.1, time: 12345 });
  const snapshot = JSON.stringify(args);
  const a = P.compute(args);
  const b = P.compute(args);
  eq(JSON.stringify(a), JSON.stringify(b), '同输入两次调用结果完全相同');
  eq(JSON.stringify(args), snapshot, 'compute 不改调用方传进来的对象');
  eq(Object.keys(a).sort().join(','),
    ['state', 'phase', 'bob', 'squash', 'lean', 'armRaise', 'armSwing', 'armPhase', 'footfall', 'stepPhase'].sort().join(','),
    'pose 字段齐全（少了哪个 app.js 就画不出来）');
  ok(['idle', 'walk', 'windup', 'strike'].includes(a.state), 'state 只会是这四种之一', a.state);

  const c = P.compute({ dx: 1.4, dz: -0.6 });   // 缺字段不该抛
  ok(c.state === 'walk', '缺 phase/time/dt 时给默认值而不是抛异常', c.state);
});

// ---------------------------------------------------------------- 8. 配置
section('8. 配置（手臂尺寸来自 config，不是散在代码里）');
group('配置', () => {
  const B = C.BOSS;
  eq(Array.isArray(B.armSegRatio), true, 'BOSS.armSegRatio 是数组');
  eq(B.armSegRatio.length, 6, '六节长度比');
  near(B.armSegRatio[0], 1.0, 1e-9, '第 1 节比例 1.0');
  near(B.armSegRatio[5], 0.46, 1e-9, '第 6 节比例 0.46');
  const sum = B.armSegRatio.reduce((x, y) => x + y, 0);
  near(sum * B.armBaseLen, 0.36, 0.01, '六节累加 ≈0.36 × 贴图高（再长就垂到脚底以下）');
  near(B.armAnchorY, 0.42, 1e-9, '锚点 y = 0.42（量出来的肩部，不是腰）');
  near(B.armAnchorX, 0.36, 1e-9, '锚点 x = ±0.36（轮廓内部）');
  ok(B.armWidthRoot > B.armWidthTip, '根部比尖端粗', `${B.armWidthRoot} vs ${B.armWidthTip}`);
  ok(B.armColorRoot > B.armColorTip, '颜色从根部到尖端变暗（数值变小）',
    `0x${B.armColorRoot.toString(16)} -> 0x${B.armColorTip.toString(16)}`);
  // 手臂必须比本体亮：本体主要色域实测 0x4a4038（任务书 §2）
  ['armColorRoot', 'armColorTip'].forEach((k) => {
    const v = B[k];
    const lum = ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114;
    const bodyLum = 0x4a * 0.299 + 0x40 * 0.587 + 0x38 * 0.114;
    // 实测亮度：本体 66.1 / 根部 0x7a6a55 = 104.6 / 尖端 0x5c4c3e = 79.2。
    // 尖端只比本体亮 13.1（任务书给的就是这个色，不能再亮 —— 再亮就和根部脱节），
    // 所以门槛定 +10：它抓得住"直接拿本体色画手臂"这种错误实现（差 0），
    // 又不会把任务书指定的色值判红。
    ok(lum > bodyLum + 10, `${k} 比本体(0x4a4038)亮（否则在深色藤蔓上看不见）`,
      `${lum.toFixed(1)} vs ${bodyLum.toFixed(1)}`);
  });
  ok(B.stepPeriod > 0.3 && B.stepPeriod < 1.2, '步态周期在读得出来的范围内（0.3~1.2s）', B.stepPeriod);
  near(B.poseRefFrame, 1 / 30, 1e-9, 'poseRefFrame = 1/30 秒（帧率归一的参考帧）');
});

// ---------------------------------------------------------------- 9. 帧率归一
section('9. refMove()：把本帧位移折算到参考帧');
group('refMove', () => {
  ok(typeof P.refMove === 'function', 'refMove 是函数（app.js 用它折算位移）');
  if (typeof P.refMove !== 'function') return;

  // 实测：Boss speed=26 u/s。60fps 下每帧水平只走 26/60 = 0.433 ——
  // 直接喂给 compute 是 idle（0.433 < 0.5），也就是说任务书 §3 的判据
  // 按原始每帧位移用时，Boss 在真实游戏里几乎永远走不进 walk。
  // 折算到 1/30 秒的参考帧后是 0.867，超过阈值，且跟帧率无关。
  const raw60 = 26 / 60;
  const m60 = P.refMove(raw60, 0, 1 / 60);
  const m30 = P.refMove(26 / 30, 0, 1 / 30);
  near(m60.dx, 26 / 30, 1e-6, '60fps 的 0.433/帧折算成 0.867（= 26 u/s × 1/30 s）');
  near(m30.dx, 26 / 30, 1e-6, '30fps 的原始位移折算后相同（帧率无关）');
  ok(m60.dx > 0.5, '折算后越过 0.5 阈值 → 真的能进 walk');
  ok(P.refMove(0, 0, 1 / 60).dx === 0, '没动就是 0');
  const back = P.refMove(-raw60, 0, 1 / 60);
  ok(back.dx < 0, '向左走保留符号（不能取绝对值掩盖朝向）');
  const small = P.refMove(0, 0.05, 1 / 60);
  ok(small.dz > 0.05, '深度轴也一起折算（Boss 的 z 速度是 0.7 倍，容易被漏掉）');
  // dt 为 0 或异常值时不许出现 Infinity / NaN
  const z0 = P.refMove(0.4, 0.2, 0);
  ok(isFinite(z0.dx) && isFinite(z0.dz), 'dt=0 时不产生 Infinity/NaN', JSON.stringify(z0));
});

// ---------------------------------------------------------------- 汇总
console.log('\n' + '='.repeat(56));
if (fail === 0) {
  console.log(`全部通过：${pass} 项断言`);
  process.exit(0);
} else {
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
