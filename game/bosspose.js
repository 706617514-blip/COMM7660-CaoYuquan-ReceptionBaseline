/**
 * bosspose.js — Boss 的姿态计算：**纯函数**，不碰 Phaser、不碰 DOM、不碰时间。
 *
 * 为什么单独一层
 * --------------
 * Boss 一直是一张 191×321 的 PNG 在做 setPosition：位置变了、图没变，
 * 观感就是"一张贴图在平移"（用户原话："看着很诡异"）。
 * 修法是保留 PNG 当躯干，在它上面程序化画两条分节藤蔓手臂，
 * 再叠呼吸 / 走路起伏 / 后仰前倾（设计文档 §3.1）。
 *
 * 但"手臂该抬多高、走路起伏多大、哪一帧踩下"这些**只能靠肉眼看截图验**，
 * 而截图一天只能看几张。所以把姿态抽成纯函数：
 *   compute(本帧输入) -> 姿态数值
 * 渲染层只负责把数值变成像素。数值错了 tests/test_bosspose.js 直接红。
 *
 * 三个约定（改了要同步 app.js 与测试）
 * -----------------------------------
 *   1. `bob` 的单位是**贴图未缩放像素**，正值向下（屏幕 y 向下为正）。
 *      渲染时要乘 scale —— 三档贴图高度不同（321/407/403），
 *      不乘 scale 的话同一套数值在三档上画出来的位移不一样。
 *   2. `dx` / `dz` 是**折算到 poseRefFrame（1/30 秒）的位移**，不是原始每帧位移。
 *      见 refMove() 与下面的勘误。
 *   3. `phase` 由调用方保存并回传。状态机里没有任何隐藏状态，
 *      同样的输入必然得到同样的输出（测试钉了这条）。
 *
 * 关于位移阈值的一处勘误（实测）
 * ------------------------------
 * 设计文档 §3.1 写的是"本帧位移 |dx|+|dz| > 0.5 就是走路"。按原始每帧位移算，
 * Boss speed = 26 u/s，60fps 下每帧水平位移只有 26/60 = 0.433，深度轴还要乘 0.7
 * （见 logic.js 里 boss.z += ... * 0.7），纯横着走是 0.433、纯纵着走是 0.303，
 * 只有 45° 斜走才到 0.736 —— 也就是说绝大多数方向**永远跨不过 0.5**，
 * Boss 会一直判成 idle，手臂一动不动（等于没做）。
 *
 * 所以判据保留（`|dx|+|dz| > 0.5`，边界仍然是 `>`），但输入改成折算后的位移：
 * refMove() 把本帧位移按 `poseRefFrame / dt` 放大/缩小到固定的 1/30 秒窗口。
 * 折算后：60fps 的 0.433 → 0.867，越过阈值；且与帧率无关（30fps 原始就是 0.867，
 * 144fps 的 0.18 → 0.867）。阈值 0.5 于是等于"速度 > 15 u/s 才算在走"。
 */
(function (global) {
  'use strict';

  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : global.GameConfig;

  const B = (C && C.BOSS) || {};
  const TAU = Math.PI * 2;

  const SEG_RATIO = (B.armSegRatio && B.armSegRatio.length)
    ? B.armSegRatio : [1.0, 0.86, 0.74, 0.63, 0.54, 0.46];
  const STEP_PERIOD = B.stepPeriod || 0.62;
  const WALK_THRESHOLD = typeof B.poseWalkThreshold === 'number' ? B.poseWalkThreshold : 0.5;
  const REF_FRAME = B.poseRefFrame || (1 / 30);
  // dt 的合理上限：掉帧 / 切后台回来时 delta 会很大，不夹住会让相位一次跳好几步，
  // 画面上一帧之内手臂从"抬到顶"跳到"砸下"，看起来像闪烁。
  const DT_MAX = 0.1;
  // 折算系数的上下界：dt 极小时（<1ms，比如隐藏标签页恢复的第一帧）系数会爆掉。
  const MUL_MIN = 0.2, MUL_MAX = 12;

  function num(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v : d;
  }
  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function frac(v) {
    return v - Math.floor(v);
  }
  function wrap(v) {
    return ((v % TAU) + TAU) % TAU;
  }

  /**
   * 把本帧位移折算到 poseRefFrame（1/30 秒）的窗口。
   *
   * 为什么要这一步：见文件头"关于位移阈值的一处勘误"。
   * 调用方拿到 boss 本帧的 (x,z) 增量后，必须过一遍这里再喂给 compute，
   * 否则 60fps 下位移永远够不到阈值，Boss 走起来手臂不动。
   */
  function refMove(dx, dz, dt) {
    const s = num(dt, 0);
    let k = REF_FRAME / (s > 1e-4 ? s : 1e-4);
    if (k < MUL_MIN) k = MUL_MIN;
    if (k > MUL_MAX) k = MUL_MAX;
    return { dx: num(dx, 0) * k, dz: num(dz, 0) * k };
  }

  /**
   * segments(baseAngle, swing, armPhase, count) -> number[]
   *
   * 每节角度 = baseAngle + sin(armPhase + i * 0.6) * swing。
   * i 越大相位越靠后，于是同一条手臂上形成一道**沿手臂传播的波**：
   * 这正是藤蔓该有的样子（整条手臂一起硬摆会像根棍子）。
   * 幅度 swing 小的时候接近直线（站着 / 蓄力），大的时候明显摆动（走路）。
   */
  function segments(baseAngle, swing, armPhase, count) {
    const base = num(baseAngle, 0);
    const sw = num(swing, 0);
    const ap = num(armPhase, 0);
    let n = Math.round(num(count, SEG_RATIO.length));
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 32) n = 32;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = base + Math.sin(ap + i * 0.6) * sw;
    return out;
  }

  /**
   * compute(inp) -> pose
   *
   * inp: { dx, dz, casting, facing, phase, dt, time, charge }
   *   dx/dz   refMove() 折算过的位移（见上）
   *   casting boss.casting 或 null：{ timer, windup }
   *   facing  1 / -1（1 = 朝右）
   *   phase   上一帧的 pose.phase（首帧给 0）
   *   dt      本帧秒数
   *   time    毫秒（只用于站着时的呼吸，不影响步态相位）
   *   charge  0..1；不给则由 1 - timer/windup 派生
   *
   * pose: { state, phase, bob, squash, lean, armRaise, armSwing, armPhase, footfall, stepPhase }
   */
  function compute(raw) {
    const inp = raw || {};
    const dx = num(inp.dx, 0);
    const dz = num(inp.dz, 0);
    const facing = inp.facing < 0 ? -1 : 1;
    const dtRaw = num(inp.dt, 0);
    const dt = dtRaw < 0 ? 0 : (dtRaw > DT_MAX ? DT_MAX : dtRaw);
    const time = num(inp.time, 0);
    const cast = (inp.casting && typeof inp.casting === 'object') ? inp.casting : null;
    const windup = cast ? num(cast.windup, 0) : 0;
    const timer = cast ? num(cast.timer, 0) : 0;
    const hasCast = !!cast && windup > 0;

    // ---- 相位：步态周期的推进 ----
    // 无论什么状态相位都在走（stepPhase 是调试/截图用的读数），
    // 但 footfall 只在 walk 状态下真的触发 —— 否则站着也在脚下扬尘。
    const phasePrev = wrap(num(inp.phase, 0));
    const phase = wrap(phasePrev + (TAU / STEP_PERIOD) * dt);
    const sPrev = frac(phasePrev / TAU);
    const sNext = frac(phase / TAU);
    // 跨过 0.5（= 踩下那一下）的判定。相位会回绕，所以分两种情形：
    // 没回绕时看是否跨过 0.5；回绕了则说明 0.5 在上一周期里跨过去了。
    const crossedDown = (sNext >= sPrev)
      ? (sPrev < 0.5 && sNext >= 0.5)
      : (sPrev < 0.5);

    // ---- 状态判据（设计文档 §3.1，顺序就是优先级）----
    let state;
    let ratio = 1;                       // timer/windup，只有施法时有意义
    if (hasCast) {
      ratio = timer / windup;
      state = ratio > 0.35 ? 'windup' : 'strike';
    } else if (Math.abs(dx) + Math.abs(dz) > WALK_THRESHOLD) {
      state = 'walk';
    } else {
      state = 'idle';
    }

    // ---- 蓄力进度 ----
    // 派生值最多到 0.65（因为 windup 判据在 timer/windup > 0.35），
    // 想要"蓄满"那一端的数值（armRaise 0.95 / squash 0.90）由调用方显式给 charge。
    let charge = 0;
    if (hasCast) {
      charge = (typeof inp.charge === 'number' && isFinite(inp.charge))
        ? clamp01(inp.charge)
        : clamp01(1 - ratio);
    }

    let bob = 0, squash = 1, lean = 0, armRaise = 0.08, armSwing = 0.07;
    let footfall = false;

    if (state === 'idle') {
      // ---- 站着：极慢的呼吸 ----
      // 以前 app.js 里手写的是 Math.sin(time/620)*0.014 并直接乘在 scale 上，
      // 幅度偏大、频率偏快（1.6Hz 像在喘）。这里改成 1.4 秒周期的呼吸，
      // 起伏 ±2 贴图像素，一轴胀一轴缩（体积守恒）。
      const br = Math.sin(time / 1400);
      bob = br * 2;
      squash = 1 - br * 0.014;
      lean = 0;
      armRaise = 0.08 + br * 0.012;
      armSwing = 0.07;
    } else if (state === 'walk') {
      // ---- 走路：一步一个下压 ----
      // down ∈ [0,1] 在 stepPhase = 0.5 时到 1（就是 footfall 那一帧）：
      // 身体压下去、压扁、手臂抬一点，这是"庞然大物把重量砸在脚上"的读法。
      const down = Math.max(0, -Math.cos(TAU * sNext));
      bob = -3 * Math.cos(TAU * sNext);          // ±3，踩下（s=0.5）时 +3 = 向下
      squash = 1 - 0.04 * down + 0.012 * (1 - down);
      lean = facing * 0.02 * (0.35 + 0.65 * down);
      armRaise = 0.12 + 0.02 * down;
      armSwing = 0.30;
      footfall = crossedDown;
    } else if (state === 'windup') {
      // ---- 蓄力：抬起来、往后仰、往下压 ----
      bob = 0;
      squash = 1 - charge * 0.10;
      lean = -0.045 * charge * facing;           // 后仰（与朝向相反）
      armRaise = 0.80 + 0.15 * charge;
      armSwing = 0.05;
    } else {
      // ---- 下砸：砸下去那一瞬间 ----
      bob = 2;
      squash = 1.03;                             // 拉长
      lean = 0.05 * facing;                      // 前倾
      armRaise = 0.02;
      armSwing = 0.04;
      // 落手只有一帧：timer 刚好跨过 0.35 的边界那一刻。
      // 不能整个 strike 阶段都 true —— 那样扬尘会连撒二十来帧，像着火。
      const st = dt / windup;
      footfall = (ratio <= 0.35) && (ratio + st > 0.35);
    }

    return {
      state: state,
      phase: phase,
      bob: bob,
      squash: squash,
      lean: lean,
      armRaise: armRaise,
      armSwing: armSwing,
      // 手臂波动的相位基准。走着时跟步态同频；站着时放慢一半，
      // 否则静止的手臂也在明显抽动（0.07 的幅度配快相位会看出来）。
      armPhase: phase * (state === 'idle' ? 0.5 : 1),
      footfall: footfall,
      stepPhase: sNext,
    };
  }

  const API = { compute: compute, segments: segments, refMove: refMove, SEG_RATIO: SEG_RATIO };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.BossPose = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
