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
  if (d > 52) { if (dx < 0) i.left = true; else i.right = true; }
  else if (d < 34) { if (dx < 0) i.right = true; else i.left = true; }
  if (d < 62 && Math.abs(dz) <= C.ATTACK_DEPTH * 0.85) i.attack = true;
  return i;
}

/** 跑完一整局，返回终局 state。 */
function play(seed, difficultyId, upgrades) {
  const s = L.createState(seed);
  if (upgrades) s.meta.upgrades = Object.assign({}, upgrades);
  L.startRun(s, difficultyId);
  let t = 0;
  while (s.phase === 'run' && t < 300) {
    L.step(s, decide(s), DT);
    t += DT;
  }
  return s;
}

/** 某个难度在若干种子上的胜率。 */
function winRate(difficultyId, upgrades, n, stride) {
  const step = stride || 137;
  let wins = 0;
  let secs = 0;
  const results = [];
  for (let k = 1; k <= n; k++) {
    const s = play(k * step, difficultyId, upgrades);
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

module.exports = { DT, ZERO, decide, play, winRate, ZERO_UP, HALF_UP, FULL_UP };
