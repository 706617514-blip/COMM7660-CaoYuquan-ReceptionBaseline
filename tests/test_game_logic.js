/**
 * test_game_logic.js — 对 game/logic.js 的功能测试，Node 直接运行，无需浏览器。
 *
 * 覆盖重点不是"函数不报错"，而是那些**如果坏了玩家会立刻感觉到**的规则：
 *   - 深度轴是否真的有用（只按 x 判定 = 退化成纯横版）
 *   - 战利品在胜利/失败时的结算差异
 *   - 作物是否恰好第 2 局成熟、成熟后是否每局产出
 *   - 同种子是否可复现（存档读写与 CI 复现都靠它）
 *   - 核心循环能不能真的被打通（自动操作跑一局并期望胜利）
 *
 * 用法: node tests/test_game_logic.js
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
const L = require(path.join(__dirname, '..', 'game', 'logic.js'));

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

const DT = 1 / 60;
const INPUT = { left: false, right: false, up: false, down: false, jump: false, attack: false };

/**
 * 造一个受控对局：清空刷怪队列、把波次状态设为不会自动推进的 break，
 * 这样测试可以精确控制场上敌人与玩家位置。
 */
function armedRun(diffId, playerX, playerZ) {
  const s = L.createState(12345);
  L.startRun(s, diffId || 'wood');
  const run = s.run;
  run.enemies = [];
  run.spawnQueue = [];
  run.waveState = 'break';
  run.breakTimer = 9999;
  if (playerX !== undefined) run.player.x = playerX;
  if (playerZ !== undefined) run.player.z = playerZ;
  return { s, run };
}

function addEnemy(s, run, x, z, kind) {
  const e = L.makeEnemy(s, kind || 'crawler', run.diff);
  e.x = x; e.z = z; e.vx = 0; e.vz = 0;
  run.enemies.push(e);
  return e;
}

// ---------------------------------------------------------------- 1. 确定性
section('1. 确定性（同种子必须同结果）');
{
  const a = L.createState(777);
  const b = L.createState(777);
  const seqA = [], seqB = [];
  for (let i = 0; i < 12; i++) { seqA.push(L.nextRandom(a)); seqB.push(L.nextRandom(b)); }
  ok(JSON.stringify(seqA) === JSON.stringify(seqB), '同种子产生同一随机序列');

  const c = L.createState(778);
  const seqC = [];
  for (let i = 0; i < 12; i++) seqC.push(L.nextRandom(c));
  ok(JSON.stringify(seqA) !== JSON.stringify(seqC), '不同种子产生不同序列');

  const all = seqA.concat(seqB);
  ok(all.every(v => v >= 0 && v < 1), '随机数都落在 [0,1)');
}

// ---------------------------------------------------------------- 2. 深度轴
section('2. 深度轴：只有 x 重叠、z 差太大时不该命中');
{
  const { s, run } = armedRun('wood', 500, 105);
  run.player.facing = 1;
  const near = addEnemy(s, run, 540, 105);        // 正前方、同深度
  const far = addEnemy(s, run, 540, 105 + 130);   // 正前方、深度差 130（> 容差）
  const behind = addEnemy(s, run, 500 - 120, 105);// 身后远处

  const hpBefore = { near: near.hp, far: far.hp, behind: behind.hp };
  const input = Object.assign({}, INPUT, { attack: true });
  for (let i = 0; i < 4; i++) L.step(s, input, DT);

  ok(near.hp < hpBefore.near, '正前方同深度的小怪受到伤害',
     `${hpBefore.near} -> ${near.hp}`);
  eq(far.hp, hpBefore.far, '深度差超过容差时不命中（W/S 轴有效）');
  eq(behind.hp, hpBefore.behind, '身后够不到的小怪不受伤');

  // 把 far 移到同一深度后应当能打中 —— 证明差异来自 z 而不是别的
  far.z = 105;
  far.x = 540;
  const farHp2 = far.hp;
  for (let i = 0; i < 30; i++) L.step(s, input, DT);   // 等冷却
  ok(far.hp < farHp2, '移到同深度后即可命中（确认差异来自 z 轴）',
     `${farHp2} -> ${far.hp}`);
}

// ---------------------------------------------------------------- 3. 攻击方向
section('3. 攻击必须朝向前方');
{
  const { s, run } = armedRun('wood', 500, 105);
  run.player.facing = 1;
  const behind = addEnemy(s, run, 500 - 40, 105);  // 紧贴在身后
  const hp0 = behind.hp;
  const input = Object.assign({}, INPUT, { attack: true });
  L.step(s, input, DT);
  eq(behind.hp, hp0, '朝向右侧时，身后的小怪不受伤害');
}

// ---------------------------------------------------------------- 4. 击杀与战利品
section('4. 击杀掉落');
{
  const { s, run } = armedRun('wood', 500, 105);
  run.player.facing = 1;
  const e = addEnemy(s, run, 540, 105);
  e.hp = 1;                                   // 一击必杀
  const coins0 = run.loot.coins;
  const input = Object.assign({}, INPUT, { attack: true });
  L.step(s, input, DT);
  eq(e.state, 'dead', '血量归零后进入 dead 状态');
  ok(run.loot.coins > coins0, '击杀后铜币增加', `${coins0} -> ${run.loot.coins}`);
}

// ---------------------------------------------------------------- 5. 难度影响数值
section('5. 难度档真的改变了小怪数值');
{
  const base = {};
  C.DIFFICULTIES.forEach(d => {
    const s = L.createState(99);
    L.startRun(s, d.id);
    base[d.id] = { enemiesOnField: s.run.enemies.length, waveCount: d.waves, lootMul: d.lootMul };
  });
  const grass = C.difficultyById('grass');
  const forge = C.difficultyById('forge');
  ok(forge.hpMul > grass.hpMul, '熔炉的小怪血量倍率高于草丛');
  ok(forge.waves > grass.waves, '熔炉的波数多于草丛');
  ok(forge.lootMul > grass.lootMul, '熔炉的战利品倍率高于草丛（风险回报成立）');

  // 同一原型在不同难度下的实际血量必须不同
  const mk = (diffId) => {
    const s = L.createState(4242);
    L.startRun(s, diffId);
    return L.makeEnemy(s, 'crawler', C.difficultyById(diffId)).hp;
  };
  ok(mk('forge') > mk('wood'), '同一小怪在熔炉比林地更硬',
     `${mk('wood')} vs ${mk('forge')}`);
  ok(mk('grass') < mk('wood'), '同一小怪在草丛比林地更脆',
     `${mk('grass')} vs ${mk('wood')}`);
}

// ---------------------------------------------------------------- 6. 农庄（强度 A）
section('6. 农庄：第 2 局成熟，成熟后每局产出');
{
  const s = L.createState(555);
  eq(s.meta.seeds, 3, '开局给 3 颗种子');
  eq(s.farm.plots.filter(p => p.state === 'empty').length, 9, '开局 9 块空田');

  const r = L.plant(s, 0);
  ok(r.ok, '种下第一块田');
  eq(s.meta.seeds, 2, '种植消耗 1 颗种子');
  eq(s.farm.plots[0].state, 'growing', '田进入生长中');

  ok(!L.plant(s, 0).ok, '同一块田不能重复种');
  ok(L.plant(s, 4).ok, '可以种到另一块田');

  // 第 1 局结束
  L.startRun(s, 'grass'); L.endRun(s, true);
  eq(s.farm.plots[0].state, 'growing', '第 1 局后仍在生长');
  eq(s.farm.plots[0].growth, 1, '生长计数 = 1');
  eq(L.maturePlots(s), 0, '第 1 局后还没有成熟田');
  eq(L.passiveIncome(s), 0, '没有成熟田时不产生被动收入');

  // 第 2 局结束
  L.startRun(s, 'grass'); L.endRun(s, false);   // 故意输掉
  eq(s.farm.plots[0].state, 'mature', '第 2 局后成熟（输掉也算生长）');
  eq(L.maturePlots(s), 2, '两块田都成熟');
  ok(L.passiveIncome(s) === 2 * C.FARM.yieldPerPlot, '成熟田按块数产出被动收入',
     L.passiveIncome(s));

  // 被动收入确实进了钱包，且每局都会给
  const coinsBefore = s.meta.coins;
  L.startRun(s, 'grass'); L.endRun(s, true);
  ok(s.meta.coins > coinsBefore, '成熟田的被动收入在局末入账',
     `${coinsBefore} -> ${s.meta.coins}`);
}

// ---------------------------------------------------------------- 7. 胜负结算
section('7. 胜利全额、失败减半');
{
  const s1 = L.createState(1);
  L.startRun(s1, 'wood');
  s1.run.loot.coins = 100; s1.run.loot.seeds = 10;
  L.endRun(s1, true);
  eq(s1.meta.coins, 100, '胜利保留全部铜币');
  eq(s1.meta.seeds, 3 + 10, '胜利保留全部种子');

  const s2 = L.createState(1);
  L.startRun(s2, 'wood');
  s2.run.loot.coins = 100; s2.run.loot.seeds = 10;
  L.endRun(s2, false);
  eq(s2.meta.coins, 50, '失败只保留一半铜币');
  eq(s2.meta.seeds, 3 + 5, '失败只保留一半种子');
  eq(s2.meta.runsCompleted, 1, '失败也计入已完成局数');
  ok(s2.phase === 'result', '结算后进入 result 阶段');
}

// ---------------------------------------------------------------- 8. 失败条件
section('8. 血量归零即失败');
{
  const { s, run } = armedRun('wood', 500, 105);
  run.player.hp = 1;
  const e = addEnemy(s, run, 500, 105);       // 贴脸
  e.damage = 50;
  for (let i = 0; i < 30 && s.phase === 'run'; i++) L.step(s, INPUT, DT);
  eq(s.phase, 'result', '血量归零后结算');
  eq(s.lastResult.won, false, '结算结果为失败');
}

// ---------------------------------------------------------------- 9. 强化
section('9. 强化：成本递增、上限、实际生效');
{
  const s = L.createState(2);
  s.meta.coins = 10000;
  const c0 = L.upgradeCost(s, 'damage');
  L.buyUpgrade(s, 'damage');
  const c1 = L.upgradeCost(s, 'damage');
  ok(c1 > c0, '强化成本随等级递增', `${c0} -> ${c1}`);

  const before = L.playerStats(s).damage;
  L.buyUpgrade(s, 'damage');
  ok(L.playerStats(s).damage > before, '购买后伤害提升');

  const s2 = L.createState(3);
  s2.meta.coins = 0;
  ok(!L.buyUpgrade(s2, 'damage').ok, '铜币不足时购买失败');

  // 满级后不再可买
  const s3 = L.createState(4);
  s3.meta.coins = 1e9;
  for (let i = 0; i < C.UPGRADES.speed.maxLevel; i++) L.buyUpgrade(s3, 'speed');
  eq(s3.meta.upgrades.speed, C.UPGRADES.speed.maxLevel, '可升到上限等级');
  eq(L.upgradeCost(s3, 'speed'), null, '满级后没有下一档价格');
  ok(!L.buyUpgrade(s3, 'speed').ok, '满级后购买失败');
}

// ---------------------------------------------------------------- 10. 存档
section('10. 存档往返');
{
  const s = L.createState(606);
  L.plant(s, 0);
  s.meta.coins = 123;
  s.meta.upgrades.damage = 2;
  L.startRun(s, 'deep');
  for (let i = 0; i < 60; i++) L.step(s, Object.assign({}, INPUT, { right: true }), DT);

  const json = L.serialize(s);
  const back = L.deserialize(json);
  eq(back.meta.coins, 123, '读档后铜币一致');
  eq(back.meta.upgrades.damage, 2, '读档后强化等级一致');
  eq(back.farm.plots[0].state, 'growing', '读档后农田状态一致');
  eq(back.phase, 'run', '读档后阶段一致');
  eq(back.run.enemies.length, s.run.enemies.length, '读档后场上敌人数量一致');
  ok(JSON.stringify(back) === json, '二次序列化完全一致（无信息丢失）');

  let threw = false;
  try { L.deserialize('{"version":999}'); } catch (e) { threw = true; }
  ok(threw, '版本不匹配的存档会被拒绝');
}

// ---------------------------------------------------------------- 11. 边界
section('11. 场地边界');
{
  const { s, run } = armedRun('wood', 100, 100);
  const input = Object.assign({}, INPUT, { left: true, up: true });
  for (let i = 0; i < 600; i++) L.step(s, input, DT);
  ok(run.player.x >= C.PLAYER_W / 2 - 0.001, '玩家不会走出左边界', run.player.x);
  ok(run.player.z >= -0.001, '玩家不会走出景深带前边界', run.player.z);

  const r2 = armedRun('wood', 900, 100);
  const input2 = Object.assign({}, INPUT, { right: true, down: true });
  for (let i = 0; i < 600; i++) L.step(r2.s, input2, DT);
  ok(r2.run.player.x <= C.FIELD_W - C.PLAYER_W / 2 + 0.001, '玩家不会走出右边界',
     r2.run.player.x);
  ok(r2.run.player.z <= C.FIELD_D + 0.001, '玩家不会走出景深带后边界', r2.run.player.z);
}

// ---------------------------------------------------------------- 12. 跳跃
section('12. 跳跃会离地并落回');
{
  const { s, run } = armedRun('wood', 500, 105);
  L.step(s, Object.assign({}, INPUT, { jump: true }), DT);
  ok(run.player.h > 0 || run.player.vy > 0, '按下跳跃后离地');
  let maxH = 0;
  for (let i = 0; i < 120; i++) {
    L.step(s, INPUT, DT);
    maxH = Math.max(maxH, run.player.h);
  }
  ok(maxH > 40, '跳跃有可见高度', maxH);
  near(run.player.h, 0, 0.5, '最终回到地面');
}

// ---------------------------------------------------------------- 13. 全难度可跑
section('13. 每个难度都能完整推进且不出现 NaN');
{
  C.DIFFICULTIES.forEach(d => {
    const s = L.createState(8080);
    L.startRun(s, d.id);
    // 简单自动操作：朝最近的敌人移动并攻击
    for (let i = 0; i < 60 * 90 && s.phase === 'run'; i++) {
      const p = s.run.player;
      const live = s.run.enemies.filter(e => e.state !== 'dead');
      const input = Object.assign({}, INPUT);
      if (live.length) {
        const t = live.reduce((a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b);
        if (t.x < p.x - 6) input.left = true;
        if (t.x > p.x + 6) input.right = true;
        if (t.z < p.z - 6) input.up = true;
        if (t.z > p.z + 6) input.down = true;
        input.attack = true;
      }
      L.step(s, input, DT);
      if (!isFinite(p.x) || !isFinite(p.z) || !isFinite(p.hp)) {
        ok(false, `${d.name}: 玩家数值出现 NaN/Infinity`);
        return;
      }
    }
    ok(true, `${d.name}: 完成 90 秒模拟未出现数值异常`);
    ok(s.phase === 'result', `${d.name}: 自动对局有明确结局（${s.phase}）`);
  });
}

// ---------------------------------------------------------------- 14. 核心循环打通
section('14. 核心循环可以真的被打通（自动操作通关最低难度）');
{
  const s = L.createState(2026);
  let wonAt = -1;
  for (let run = 0; run < 6 && wonAt < 0; run++) {
    L.startRun(s, 'grass');
    for (let i = 0; i < 60 * 120 && s.phase === 'run'; i++) {
      const p = s.run.player;
      const live = s.run.enemies.filter(e => e.state !== 'dead');
      const input = Object.assign({}, INPUT);
      if (live.length) {
        const t = live.reduce((a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b);
        if (t.x < p.x - 6) input.left = true;
        if (t.x > p.x + 6) input.right = true;
        if (t.z < p.z - 6) input.up = true;
        if (t.z > p.z + 6) input.down = true;
        input.attack = true;
      }
      L.step(s, input, DT);
    }
    if (s.lastResult && s.lastResult.won) wonAt = run;
    // 每局之后在农庄里花掉种子和铜币，验证经营层能真正参与循环
    for (let i = 0; i < s.farm.plots.length; i++) {
      if (s.farm.plots[i].state === 'empty' && s.meta.seeds > 0) L.plant(s, i);
    }
    if (s.meta.coins >= L.upgradeCost(s, 'damage') || 0) L.buyUpgrade(s, 'damage');
    L.returnToFarm(s);
  }
  ok(wonAt >= 0, '在 6 局内打通了最低难度（核心循环可完成）', `第 ${wonAt + 1} 局`);
  ok(s.meta.runsCompleted >= 1, '局数被正确累计', s.meta.runsCompleted);
  ok(s.farm.plots.some(p => p.state !== 'empty'), '农庄在循环中被实际使用',
     s.farm.plots.map(p => p.state).join(','));
}

// ---------------------------------------------------------------- 15. 难度梯度
section('15. 难度梯度与经济门控（回归：防止调参把曲线搞平或搞崩）');
{
  const DT2 = 1 / 60;
  function bot(s) {
    const p = s.run.player;
    const i = { left: 0, right: 0, up: 0, down: 0, jump: 0, attack: 0 };
    const live = s.run.enemies.filter(e => e.state !== 'dead');
    if (!live.length) return i;
    const t = live.reduce((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b);
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.abs(dx);
    if (Math.abs(dz) > 18) { if (dz < 0) i.up = 1; else i.down = 1; }
    if (d > 52) { if (dx < 0) i.left = 1; else i.right = 1; }
    else if (d < 34) { if (dx < 0) i.right = 1; else i.left = 1; }
    if (d < 62 && Math.abs(dz) <= C.ATTACK_DEPTH * 0.85) i.attack = 1;
    return i;
  }
  function winRate(diffId, up, n) {
    let w = 0;
    for (let k = 1; k <= n; k++) {
      const s = L.createState(k * 211);
      s.meta.upgrades = Object.assign({}, up);
      L.startRun(s, diffId);
      let t = 0;
      while (s.phase === 'run' && t < 300) { t += DT2; L.step(s, bot(s), DT2); }
      if (s.lastResult && s.lastResult.won) w++;
    }
    return w / n;
  }
  const zero = { damage: 0, maxHp: 0, speed: 0 };
  const full = { damage: C.UPGRADES.damage.maxLevel, maxHp: C.UPGRADES.maxHp.maxLevel,
                 speed: C.UPGRADES.speed.maxLevel };

  const g0 = winRate('grass', zero, 12), f0 = winRate('forge', zero, 12);
  const fFull = winRate('forge', full, 12);

  ok(g0 >= 0.8, '最低难度在零强化下基本可通关（不会开局就劝退）', g0);
  ok(f0 <= 0.5, '最高难度在零强化下是真正的赌局（经济未成形时不该随便能过）', f0);
  ok(fFull > f0, '强化确实提升了最高难度的胜率（经营层对战斗有影响）', `${f0} -> ${fFull}`);
  ok(fFull >= 0.6, '全强化后最高难度可稳定通关（游戏有"打通"状态）', fFull);
}

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
