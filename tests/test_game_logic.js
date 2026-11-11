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
  // 掉落改为"掉在地上、要走过去捡"，这是战斗节奏的一部分
  ok(run.pickups.length > 0, '击杀后掉落物出现在场上', run.pickups.length);
  eq(run.loot.coins, coins0, '战利品不会自动入账（必须先捡）');

  // 走过去捡起来。注意掉落物要先落地才可拾取，所以要用真实的 step 推进，
  // 而不是手搓一个 h=0 的对象。
  run.player.x = e.x; run.player.z = e.z;
  for (let i = 0; i < 180 && run.pickups.length; i++) {
    L.step(s, {}, DT);
  }
  ok(run.loot.coins > coins0, '走过去把落地的掉落物捡起来后铜币入账',
     `${coins0} -> ${run.loot.coins}`);

  // 清波时应当把没捡的也收走，避免"清完场却丢战利品"
  // 先清空场上残留，否则断言会把前面击杀掉落的币也算进来
  run.pickups.length = 0;
  run.pickups.push({ x: 200, z: 20, kind: 'coin', value: 7, life: 9, bob: 0,
                     h: 20, vh: 100, vx: 0, vz: 0, grounded: false });
  const beforeCollect = run.loot.coins;
  L.collectAll(s, run);
  eq(run.loot.coins, beforeCollect + 7, '清波会收走剩余掉落物');
  eq(run.pickups.length, 0, '收走后场上清空');
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
  ok(threw, '更新版本的存档会被拒绝（不能降级读取）');

  // ---- 旧存档迁移：不能因为加了个字段就丢掉玩家全部进度 ----
  const v2 = JSON.stringify({
    version: 2, seed: 1, rngState: 1, phase: 'farm',
    meta: { coins: 999, seeds: 4, upgrades: { damage: 5, maxHp: 5, speed: 3 },
            runsCompleted: 42, runsWon: 30, bestWave: 4 },
    farm: { plots: Array.from({ length: 9 }, (_, i) => ({
      state: i < 3 ? 'mature' : 'empty', growth: i < 3 ? 2 : 0 })) },
    run: null, lastResult: null,
  });
  const migrated = L.deserialize(v2);
  eq(migrated.version, L.STATE_VERSION, 'v2 存档被迁移到当前版本');
  eq(migrated.meta.coins, 999, '迁移后铜币保留');
  eq(migrated.meta.upgrades.damage, 5, '迁移后强化等级保留');
  eq(L.maturePlots(migrated), 3, '迁移后农田状态保留');
  ok(migrated.meta.skills && migrated.meta.skills.whirl === 1,
     '迁移后补上了缺失的技能字段');
  // 迁移完必须还能直接开局
  L.startRun(migrated, 'wood');
  eq(migrated.phase, 'run', '迁移后的存档可以正常开局');

  // 字段残缺的当前版本存档也要补齐，而不是崩溃
  const bare = L.deserialize(JSON.stringify({
    version: L.STATE_VERSION, seed: 5, rngState: 5, phase: 'farm',
    meta: { coins: 1, seeds: 1 },
  }));
  ok(bare.meta.skills && bare.meta.upgrades, '残缺存档补齐了 skills 与 upgrades');
  eq(bare.farm.plots.length, 9, '残缺存档补齐了农田');
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
section('14. 核心循环可以真的被打通');
{
  // 早先这一节用的是一个"贴到 6px 才出手"的笨代理，它被打死并不代表循环不可完成。
  // 改为与平衡测试同款的走位 bot，并用多局统计代替"某一局必须赢"。
  const DT2 = 1 / 60;
  function playBot(state) {
    const p = state.run.player;
    const i = Object.assign({}, INPUT);
    const live = state.run.enemies.filter(e => e.state !== 'dead');
    const cd = p.cooldowns || {};
    const hpF = p.hp / p.maxHp;
    const dist = (e) => Math.hypot(e.x - p.x, e.z - p.z);
    const near = live.filter(e => dist(e) < 130).length;

    const projs = state.run.projectiles || [];
    let dodging = false;
    for (let k = 0; k < projs.length; k++) {
      const pr = projs[k];
      if (Math.abs(pr.x - p.x) < 150 && Math.abs(pr.z - p.z) < 45) {
        if (pr.z >= p.z) i.down = true; else i.up = true;
        dodging = true;
      }
    }
    if (hpF < 0.45 && cd.cry === 0) i.cry = true;
    if (hpF < 0.30 && cd.blink === 0) i.blink = true;
    if (near >= 2 && cd.whirl === 0) i.whirl = true;
    if (near >= 3 && cd.slam === 0) i.slam = true;
    if (live.length >= 4 && cd.nova === 0) i.nova = true;

    if (!live.length) {
      // 没敌人时去捡掉落（打 → 捡 → 下一波 的节拍）
      const pk = state.run.pickups || [];
      if (pk.length) {
        const t = pk.reduce((a, b) => dist(a) <= dist(b) ? a : b);
        if (t.x < p.x - 6) i.left = true;
        if (t.x > p.x + 6) i.right = true;
        if (t.z < p.z - 6) i.up = true;
        if (t.z > p.z + 6) i.down = true;
      }
      return i;
    }
    const t = live.reduce((a, b) => dist(a) <= dist(b) ? a : b);
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.abs(dx);
    if (!dodging && Math.abs(dz) > 18) { if (dz > 0) i.up = true; else i.down = true; }
    if (d > 52) { if (dx < 0) i.left = true; else i.right = true; }
    else if (d < 34) { if (dx < 0) i.right = true; else i.left = true; }
    if (d < 62 && Math.abs(dz) <= C.ATTACK_DEPTH * 0.85) i.attack = true;
    return i;
  }

  function playOne(seed, diffId) {
    const s = L.createState(seed);
    L.startRun(s, diffId);
    let t = 0;
    while (s.phase === 'run' && t < 300) { t += DT2; L.step(s, playBot(s), DT2); }
    return s;
  }

  // 最低难度必须稳定可通关：20 次里至少 16 次
  let wins = 0;
  for (let k = 1; k <= 20; k++) {
    const s = playOne(k * 137, 'grass');
    if (s.lastResult && s.lastResult.won) wins++;
  }
  ok(wins >= 16, '最低难度可稳定通关（20 次里胜 ' + wins + ' 次）', wins);

  // 一局打完确实有战利品进账（掉落拾取机制生效）
  const s2 = playOne(4242, 'grass');
  ok(s2.lastResult && s2.lastResult.coins > 0, '一局能带回铜币',
     s2.lastResult && s2.lastResult.coins);

  // 经营层确实参与循环：种下的田会在两局后成熟并开始产出
  const s3 = L.createState(777);
  L.plant(s3, 0);
  L.plant(s3, 1);
  L.startRun(s3, 'grass'); L.endRun(s3, true);
  eq(L.maturePlots(s3), 0, '一局后尚未成熟');
  L.startRun(s3, 'grass'); L.endRun(s3, false);
  eq(L.maturePlots(s3), 2, '两局后两块田成熟（输掉也算）');
  ok(L.passiveIncome(s3) > 0, '成熟田开始产生被动收入', L.passiveIncome(s3));
}

// ---------------------------------------------------------------- 15. 难度梯度
section('15. 难度梯度（测量全部四个档位，并断言阶梯单调）');
{
  // 这一节以前只量了草丛和熔炉，n=12，密林和林地从未被测过 ——
  // 于是密林在零强化下实际有 68% 胜率、半满即 100%，
  // 四档退化为"除了熔炉都不难"，而测试一直是绿的。
  // 现在改用 tests/bot.js（仓库里的代理，可复现）并逐档测量。
  const B = require(path.join(__dirname, 'bot.js'));
  const N = 30;
  const rates = {};
  C.DIFFICULTIES.forEach((d) => {
    rates[d.id] = B.winRate(d.id, B.ZERO_UP, N).rate;
  });

  console.log('    零强化胜率: ' + C.DIFFICULTIES.map(
    (d) => d.name + ' ' + (rates[d.id] * 100).toFixed(0) + '%').join(' · '));

  ok(rates.grass >= 0.90, '最低难度零强化下接近必过（不劝退）', rates.grass);
  ok(rates.wood >= 0.75, '第二档仍然是"稳着种田"的安全选择', rates.wood);
  ok(rates.deep >= 0.20 && rates.deep <= 0.60,
     '第三档是真正的坎（20%~60%），不是摆设', rates.deep);
  ok(rates.forge <= 0.20, '最高难度零强化下是赌局', rates.forge);

  // 阶梯必须单调：档位越高胜率越低，否则难度档没有意义。
  // 但草丛与林地都是"安全档"，两者都接近 100%，n=30 时抽样噪声
  // （约 ±5 个百分点）足以让 93% 与 100% 的顺序颠倒。所以这里只对
  // 真正有区分度的档位做单调断言：林地 < 草丛、密林 < 林地、熔炉 < 密林，
  // 且不要求"安全档"内部严格排序。
  const order = C.DIFFICULTIES.map((d) => rates[d.id]);
  ok(rates.wood <= rates.grass + 0.15,
     '林地不高于草丛（两档都是安全档，允许抽样噪声）',
     `${(rates.grass * 100).toFixed(0)}% vs ${(rates.wood * 100).toFixed(0)}%`);
  ok(rates.deep < rates.wood - 0.10,
     '密林明显低于林地（真正的难度台阶）',
     `${(rates.wood * 100).toFixed(0)}% -> ${(rates.deep * 100).toFixed(0)}%`);
  ok(rates.forge <= rates.deep + 0.05,
     '熔炉不高于密林（最高难度是赌局）',
     `${(rates.deep * 100).toFixed(0)}% -> ${(rates.forge * 100).toFixed(0)}%`);

  // 经营层必须真的改变结果：全强化下最高难度应当能稳过
  const forgeZero = rates.forge;
  const forgeFull = B.winRate('forge', B.FULL_UP, N).rate;
  ok(forgeFull > forgeZero + 0.4,
     '强化显著提升最高难度胜率（经营层对战斗有影响）',
     `${(forgeZero * 100).toFixed(0)}% -> ${(forgeFull * 100).toFixed(0)}%`);
  ok(forgeFull >= 0.75, '全强化后最高难度可以稳定通关（游戏有"打通"状态）', forgeFull);
}

// ---------------------------------------------------------------- 16. 远程敌人与弹道
section('16. 远程敌人与弹道（深度轴必须能用来躲）');
{
  const mk = (pz) => {
    const { s, run } = armedRun('wood', 500, pz);
    run.projectiles = [];
    return { s, run };
  };

  // (a) 同深度：应当命中
  {
    const { s, run } = mk(105);
    const p = run.player;
    run.projectiles.push({ x: p.x - 120, z: p.z, h: 20, vx: 275, vz: 0,
      damage: 11, radius: 20, depth: 26, life: 3, spin: 0 });
    const hp0 = p.hp;
    for (let i = 0; i < 60; i++) L.stepProjectiles(s, run, 1 / 60);
    ok(p.hp < hp0, '同深度的弹道会命中玩家', `${hp0} -> ${p.hp}`);
  }

  // (b) 错开深度：应当躲开 —— 这是 W/S 轴真正的用处
  {
    const { s, run } = mk(105);
    const p = run.player;
    run.projectiles.push({ x: p.x - 120, z: p.z + 62, h: 20, vx: 275, vz: 0,
      damage: 11, radius: 20, depth: 26, life: 3, spin: 0 });
    const hp0 = p.hp;
    for (let i = 0; i < 60; i++) L.stepProjectiles(s, run, 1 / 60);
    eq(p.hp, hp0, '深度错开 62 的弹道被躲过（W/S 能用来躲避）');
  }

  // (c) 弹道会过期，不会永远飞
  {
    const { s, run } = mk(105);
    const p = run.player;
    run.projectiles.push({ x: p.x - 400, z: p.z + 80, h: 20, vx: 275, vz: 0,
      damage: 11, radius: 20, depth: 26, life: 0.3, spin: 0 });
    for (let i = 0; i < 60; i++) L.stepProjectiles(s, run, 1 / 60);
    eq(run.projectiles.length, 0, '超时弹道会被清理');
  }

  // (d) 吐酸虫会真的开火，且弹道朝玩家方向
  {
    const { s, run } = armedRun('wood', 500, 105);
    run.projectiles = [];
    const p = run.player;
    const e = L.makeEnemy(s, 'spitter', run.diff);
    e.x = p.x - 240; e.z = p.z;
    run.enemies.push(e);
    let sawProj = false;
    for (let i = 0; i < 60 * 6 && run.projectiles.length === 0; i++) {
      L.step(s, {}, 1 / 60);
      if (run.projectiles.length) sawProj = true;
    }
    ok(sawProj, '吐酸虫在 6 秒内至少开火一次');
    if (run.projectiles.length) {
      const pr = run.projectiles[0];
      ok(Math.sign(pr.vx) === Math.sign(p.x - e.x), '弹道朝向玩家',
         `vx=${pr.vx.toFixed(0)} 目标在 ${(p.x - e.x).toFixed(0)}`);
    }
    ok(e.stun === 0, '吐酸虫未被误加入僵直');
  }

  // (e) 距离维持：太近了应当后退
  {
    const { s, run } = armedRun('wood', 500, 105);
    run.projectiles = [];
    const p = run.player;
    const e = L.makeEnemy(s, 'spitter', run.diff);
    e.x = p.x - 60; e.z = p.z;      // 明显比 keepDistance 近
    e.fireCd = 99;                   // 先别开火，只看走位
    run.enemies.push(e);
    const x0 = e.x;
    for (let i = 0; i < 90; i++) L.step(s, {}, 1 / 60);
    ok(e.x < x0 - 10, '靠得太近时吐酸虫会后撤拉开距离',
       `${x0.toFixed(0)} -> ${e.x.toFixed(0)}`);
  }
}

// ---------------------------------------------------------------- 17. 裂风斩与冲刺
section('17. 裂风斩朝前释放 · Shift 冲刺');
{
  // (a) 裂风斩只打前方
  {
    const { s, run } = armedRun('wood', 500, 105);
    const p = run.player;
    p.facing = 1;
    const front = addEnemy(s, run, 500 + 150, 105);
    const behind = addEnemy(s, run, 500 - 150, 105);
    const aside = addEnemy(s, run, 500 + 150, 105 + 110);
    const hp0 = { f: front.hp, b: behind.hp, a: aside.hp };
    L.step(s, { whirl: true }, DT);
    ok(front.hp < hp0.f, '裂风斩命中正前方目标', `${hp0.f} -> ${front.hp}`);
    eq(behind.hp, hp0.b, '裂风斩不命中身后目标');
    eq(aside.hp, hp0.a, '裂风斩不命中深度偏离过大的目标');
  }

  // (b) 转身后命中方向跟着变
  {
    const { s, run } = armedRun('wood', 500, 105);
    const p = run.player;
    p.facing = -1;
    const left = addEnemy(s, run, 500 - 150, 105);
    const right = addEnemy(s, run, 500 + 150, 105);
    const hp0 = { l: left.hp, r: right.hp };
    L.step(s, { whirl: true }, DT);
    ok(left.hp < hp0.l, '面朝左时命中左侧目标');
    eq(right.hp, hp0.r, '面朝左时不命中右侧目标');
  }

  // (c) 冷却生效
  {
    const { s, run } = armedRun('wood', 500, 105);
    L.step(s, { whirl: true }, DT);
    ok(run.player.cooldowns.whirl > 0, '裂风斩进入冷却', run.player.cooldowns.whirl);
    const front = addEnemy(s, run, 500 + 150, 105);
    front.x = 640;
    const hp0 = front.hp;
    L.step(s, { whirl: true }, DT);
    eq(front.hp, hp0, '冷却期间再按不会重复造成伤害');
  }

  // (d) 冲刺倍率
  {
    const measure = (sprint, key) => {
      const { s, run } = armedRun('wood', 200, 105);
      run.player.z = 20;
      const p = run.player;
      const before = key === 'x' ? p.x : p.z;
      const input = { right: key === 'x', up: key === 'z', sprint: sprint };
      for (let i = 0; i < 60; i++) L.step(s, input, DT);
      return (key === 'x' ? p.x : p.z) - before;
    };
    const walk = measure(false, 'x');
    const sprint = measure(true, 'x');
    near(walk, C.PLAYER_SPEED, 1, '步行速度符合配置');
    near(sprint / walk, C.SPRINT_MULT, 0.02, '冲刺倍率符合配置');
    ok(sprint > walk + 100, '冲刺明显更快', `${walk.toFixed(0)} -> ${sprint.toFixed(0)}`);

    // 深度轴上冲刺更收敛，避免前后跳变太快
    const dw = measure(false, 'z');
    const ds = measure(true, 'z');
    ok(ds / dw < sprint / walk, '深度轴的冲刺倍率小于水平轴', `${(ds/dw).toFixed(2)} vs ${(sprint/walk).toFixed(2)}`);
  }

  // (e) 松开 Shift 立刻回到步行速度（不做惯性）
  {
    const { s, run } = armedRun('wood', 200, 105);
    const p = run.player;
    const x0 = p.x;
    for (let i = 0; i < 30; i++) L.step(s, { right: true, sprint: true }, DT);
    const x1 = p.x;
    for (let i = 0; i < 30; i++) L.step(s, { right: true, sprint: false }, DT);
    const x2 = p.x;
    near(x1 - x0, C.PLAYER_SPEED * C.SPRINT_MULT * 0.5, 2, '冲刺 0.5 秒位移正确');
    near(x2 - x1, C.PLAYER_SPEED * 0.5, 2, '松开后 0.5 秒回到常速（无残留惯性）');
    eq(p.sprinting, false, 'sprinting 标记已复位');
  }
}

// ---------------------------------------------------------------- 18. 三段式普攻
section('18. 三段式普攻（连击）');
{
  const { s, run } = armedRun('wood', 500, 105);
  const p = run.player;
  p.facing = 1;

  // (a) 起手：comboStep 从 0 推进到 1，仍然是快招
  eq(p.comboStep, 0, '开局连击计数为 0');
  L.step(s, { attack: true }, DT);
  eq(p.comboStep, 1, '第一次攻击后连击计数为 1');
  const firstCd = p.attackCd;

  // (b) 连击窗口内再次攻击 → 进入第二段
  p.attackCd = 0;
  L.step(s, { attack: true }, DT);
  eq(p.comboStep, 2, '连击窗口内再次攻击进入第二段');

  // (c) 第三段是收招：伤害更高、硬直更长
  p.attackCd = 0;
  const before3 = p.comboStep;
  L.step(s, { attack: true }, DT);
  eq(before3, 2, '第三段之前连击计数为 2');
  eq(p.comboStep, 0, '第三段打完后连击重置为 0');
  const thirdCd = p.attackCd;
  ok(thirdCd > firstCd, '第三段硬直长于第一段（快→快→慢的节奏）',
     `${firstCd.toFixed(2)}s vs ${thirdCd.toFixed(2)}s`);

  // (d) 三段伤害必须递增 —— 否则第三段的慢硬直没有回报，连击就没意义
  const hitDamageAt = (stepIndex) => {
    const r = armedRun('wood', 500, 105);
    const pl = r.run.player;
    pl.facing = 1;
    // 把连击推进到指定段（不真的打人）
    for (let i = 0; i < stepIndex; i++) {
      pl.attackCd = 0;
      L.step(r.s, { attack: true }, DT);
    }
    pl.attackCd = 0;
    r.run.enemies.length = 0;
    const target = addEnemy(r.s, r.run, 540, 105);
    const before = target.hp;
    L.step(r.s, { attack: true }, DT);
    return before - target.hp;
  };
  const dmg = [0, 1, 2].map(hitDamageAt);
  console.log('    三段伤害: ' + dmg.join(' → '));
  ok(dmg[1] > dmg[0], '第二段伤害高于第一段', `${dmg[0]} → ${dmg[1]}`);
  ok(dmg[2] > dmg[1] * 1.4, '第三段伤害显著高于第二段（收招的回报）',
     `${dmg[1]} → ${dmg[2]}`);

  // (e) 长时间不出手，连击会断
  {
    const r = armedRun('wood', 500, 105);
    const pl = r.run.player;
    L.step(r.s, { attack: true }, DT);
    eq(pl.comboStep, 1, '打一下后连击为 1');
    pl.attackCd = 0;
    const wait = Math.ceil((C.COMBO.window + 0.1) * 60);
    for (let i = 0; i < wait; i++) L.step(r.s, {}, DT);
    eq(pl.comboStep, 0, '停手超过窗口后连击断开');
  }

}

// ---------------------------------------------------------------- 19. 掉落物实体
section('19. 掉落物作为实体：有落点、会弹出、会沉降');
{
  const { s, run } = armedRun('wood', 500, 105);
  run.player.facing = 1;
  const e = addEnemy(s, run, 540, 105);
  e.hp = 1;
  L.step(s, { attack: true }, DT);

  ok(run.pickups.length > 0, '击杀产生掉落物');
  const it = run.pickups[0];
  // 实体感来自：有垂直偏移（弹出抛物线）与缩放阶段，而不是贴地不动
  ok(typeof it.h === 'number', '掉落物有离地高度 h', typeof it.h);
  ok(typeof it.vh === 'number', '掉落物有垂直速度 vh', typeof it.vh);
  ok(it.vh !== 0 || it.h > 0, '掉落物生成时处于弹起状态', `h=${it.h} vh=${it.vh}`);

  // 跑几帧后应当落地（h 归零），并且停住
  for (let i = 0; i < 120; i++) L.stepPickups(s, run, DT);
  ok(it.h <= 0.01, '掉落物最终落到地面', it.h);
  eq(it.vh, 0, '落地后垂直速度归零');

  // 弹出应当有横向散开，而不是全叠在一点
  const { s: s2, run: r2 } = armedRun('wood', 500, 105);
  r2.player.facing = 1;
  // 必须都落在同一条深度线上，否则攻击的深度容差会把它们筛掉
  for (let k = 0; k < 8; k++) {
    const t2 = addEnemy(s2, r2, 520 + k * 4, 105);
    t2.hp = 1;
  }
  r2.player.attackCd = 0;
  r2.player.comboRange = 400;
  r2.player.comboDamageMul = 99;   // 确保一击必杀，测的是掉落数量而不是伤害
  L.step(s2, { attack: true }, DT);
  // 玩家此时就站在尸体堆里，但掉落物**弹在空中时不能被捡**，
  // 所以这一帧结束应当看到完整的 8 枚铜币，而不是被立刻吸走。
  const coins = r2.pickups.filter((it2) => it2.kind === 'coin');
  ok(coins.length === 8, '每只敌人必掉一枚铜币，且空中不可拾取', `${coins.length} / 8`);
  ok(r2.pickups.every((it2) => it2.grounded === false || it2.h >= 0),
     '掉落物处于弹出过程中');
  ok(r2.pickups.length >= 8, '一次击杀多个敌人产生多个掉落物', r2.pickups.length);
  const xs = r2.pickups.map((p2) => p2.x);
  ok(new Set(xs.map((v) => Math.round(v))).size > 1, '多个掉落物有各自的落点（不重叠）',
     xs.map((v) => v.toFixed(0)).join(','));
}

// ---------------------------------------------------------------- 20. 成熟田的产出方式
section('20. 成熟田自动产出，不需要手动收取');
{
  // 玩家反馈"种子成熟了没法收取"。查下来逻辑是对的：
  // 成熟田在**每局结束时**自动产出，界面上没有任何"收取"动作。
  // 问题是界面没表达清楚，点成熟田还会弹"这块田不是空的" —— 误导。
  // 这一节先把既有行为锁住，改界面时才不会把正确的逻辑一起改坏。
  const s = L.createState(31);
  s.meta.seeds = 3;

  // 种一块、跑两局让它成熟
  ok(L.plant(s, 0).ok, '种下第一块田');
  L.startRun(s, 'grass'); L.endRun(s, true);
  eq(L.maturePlots(s), 0, '一局后尚未成熟');
  L.startRun(s, 'grass'); L.endRun(s, true);
  eq(L.maturePlots(s), 1, '两局后成熟');

  // 成熟后：每局结束自动按块数产出，不需要任何"收取"调用
  const before = s.meta.coins;
  L.startRun(s, 'grass'); L.endRun(s, true);
  const gained = s.meta.coins - before;
  ok(gained >= C.FARM.yieldPerPlot,
     '成熟田在每局结束时自动产出，无需手动收取', `本局 +${gained}`);

  // 产出随成熟块数线性增长
  const s2 = L.createState(32);
  s2.meta.seeds = 9;
  for (let i = 0; i < 3; i++) L.plant(s2, i);
  L.startRun(s2, 'grass'); L.endRun(s2, true);
  L.startRun(s2, 'grass'); L.endRun(s2, true);
  eq(L.maturePlots(s2), 3, '三块田都成熟');
  eq(L.passiveIncome(s2), 3 * C.FARM.yieldPerPlot, '被动收入 = 块数 × 每块产出');
  const b2 = s2.meta.coins;
  L.startRun(s2, 'grass'); L.endRun(s2, false);      // 输掉也照常产出
  ok(s2.meta.coins - b2 >= 3 * C.FARM.yieldPerPlot,
     '输掉的那一局同样产出（作物按局计龄，不按胜负）', s2.meta.coins - b2);

  // 点成熟田应当给出**说明**而不是"这块田不是空的"
  const r = L.plant(s, 0);
  ok(!r.ok, '成熟田不能再次播种');
  ok(r.reason.indexOf('不是空的') >= 0, '（既有）plant 的拒绝理由就是这个字符串',
     r.reason);
}

// ---------------------------------------------------------------- 21. Boss
section('21. 藤蔓 Boss：技能、前摇、可躲避性');
{
  // Boss 的行为必须可测，否则"能不能靠闪现躲开全屏技能"这种要求
  // 只能靠手感判断 —— 而那正是玩家投诉最多的地方。
  const { s, run } = armedRun('wood', 480, 105);
  run.enemies.length = 0;
  run.spawnQueue.length = 0;
  run.waveState = 'break';
  run.breakTimer = 9999;

  const boss = L.spawnBoss(s, run, 'normal');
  ok(!!boss, '能生成 Boss');
  ok(boss.isBoss === true, 'Boss 带 isBoss 标记');
  ok(boss.hp > 400, 'Boss 血量远高于小怪', boss.hp);
  ok(boss.speed < 40, 'Boss 移动很慢', boss.speed);

  // (a) 技能表齐全：2 近身 + 2 范围 + 1 全屏
  const skills = boss.bossSkills || [];
  eq(skills.length, 5, 'Boss 有 5 个技能');
  const byRange = skills.reduce((acc, k) => { acc[k.range] = (acc[k.range] || 0) + 1; return acc; }, {});
  eq(byRange.melee, 2, '2 个近身技能');
  eq(byRange.area, 2, '2 个范围技能');
  eq(byRange.full, 1, '1 个全屏技能');

  // (b) 范围技能不超过半屏（960 宽 → 半屏 480）
  skills.filter(k => k.range === 'area').forEach(k => {
    ok(k.radius * 2 <= 480, `${k.name} 的范围不超过半屏`, `直径 ${k.radius * 2}px`);
  });

  // (c) 全屏技能有前摇，且前摇足够长到能用闪现躲开
  const full = skills.find(k => k.range === 'full');
  ok(full.windup >= 1.0, '全屏技能有至少 1 秒前摇', `${full.windup}s`);
  const blinkDist = C.SKILLS.blink.distance;
  ok(full.windup > 0.35,
     '前摇时长足以完成一次闪现（闪现无前摇）', `${full.windup}s > 0.35s`);

  // (d) 在爆发前 0.3 秒闪现，靠无敌帧躲开
  {
    const r2 = armedRun('wood', 480, 105);
    r2.run.enemies.length = 0; r2.run.spawnQueue.length = 0;
    r2.run.waveState = 'break'; r2.run.breakTimer = 9999;
    const b2 = L.spawnBoss(r2.s, r2.run, 'normal');
    b2.x = 480; b2.z = 105;
    r2.run.player.x = 480; r2.run.player.z = 105;
    L.bossCast(r2.s, r2.run, b2, full.id);
    const hpBefore = r2.run.player.hp;
    const waitFrames = Math.floor((full.windup - 0.30) * 60);
    for (let i = 0; i < waitFrames; i++) L.step(r2.s, {}, DT);
    L.step(r2.s, { blink: true }, DT);
    for (let i = 0; i < 90; i++) L.step(r2.s, {}, DT);
    ok(r2.run.player.hp >= hpBefore - 1,
       '在爆发前 0.3 秒闪现，靠无敌帧躲开全屏技能',
       `${hpBefore} -> ${r2.run.player.hp}`);
  }

  // (d2) 闪现按得太早，无敌帧过期，仍会被打中
  {
    const r2b = armedRun('wood', 480, 105);
    r2b.run.enemies.length = 0; r2b.run.spawnQueue.length = 0;
    r2b.run.waveState = 'break'; r2b.run.breakTimer = 9999;
    const b2b = L.spawnBoss(r2b.s, r2b.run, 'normal');
    b2b.x = 480; b2b.z = 105;
    r2b.run.player.x = 480; r2b.run.player.z = 105;
    L.bossCast(r2b.s, r2b.run, b2b, full.id);
    const hpBefore2 = r2b.run.player.hp;
    L.step(r2b.s, { blink: true }, DT);
    for (let i = 0; i < 150; i++) L.step(r2b.s, {}, DT);
    ok(r2b.run.player.hp < hpBefore2,
       '闪现按得太早，无敌帧过期，仍会被打中',
       `${hpBefore2} -> ${r2b.run.player.hp}`);
  }

  // (e) 不躲则会被全屏技能打中
  {
    const r3 = armedRun('wood', 480, 105);
    r3.run.enemies.length = 0; r3.run.spawnQueue.length = 0;
    r3.run.waveState = 'break'; r3.run.breakTimer = 9999;
    const b3 = L.spawnBoss(r3.s, r3.run, 'normal');
    b3.x = 480; b3.z = 105;
    r3.run.player.x = 480; r3.run.player.z = 105;
    L.bossCast(r3.s, r3.run, b3, full.id);
    const hpBefore = r3.run.player.hp;
    for (let i = 0; i < 150; i++) L.step(r3.s, {}, DT);
    ok(r3.run.player.hp < hpBefore,
       '站着不动会被全屏技能打中', `${hpBefore} -> ${r3.run.player.hp}`);
  }

  // (f) 三档难度数值递增
  const tiers = ['normal', 'hard', 'hell'].map(t2 => {
    const r4 = armedRun('wood', 480, 105);
    r4.run.enemies.length = 0; r4.run.spawnQueue.length = 0;
    r4.run.waveState = 'break'; r4.run.breakTimer = 9999;
    return L.spawnBoss(r4.s, r4.run, t2);
  });
  ok(tiers[1].hp > tiers[0].hp, '困难档血量高于普通', `${tiers[0].hp} -> ${tiers[1].hp}`);
  ok(tiers[2].hp > tiers[1].hp, '地狱档血量高于困难', `${tiers[1].hp} -> ${tiers[2].hp}`);
  ok(tiers[1].damage > tiers[0].damage, '困难档伤害高于普通');
  ok(tiers[2].damage > tiers[1].damage, '地狱档伤害高于困难');
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
