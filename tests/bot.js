/**
 * bot.js — 用来测量难度的自动代理。**放在仓库里**，因为平衡数字必须可复现。
 *
 * 之前这套逻辑只存在于测试文件的局部函数里，而我向用户报告的胜率
 * （0 强化 100/95/40/5）与它实际跑出来的（100/100/73/7）不一致，
 * 且仓库里没有任何脚本能复现那组数字 —— 等于报了一个无法核实的结论。
 *
 * 这个 bot 模拟一个"会用技能的普通玩家"：
 *   - 侧移躲弹道（深度轴）
 *   - 血少时放战吼、再少时闪现
 *   - 被围放裂风斩、围得多放震地、人更多放大招
 *   - 保持 34~52px 的攻击距离，不在贴身位置硬吃伤害
 *   - 没有敌人时去捡掉落物
 *
 * 它不等于人类玩家，只作为**下限代理**：它能稳定通关的档位，
 * 人类玩家也应当能；它打不过的档位，人类仍可能靠操作赢。
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
const L = require(path.join(__dirname, '..', 'game', 'logic.js'));

const DT = 1 / 60;
const ZERO = Object.freeze({ left: false, right: false, up: false, down: false,
                             jump: false, attack: false });

/** 一帧的输入决策。纯函数，只读 state。 */
function decide(state) {
  const run = state.run;
  const i = Object.assign({}, ZERO);
  if (!run) return i;
  const p = run.player;
  const live = run.enemies.filter((e) => e.state !== 'dead');
  const cd = p.cooldowns || {};
  const hpF = p.hp / p.maxHp;
  const dist = (e) => Math.hypot(e.x - p.x, e.z - p.z);
  const near = live.filter((e) => dist(e) < 130).length;

  // 躲弹道优先：弹道只覆盖一条深度线，换深度就能躲
  const projs = run.projectiles || [];
  let dodging = false;
  for (let k = 0; k < projs.length; k++) {
    const pr = projs[k];
    if (Math.abs(pr.x - p.x) < 150 && Math.abs(pr.z - p.z) < 45) {
      if (pr.z >= p.z) i.down = true; else i.up = true;
      dodging = true;
    }
  }

  // 技能：保命 → 解围 → 收尾
  if (hpF < 0.45 && cd.cry === 0) i.cry = true;
  if (hpF < 0.30 && cd.blink === 0) i.blink = true;
  if (near >= 2 && cd.whirl === 0) i.whirl = true;
  if (near >= 3 && cd.slam === 0) i.slam = true;
  if (live.length >= 4 && cd.nova === 0) i.nova = true;

  // 没敌人就去捡掉落（打 → 捡 → 下一波）
  if (!live.length) {
    const pk = run.pickups || [];
    if (pk.length) {
      const t = pk.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
      if (t.x < p.x - 6) i.left = true;
      if (t.x > p.x + 6) i.right = true;
      if (t.z < p.z - 6) i.up = true;
      if (t.z > p.z + 6) i.down = true;
    }
    return i;
  }

  // 走位：保持攻击距离，不在贴身位置硬吃接触伤害
  const t = live.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  const dx = t.x - p.x, dz = t.z - p.z, d = Math.abs(dx);
  if (!dodging && Math.abs(dz) > 18) { if (dz > 0) i.up = true; else i.down = true; }
  // 站位门限：保持"逼近到攻击距离内"，但不按射程成比例缩放 ——
  // 试过 rng*0.79 / rng*0.52（78 → 61.6 / 40.6），胜率被自己打崩：
  // 机器人在 52~61.6px 区间里既不前进也不出手，等于站桩挨打，
  // 零强化草丛从 100% 掉到 87%、林地 97% → 50%。射程该管的是"够不够得着"，
  // 站位该管的是"贴到多近才停"，后者由敌人的推开距离决定，两者不该绑死。
  // 所以这里只做下限保护：射程至少要覆盖贴身间距，否则机器人不会靠近。
  const rng = C.ATTACK_RANGE;
  const standIn = Math.max(52, Math.min(rng - 6, 52 + 12));
  const standBack = Math.min(34, standIn - 12);
  if (d > standIn) { if (dx < 0) i.left = true; else i.right = true; }
  else if (d < standBack) { if (dx < 0) i.right = true; else i.left = true; }
  // 命中判据必须逐敌判断，不能只看"最近的那个"：
  // Boss 体型大（radius 46，贴身间距 69px），而 Boss 关里场上只有它，
  // 用单一门限会得出"打不中 Boss"的错误结论（2026-11-13 的正是这个 bug）。
  if (live.some(function (en) {
    return Math.abs(en.x - p.x) < rng && Math.abs(en.z - p.z) <= C.ATTACK_DEPTH * 0.85;
  })) i.attack = true;
  return i;
}

/** 跑完一整局，返回终局 state。 */
function play(seed, difficultyId, upgrades, equipment) {
  const s = L.createState(seed);
  if (upgrades) s.meta.upgrades = Object.assign({}, upgrades);
  // 装备要能在测量里出现，否则"经营层能否打通最高难度"这个问题
  // 只量到了强化，而玩家实际下场时身上是**带着一套装备**的 ——
  // 漏掉装备会把终局强度低估一大截。
  if (equipment) {
    C.EQUIP_SLOTS.forEach(function (slot) { s.meta.equipment[slot] = null; });
    Object.keys(equipment).forEach(function (id) {
      const def = C.equipDef(id);
      if (!def) throw new Error('unknown equip ' + id);
      s.meta.equipment[def.slot] = { id: id, level: (equipment[id] && equipment[id].level) || 1 };
    });
  }
  L.startRun(s, difficultyId);
  let t = 0;
  while (s.phase === 'run' && t < 300) {
    L.step(s, decide(s), DT);
    t += DT;
  }
  return s;
}

/** 某个难度在若干种子上的胜率。 */
function winRate(difficultyId, upgrades, n, stride, equipment) {
  const step = stride || 137;
  let wins = 0;
  let secs = 0;
  const results = [];
  for (let k = 1; k <= n; k++) {
    const s = play(k * step, difficultyId, upgrades, equipment);
    const won = !!(s.lastResult && s.lastResult.won);
    if (won) wins++;
    const sec = s.lastResult ? s.lastResult.elapsed : 0;
    secs += sec;
    results.push({ seed: k * step, won: won, seconds: sec,
                   waves: s.lastResult ? s.lastResult.wavesCleared : 0 });
  }
  return { rate: wins / n, wins: wins, n: n,
           avgSeconds: secs / n, results: results };
}

const ZERO_UP = Object.freeze({ damage: 0, maxHp: 0, speed: 0 });
const FULL_UP = Object.freeze({
  damage: C.UPGRADES.damage.maxLevel,
  maxHp: C.UPGRADES.maxHp.maxLevel,
  speed: C.UPGRADES.speed.maxLevel,
});
const HALF_UP = Object.freeze({ damage: 3, maxHp: 3, speed: 2 });

/**
 * 满级的基础套装（每档最贵的一件）。终局测量用，代表
 * "强化满 + 装备齐"的真实下场状态。特效件不算在内 ——
 * 特效是构筑选择，不是人人都有，混进来会把这个下限代理抬高。
 */
const FULL_SET = Object.freeze({
  hornHelm: 1, fullPlate: 1, wingCape: 1, twinBlades: 1, stoneBoots: 1,
});

module.exports = { DT, ZERO, decide, play, winRate,
                   ZERO_UP, HALF_UP, FULL_UP, FULL_SET };
