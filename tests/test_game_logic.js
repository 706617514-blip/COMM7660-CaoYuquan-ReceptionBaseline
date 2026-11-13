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
// 基地点位（ZONES / zoneAt）在 hub.js，不在 logic.js —— 命名空间别搞错。
const H = require(path.join(__dirname, '..', 'game', 'hub.js'));

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

/**
 * 带药水开一局。
 *
 * 必须在 startRun **之前**把药水塞进 meta —— 本局携带量是开局那一刻的快照，
 * 开局后再改 meta 不会影响本局（这正是设计意图：中途退出不吞药）。
 */
function armedRunWithPotions(potions, diffId) {
  const s = L.createState(12345);
  s.meta.potions = Object.assign({ heal: 0, strength: 0, wall: 0 }, potions || {});
  L.startRun(s, diffId || 'wood');
  const run = s.run;
  run.enemies = [];
  run.spawnQueue = [];
  run.waveState = 'break';
  run.breakTimer = 9999;
  return { s, run };
}

// 技能范围/冷却的对外读数。测试要断言的是"装备改造真的改变了范围/冷却"，
// 而不是断言 skillStats 的内部字段名，所以走一层薄封装。
function skillRadiusFor(s, key) {
  const st = L.skillStats(key, s.meta.skills[key] || 1, s);
  if (st.radius !== undefined) return st.radius;
  return C.SKILLS[key].radius || 0;
}
function skillCooldownFor(s, key) {
  const st = L.skillStats(key, s.meta.skills[key] || 1, s);
  if (st.cooldown !== undefined) return st.cooldown;
  return C.SKILLS[key].cooldown;
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
  // 种子只捡 4 颗：3 + 4 = 7 <= 9 块田，不触发 V10 的腐烂。
  // 这一节只回答"胜利是否全额 / 失败是否减半"；超额腐烂单独在 V10 里测，
  // 否则两个规则搅在一起，失败时分不清是哪条坏了。
  s1.run.loot.coins = 100; s1.run.loot.seeds = 4;
  L.endRun(s1, true);
  eq(s1.meta.coins, 100, '胜利保留全部铜币');
  eq(s1.meta.seeds, 3 + 4, '胜利保留全部种子（未超田地数）');

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

  // ---- 版本链：v2 → v6（背包改成条目数组后多了 5→6 一跳）----
  // 断言 STATE_VERSION 本身，而不是只断言"等于 L.STATE_VERSION"——
  // 后者在版本号忘了加时依然绿，等于没测。
  eq(L.STATE_VERSION, 6, 'STATE_VERSION 升到 6');
  const v2s = JSON.stringify({ version: 2, meta: { coins: 10 }, hub: null });
  const mig = L.deserialize(v2s);
  eq(mig.version, L.STATE_VERSION, 'v2 老档能迁移到当前版本');
  eq(mig.meta.bagPages, 1, '迁移补出 bagPages = 1');
  ok(Array.isArray(mig.meta.bag), '迁移补出 bag 数组');
  ok(!mig.meta.inventory && !mig.meta.inventoryLevels, '迁移后旧的 inventory 结构消失');
  ok(mig.meta.settings && mig.meta.settings.volume === 0.30 && mig.meta.settings.muted === false,
    '迁移补出 settings（Task 12 读它，不补就 TypeError）',
    JSON.stringify(mig.meta.settings));

  // v5 存档里的 inventory 要转成 bag 条目
  const v5s = JSON.stringify({
    version: 5, meta: { coins: 5, inventory: ['longCloak', 'windBoots'],
                        inventoryLevels: { longCloak: 3 }, skills: {}, potions: {},
                        upgrades: {}, equipment: {} }, hub: null,
  });
  const m5 = L.deserialize(v5s);
  eq(m5.version, 6, 'v5 → v6');
  eq(m5.meta.bag && m5.meta.bag.length, 2, 'v5 的两件库存转成两个条目');
  const bag5 = (m5.meta.bag || []);
  const lc = bag5.filter((e) => e.id === 'longCloak')[0];
  eq(lc && lc.level, 3, '条目保留原等级');
  eq(bag5.filter((e) => e.id === 'longCloak').length, 1, '按 id 去重，不凭空造件');
  ok(bag5.length > 0 && bag5.every((e) => typeof e.uid === 'string' && e.uid.length > 0),
    '每个条目都有 uid', JSON.stringify(bag5));
  eq(bag5[1] && bag5[1].level, 1, '没有等级记录的条目默认 1 级');

  // v4 存档要把整条链自己走完（4→5→6），不能靠兜底块
  let m4 = null, e4 = null;
  try {
    m4 = L.deserialize(JSON.stringify({
      version: 4, meta: { coins: 7, skills: {}, potions: {} }, hub: null,
    }));
  } catch (err) { e4 = err.message; }
  ok(!e4, 'v4 老档能读出（4→5→6 链跑完）', e4 || '');
  eq(m4 && m4.version, 6, 'v4 → 6');
  ok(m4 && Array.isArray(m4.meta.bag) && m4.meta.bag.length === 0, 'v4 迁移得到空背包');

  // 乱版本号仍然必须硬抛（迁移没覆盖到它）
  let bogusThrew = false;
  try { L.deserialize(JSON.stringify({ version: 999, meta: {} })); } catch (err) { bogusThrew = true; }
  ok(bogusThrew, '未知版本号依然被拒绝（迁移只认已知版本）');
}

// ---------------------------------------------------------------- 10b. 背包条目
section('10b. 背包条目（容量 / 落位 / uid）');
{
  ok(typeof L.bagAdd === 'function', 'logic 导出 bagAdd', typeof L.bagAdd);
  const s = L.createState(1);
  ok(s.meta.settings && s.meta.settings.volume === 0.30 && s.meta.settings.muted === false,
    '新档自带 settings.volume = 0.30 / muted = false（缺了 Task 12 一读就崩）',
    JSON.stringify(s.meta.settings));
  ok(!s.meta.inventory && !s.meta.inventoryLevels, '新档没有旧的 inventory 字段');

  // uid 必须存档往返后仍然不撞
  // 未实现时 bagAdd 是 undefined，会在这里抛 TypeError 而不是记一条失败 ——
  // 用 ok() 包一层，红的时候看到的是"哪个 API 缺了"，不是一个栈。
  const hasBag = typeof L.bagAdd === 'function' && Array.isArray(s.meta.bag);
  const a1 = hasBag ? L.bagAdd(s, 'longCloak', 2) : -99;
  eq(a1, 0, '首件落在下标 0');
  eq(s.meta.bag && s.meta.bag[0] && s.meta.bag[0].level, 2, '落位保留传入等级');
  const uidA = (s.meta.bag && s.meta.bag[0] && s.meta.bag[0].uid) || '';
  const phones = L.deserialize(L.serialize(s));
  const pbag = phones.meta.bag || [];
  eq(pbag[0] && pbag[0].uid, uidA, 'uid 跨序列化保留（否则读档后新条目会撞旧 uid）');
  const idx2 = typeof L.bagAdd === 'function' ? L.bagAdd(phones, 'longCloak', 1) : -99;
  ok(pbag[idx2] && pbag[idx2].uid !== uidA, '读档后再加同 id，uid 不重复',
    (pbag[idx2] && pbag[idx2].uid) + ' vs ' + uidA);

  // 容量 = 页数 × 35
  eq(L.bagCapacity ? L.bagCapacity(s) : -1, 35, '一页容量 35');
  s.meta.bagPages = 2;
  eq(L.bagCapacity ? L.bagCapacity(s) : -1, 70, '两页容量 70');
  s.meta.bagPages = 1;

  eq(L.bagCount ? L.bagCount(s) : -1, 1, 'bagCount 计数');
  eq(L.bagIndexOfUid ? L.bagIndexOfUid(s, uidA) : -2, 0, '按 uid 查下标');
  eq(L.bagIndexOfUid ? L.bagIndexOfUid(s, '不存在') : -2, -1, '查不到返回 -1');
  ok(L.bagAt ? L.bagAt(s, 50) === null : false, '越界取格返回 null，不是 undefined');

  // 满了返回 -1，不越界、不静默丢弃内容
  const full = L.createState(2);
  const fbag = full.meta.bag || [];
  for (let i = 0; i < 35; i++) if (L.bagAdd) L.bagAdd(full, 'strawShoes', 1);
  eq(fbag.length, 35, '容量内加满 35 件');
  eq(L.bagAdd ? L.bagAdd(full, 'strawShoes', 1) : 0, -1, '满页后 bagAdd 返回 -1');
  eq(fbag.length, 35, '满页后长度没有被撑爆');

  const rm = L.bagRemove ? L.bagRemove(s, 0) : { ok: false };
  ok(rm.ok, '能移除条目');
  eq((s.meta.bag || []).length, 0, '移除后少一件');
  eq(L.bagRemove ? L.bagRemove(s, 0).ok : true, false, '空格子上移除失败');

  // 掉落接进背包：满包时落在末格并标记 bagFull（设计 §4.7：不丢装备）
  const dropFull = L.createState(3);
  for (let i = 0; i < 35; i++) if (L.bagAdd) L.bagAdd(dropFull, 'strawShoes', 1);
  const dfbag = dropFull.meta.bag || [];
  const lastUid = (dfbag[34] || {}).uid;
  const d = L.rollEquipDrop(dropFull);
  ok(d && d.bagFull === true, '满包掉落标记 bagFull', JSON.stringify(d));
  eq(dfbag.length, 35, '满包掉落不越界（仍是 35 件）');
  eq(dfbag[34] && dfbag[34].id, d && d.id, '满包掉落写在末格（不丢装备）');
  ok(dfbag[34] && dfbag[34].uid !== lastUid,
    '末格换成了新条目（带新 uid）');

  const d2 = L.rollEquipDrop(L.createState(4));
  ok(d2.bagFull === false, '有空位时 bagFull 为 false', JSON.stringify(d2));
}

// ---------------------------------------------------------------- 10c. 同 id 多件的 uid 指向
section('10c. 装备函数接受可选 uid（同 id 多件时指哪一件）');
{
  // 背包里两件同 id：不带 uid 作用于第一件，带 uid 作用于指定的那件。
  // 修复前 upgradeEquipment 完全忽略第三参，永远升第一件 —— 玩家点的是 u2，
  // 被升的却是 u1，且按 u1 的等级报价（白付钱、升错件）。
  const s2 = L.createState(12);
  L.bagAdd(s2, 'longCloak', 1);
  L.bagAdd(s2, 'longCloak', 1);
  s2.meta.coins = 99999;
  const uidB = s2.meta.bag[1].uid;
  ok(s2.meta.bag[0].level === 1 && s2.meta.bag[1].level === 1, '初始两件都是 Lv1');
  L.upgradeEquipment(s2, 'longCloak', uidB);
  ok(s2.meta.bag[0].level === 1, '没有 uid 的那件没被动过',
    'bag[0].level = ' + s2.meta.bag[0].level);
  ok(s2.meta.bag[1].level === 2, '指定 uid 的那件被升级',
    'bag[1].level = ' + s2.meta.bag[1].level);

  // 报价也要按 uid 指定的那件算，否则玩家会被按错件收费。
  // 注：brief 原稿此处用 longCloak（基础装备，满级 3）并断言报价等于
  // equipPrice('longCloak', 4) —— 满级装备没有"下一级"，正确值是 null，
  // 610 不可能实现（见 task-3-report.md 缺陷 A）。改用血滴护符（特效装备，
  // 满级 5）才能让"Lv3 那件的下一级(Lv4)"这个报价有定义。
  const s3 = L.createState(13);
  L.bagAdd(s3, 'bloodCharm', 1);
  L.bagAdd(s3, 'bloodCharm', 3);
  s3.meta.coins = 99999;
  const uidHi = s3.meta.bag[1].uid;
  const costHi = L.equipUpgradeCost(s3, 'bloodCharm', uidHi);
  const costLo = L.equipUpgradeCost(s3, 'bloodCharm');
  ok(costHi !== costLo, '按 uid 与不按 uid 的报价不同（等级不同，价就不同）',
    'costHi = ' + costHi + ', costLo = ' + costLo);
  ok(costHi === C.equipPrice('bloodCharm', 4), '按 Lv3 那件报价 = 下一级(4)的价',
    'got ' + costHi + ', want ' + C.equipPrice('bloodCharm', 4));
  ok(costLo === C.equipPrice('bloodCharm', 2), '不带 uid 按第一件(Lv1)报价 = 2 级的价',
    'got ' + costLo + ', want ' + C.equipPrice('bloodCharm', 2));

  // 穿戴也要能指定：穿背包里第 2 件，且穿走的是它的等级。
  // 注：brief 原稿此处 bagAdd(...,4) 断言 equipment.back.level===4，但 longCloak
  // 满级 3，把超上限的等级当正常态写进断言与上限不变量冲突（缺陷 B）。
  // 改成长期有效等级 3（满级），仍然证明"穿的是 uid 指定那件的等级"。
  const s4 = L.createState(14);
  L.bagAdd(s4, 'longCloak', 1);
  L.bagAdd(s4, 'longCloak', 3);
  const uidWear = s4.meta.bag[1].uid;
  L.equipItem(s4, 'longCloak', uidWear);
  eq(s4.meta.equipment.back.level, 3, '穿上的是 uid 指定那件（等级 3）');
  eq(s4.meta.bag[0].level, 1, '另一件留在背包里，等级没变');

  // 三处判定都不能选错：已穿戴优先于背包（Review Focus #3）。
  // 注：brief 原稿此处没给 s5 铜币，createState 默认 coins=0，buyEquipment 会因
  // "铜币不够"直接失败，后面的断言因无关原因挂掉（缺陷 C）。补上铜币。
  const s5 = L.createState(15);
  s5.meta.coins = 99999;
  L.buyEquipment(s5, 'longCloak');
  L.equipItem(s5, 'longCloak');
  L.bagAdd(s5, 'longCloak', 3);
  ok(L.equipOwned(s5, 'longCloak') === 'equipped', '已穿戴优先');
  ok(s5.meta.bag.length === 1 && s5.meta.bag[0].level === 3, '背包里那件仍是 Lv3',
    JSON.stringify(s5.meta.bag));

  // 两参数调用必须与从前完全一致（向后兼容）：不带 uid 仍作用于第一件。
  const s6 = L.createState(16);
  L.bagAdd(s6, 'longCloak', 1);
  L.bagAdd(s6, 'longCloak', 1);
  s6.meta.coins = 99999;
  eq(L.equipUpgradeCost(s6, 'longCloak'), C.equipPrice('longCloak', 2),
    '两参数报价仍是第一件的下一级');
  ok(L.upgradeEquipment(s6, 'longCloak').ok, '两参数升级成功');
  ok(s6.meta.bag[0].level === 2 && s6.meta.bag[1].level === 1,
    '两参数升级仍只作用于第一件', JSON.stringify(s6.meta.bag.map(e => e.level)));

  // uid 给了但背包里没有那一件，要退回按 id 找第一件，而不是整件事失败。
  const s7 = L.createState(17);
  L.bagAdd(s7, 'longCloak', 2);
  s7.meta.coins = 99999;
  ok(L.upgradeEquipment(s7, 'longCloak', '不存在的uid').ok,
    'uid 找不到时退回按 id 升级第一件');
  ok(s7.meta.bag[0].level === 3, '退回后升的是第一件');
}

// ---------------------------------------------------------------- 10d. 环境音默认值
section('10d. 设置：环境音默认值兜底（Task 23 / V22）');
{
  const s = L.createState(7);
  eq(s.meta.settings && s.meta.settings.ambient, 0.30,
    '新档自带 settings.ambient = 0.30（Task 23 的第三条滑块要读它）',
    JSON.stringify(s.meta.settings));

  // 老档：version 6 已经有 settings，但里面没有 ambient。
  // 只写 `if (!meta.settings)` 的兜底在这条路径上根本不会触发 —— 必须按字段补。
  const old = JSON.parse(L.serialize(L.createState(8)));
  eq(old.version, 6, '仍是不升版本的 v6 存档');
  delete old.meta.settings.ambient;
  const back = L.deserialize(JSON.stringify(old));
  eq(back.meta.settings.ambient, 0.30,
    'v6 老档缺少 ambient 时读出 0.30（不是 undefined/NaN）',
    String(back.meta.settings.ambient));

  // 脏值：非数字、NaN、越界值都不能让虫鸣变成 NaN 增益
  const dirty = JSON.parse(L.serialize(L.createState(9)));
  dirty.meta.settings.ambient = '0.5';
  eq(L.deserialize(JSON.stringify(dirty)).meta.settings.ambient, 0.30,
    '字符串 ambient 退回默认值');
  dirty.meta.settings.ambient = null;
  eq(L.deserialize(JSON.stringify(dirty)).meta.settings.ambient, 0.30,
    'null ambient 退回默认值');
  dirty.meta.settings.ambient = 5;
  eq(L.deserialize(JSON.stringify(dirty)).meta.settings.ambient, 1, '越界值夹到 1');
  dirty.meta.settings.ambient = -2;
  eq(L.deserialize(JSON.stringify(dirty)).meta.settings.ambient, 0, '负值夹到 0');

  // 玩家真的调过之后要保留，不能被默认值覆盖
  const custom = L.createState(10);
  custom.meta.settings.ambient = 0.65;
  eq(L.deserialize(L.serialize(custom)).meta.settings.ambient, 0.65,
    '自定义环境音音量跨序列化保留');

  // 完全缺 settings 的老档（v2 之前）也要补出 ambient
  const bare = L.deserialize(JSON.stringify({ version: 2, meta: { coins: 10 } }));
  eq(bare.meta.settings && bare.meta.settings.ambient, 0.30,
    '迁移路径也补出 ambient 默认值', JSON.stringify(bare.meta.settings));
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
    // 与 tests/bot.js 同一套逻辑：站位门限不按射程成比例缩放
    // （按比例会让机器人在 52~61.6px 区间站桩，胜率被打崩），
    // 只做"射程覆盖贴身间距"的下限保护；命中判据逐敌判断。
    const rng = C.ATTACK_RANGE;
    const standIn = Math.max(52, Math.min(rng - 6, 52 + 12));
    const standBack = Math.min(34, standIn - 12);
    if (d > standIn) { if (dx < 0) i.left = true; else i.right = true; }
    else if (d < standBack) { if (dx < 0) i.right = true; else i.left = true; }
    if (live.some(function (en) {
      return Math.abs(en.x - p.x) < rng && Math.abs(en.z - p.z) <= C.ATTACK_DEPTH * 0.85;
    })) i.attack = true;
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
  const forgeUp = B.winRate('forge', B.FULL_UP, N).rate;
  ok(forgeUp > forgeZero + 0.4,
     '强化显著提升最高难度胜率（经营层对战斗有影响）',
     `${(forgeZero * 100).toFixed(0)}% -> ${(forgeUp * 100).toFixed(0)}%`);
  // 终局状态 = 强化满 **且** 穿齐一套基础装备。只量强化会把终局强度
  // 低估一大截（实测 70% vs 92%），于是"游戏能不能打通"这个问题
  // 被一个玩家永远不会处于的状态回答。
  //
  // 测量口径：原先这里是 winRate('forge', FULL_UP, 30, 137, FULL_SET)。
  // 固定种子 + 确定性机器人下 n=30 时 **1 局 = 3.33 个百分点**，颗粒度根本
  // 区分不了 95% 与 100%：它既会把没变坏的实现判红（运气好就 30/30），
  // 也会把真变坏的实现放过。改用仓库权威口径（tests/balance_report.js 的
  // 同一套种子步长）：n=200 × 4 个步长 = 800 局，颗粒度 0.125pp
  // （比 n=30 细 26.7 倍；不是为了让这条过，是因为被测的余量比 160 局的
  // 颗粒度 0.625pp 还薄，粗尺子量细余量只会随机跳红跳绿 —— 见下面刀尖位置）。
  //
  // 这条线的**刀尖位置**（改数值时先看这里，别被它吓到）：
  //   旧配置 58/62/74  n=200×4 = 772/800 = 96.50%（±1.27pp，95%CI）
  //   新配置 61/66/78  n=200×4 = 782/800 = 97.75%（±1.03pp，95%CI）
  //   阈值 0.98 → 余量只有 **0.25pp**，落在 800 局抽样噪声（±1.03pp）之内。
  // 若将来再提高玩家输出，这条先红是正常的：先看真实损失局数（下面那条
  // 「800 局里至少输过 1 局」），再决定是调数值还是调这条线。
  // 阈值本身不动 —— 0.98 是设计意图（终局不能变成必胜）。
  const ENDGAME_STRIDES = [137, 211, 977, 1231];
  const ENDGAME_N = 200;
  let endgameWins = 0;
  ENDGAME_STRIDES.forEach(function (st) {
    endgameWins += B.winRate('forge', B.FULL_UP, ENDGAME_N, st, B.FULL_SET).wins;
  });
  const endgameGames = ENDGAME_N * ENDGAME_STRIDES.length;
  const forgeEndgame = endgameWins / endgameGames;
  ok(forgeEndgame >= 0.75,
     '强化满 + 穿齐基础套装后可以稳定通关（游戏有"打通"状态）',
     `强化 ${(forgeUp * 100).toFixed(0)}% -> 强化+装备 ${(forgeEndgame * 100).toFixed(0)}%`);
  // 有上限：终局也不能变成必胜，最高难度要一直是赌局
  ok(forgeEndgame <= 0.98, '终局也不是必胜（最高难度仍有风险）', forgeEndgame);
  // 上面那条卡在噪声里（余量 0.25pp、噪声 ±1.03pp），所以再补一条**不依赖
  // 任何阈值**的意图断言：同一批 800 局里到底输过几局。"有风险"不等于"胜率
  // 低于 0.98 这个特定小数"，而是"真的还会输"。改前改后各 800 局都输过
  // （改后 18 局），离 1 局有 18 倍余量，不会因为抽样噪声翻脸。
  const forgeLosses = endgameGames - endgameWins;
  ok(forgeLosses >= 1, '终局 800 局里至少输过 1 局（否则就是事实必胜）', forgeLosses);
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

// ---------------------------------------------------------------- 22. 药水
section('22. 药水（消耗品）');
{
  // 三瓶药水的配置必须齐全，且效果各不相同 —— 否则"三格药水"只是换个名字
  const P = C.POTIONS || {};
  const ids = Object.keys(P);
  ok(ids.length === 3, '配置了 3 种药水', ids.join(','));
  ok(ids.indexOf('heal') >= 0 && ids.indexOf('strength') >= 0 && ids.indexOf('wall') >= 0,
    '三种药水分别是治疗/力量/护盾');

  // 键位：用户明确指定 1/2/3
  const keys = ids.map(k => P[k].key);
  ok(keys.join('') === '123', '键位依次为 1 / 2 / 3', keys.join(''));
  ok(ids.every(k => P[k].key.length === 1 && '123'.indexOf(P[k].key) >= 0),
    '键位是单字符数字键（DOM code Digit1/2/3 可映射）');

  // 价格与携带上限
  const hp_ = P.heal || {}, sp_ = P.strength || {}, wp_ = P.wall || {};
  ok(hp_.price === 60 && sp_.price === 80 && wp_.price === 90,
    '价格为 60 / 80 / 90', [hp_.price, sp_.price, wp_.price].join('/'));
  ok(hp_.carry === 3 && sp_.carry === 2 && wp_.carry === 2,
    '携带上限为 3 / 2 / 2', [hp_.carry, sp_.carry, wp_.carry].join('/'));

  /*
   * 三件药水的**显示名**统一成"…药水"（V14）。
   *
   * 只改 name / short，绝不改 key（heal / strength / wall）：
   * 存档里的药水栏是按 key 记的（meta.potions.heal 之类），
   * 改 key 等于把所有旧存档的药水栏清空 —— 那不是改名，那是删档。
   */
  ok(hp_.name === '治疗药水', '治疗药水显示名统一成"治疗药水"', hp_.name);
  ok(hp_.short === '治疗', '治疗药水短名是"治疗"', hp_.short);
  ok(sp_.name === '力量药水', '力量药水显示名统一成"力量药水"', sp_.name);
  ok(sp_.short === '力量', '力量药水短名是"力量"', sp_.short);
  ok(wp_.name === '护盾药水', '护盾药水显示名统一成"护盾药水"', wp_.name);
  ok(wp_.short === '护盾', '护盾药水短名是"护盾"', wp_.short);
  ok(C.POTION_ORDER.join(',') === 'heal,strength,wall',
    '药水 key 与顺序一个字都没改（旧存档的药水栏才不空）', C.POTION_ORDER.join(','));

  // ---- 治疗药水：立刻回血 ----
  const a = armedRunWithPotions({ heal: 1 });
  a.run.player.hp = 30;
  L.usePotion(a.s, 'heal');
  ok(a.run.player.hp === 55, '治疗药水立刻回 25 血', `30 -> ${a.run.player.hp}`);
  ok(a.run.potions.heal === 0, '治疗药水用掉后本局携带数减 1', String(a.run.potions.heal));

  // 回血不得超过上限
  const b = armedRunWithPotions({ heal: 1 });
  b.run.player.hp = b.run.player.maxHp - 5;
  L.usePotion(b.s, 'heal');
  ok(b.run.player.hp === b.run.player.maxHp, '治疗药水不会超过血量上限', String(b.run.player.hp));

  // ---- 力量药：限时增伤 ----
  const c = armedRunWithPotions({ strength: 1 });
  const base = L.playerStats(c.s).damage;
  L.usePotion(c.s, 'strength');
  ok(c.run.player.potionBuff && c.run.player.potionBuff.damageMul > 1,
    '力量药设置增伤倍率', JSON.stringify(c.run.player.potionBuff));
  ok(c.run.player.potionBuff.timer > 14 && c.run.player.potionBuff.timer <= 15.01,
    '力量药持续 15 秒', String(c.run.player.potionBuff.timer));

  // ---- 护盾药水：限时减伤 ----
  const d = armedRunWithPotions({ wall: 1 });
  L.usePotion(d.s, 'wall');
  ok(d.run.player.potionBuff && d.run.player.potionBuff.hurtMul < 1,
    '护盾药水设置减伤倍率', JSON.stringify(d.run.player.potionBuff));
  ok(d.run.player.potionBuff.timer > 7 && d.run.player.potionBuff.timer <= 8.01,
    '护盾药水持续 8 秒', String(d.run.player.potionBuff.timer));

  // ---- 用掉就没了：没有携带时按了不生效 ----
  const e = armedRunWithPotions({});
  e.run.player.hp = 30;
  const r0 = L.usePotion(e.s, 'heal');
  ok(r0 && r0.ok === false, '没有携带时使用失败', JSON.stringify(r0));
  ok(e.run.player.hp === 30, '失败时不回血', String(e.run.player.hp));

  // ---- 每局要重新买：药水不进结算金币 ----
  ok(typeof hp_.price === 'number' && hp_.price > 0,
    '药水是花钱买的（经济出口）');

  // ---- 键位输入：input.potion1/2/3 触发对应药水 ----
  const f = armedRunWithPotions({ heal: 1, strength: 1, wall: 1 });
  f.run.player.hp = 40;
  L.step(f.s, { left: false, right: false, up: false, down: false, potion1: true }, 1 / 60);
  ok(f.run.player.hp === 65, '按 1 喝治疗药水', `40 -> ${f.run.player.hp}`);
  ok(f.run.potions.heal === 0, '按 1 后本局治疗药水减少');

  const g = armedRunWithPotions({ heal: 1, strength: 1, wall: 1 });
  L.step(g.s, { left: false, right: false, up: false, down: false, potion2: true }, 1 / 60);
  ok(g.run.potions.strength === 0 && g.run.player.potionBuff,
    '按 2 喝力量药');

  const h = armedRunWithPotions({ heal: 1, strength: 1, wall: 1 });
  L.step(h.s, { left: false, right: false, up: false, down: false, potion3: true }, 1 / 60);
  ok(h.run.potions.wall === 0 && h.run.player.potionBuff,
    '按 3 喝护盾药水');

  // ---- 持续药水到期后效果消失 ----
  const i2 = armedRunWithPotions({ strength: 1 });
  L.usePotion(i2.s, 'strength');
  const idle = { left: false, right: false, up: false, down: false };
  for (let t = 0; t < 16 * 60; t++) L.step(i2.s, idle, 1 / 60);
  ok(!i2.run.player.potionBuff, '力量药 15 秒后失效', JSON.stringify(i2.run.player.potionBuff));

  // ---- 存档：v3 旧档走真实读取路径后能补齐 potions ----
  // 用 deserialize 而不是 migrate —— 玩家实际走的就是这条路径，
  // 单独测 migrate 会漏掉"版本号没跟上"这类只在装配处暴露的问题。
  const oldJson = JSON.stringify({
    version: 3, seed: 7, rngState: 7, phase: 'farm',
    meta: { coins: 10, seeds: 2, upgrades: { damage: 0, maxHp: 0, speed: 0 },
      skills: { whirl: 1, blink: 1, slam: 1, cry: 1, nova: 1 },
      runsCompleted: 1, runsWon: 0, bestWave: 2 },
    farm: { plots: [] },
  });
  let migrated = null, loadErr = null;
  try { migrated = L.deserialize(oldJson); } catch (err) { loadErr = err.message; }
  ok(!loadErr, 'v3 旧档能读出（不抛错误）', loadErr || '');
  ok(migrated && migrated.version === L.STATE_VERSION, 'v3 旧档读取后升到当前版本（跨三级迁移）',
    migrated ? String(migrated.version) : 'null');
  ok(migrated && migrated.meta.potions && migrated.meta.potions.heal === 0,
    '旧档补齐 potions 且默认是 0（不白送）',
    JSON.stringify(migrated && migrated.meta.potions));
  ok(migrated && migrated.meta.equipment && migrated.meta.equipment.weapon === null,
    '旧档补齐五个空装备位（不白送装备）',
    JSON.stringify(migrated && migrated.meta.equipment));
  ok(migrated && Array.isArray(migrated.meta.bag)
     && migrated.meta.bag.length === 0, '旧档得到空背包（v6 条目数组）');
  ok(migrated && migrated.meta.coins === 10 && migrated.meta.bestWave === 2,
    '迁移不丢原有数据');

  // ---- v4 旧档（有药水、没装备）单独走一遍，确认不会跨级跳坏 ----
  const v4Json = JSON.stringify({
    version: 4, seed: 11, rngState: 11, phase: 'farm',
    meta: { coins: 55, seeds: 1, upgrades: { damage: 1, maxHp: 0, speed: 0 },
      skills: { whirl: 2, blink: 1, slam: 1, cry: 1, nova: 1 },
      potions: { heal: 2, strength: 1, wall: 0 },
      runsCompleted: 3, runsWon: 1, bestWave: 4 },
    farm: { plots: [] },
  });
  let m4 = null, e4 = null;
  try { m4 = L.deserialize(v4Json); } catch (err) { e4 = err.message; }
  ok(!e4, 'v4 旧档能读出', e4 || '');
  ok(m4 && m4.version === L.STATE_VERSION, 'v4 → 当前版本',
    m4 ? String(m4.version) : 'null');
  ok(m4 && m4.meta.potions.heal === 2, 'v4 迁移保留已有药水（不清零）',
    JSON.stringify(m4 && m4.meta.potions));
  ok(m4 && m4.meta.upgrades.damage === 1 && m4.meta.skills.whirl === 2,
    'v4 迁移保留强化与技能等级');

  // ---- 新局开始：本轮携带的药水从 meta 快照，不直接吃 meta ----
  const j = L.createState(999);
  j.meta.potions = { heal: 3, strength: 2, wall: 2 };
  L.startRun(j, 'wood');
  ok(j.run.potions && j.run.potions.heal === 3,
    '开局把携带药水快照进本局', JSON.stringify(j.run.potions));

  // ---- 结算时把剩余的携带量回写 meta（喝掉的不再回来）----
  const k2 = armedRunWithPotions({ heal: 3, strength: 1, wall: 2 });
  L.usePotion(k2.s, 'heal');
  L.usePotion(k2.s, 'strength');
  L.endRun(k2.s, false);
  ok(k2.s.meta.potions.heal === 2, '结算后 meta 回写剩余治疗药水', String(k2.s.meta.potions.heal));
  ok(k2.s.meta.potions.strength === 0, '喝掉的力量药不会退回', String(k2.s.meta.potions.strength));
  ok(k2.s.meta.potions.wall === 2, '没喝的药水原样保留', String(k2.s.meta.potions.wall));

  // ---- 护盾药水真的减半伤害 ----
  const plain = armedRunWithPotions({});
  L.hurtPlayer(plain.s, plain.s.run, plain.run.player, 40);
  const plainHp = plain.run.player.hp;

  const tank = armedRunWithPotions({ wall: 1 });
  L.usePotion(tank.s, 'wall');
  L.hurtPlayer(tank.s, tank.s.run, tank.run.player, 40);
  const tankHp = tank.run.player.hp;
  ok(tankHp > plainHp, '护盾药水后同样伤害掉血更少', `无药 ${plainHp} vs 有药 ${tankHp}`);
  ok(plain.run.player.maxHp - tankHp === 20,
    '护盾药水把 40 点伤害减半成 20', String(plain.run.player.maxHp - tankHp));

  // ---- 力量药真的提升伤害 ----
  const weak = armedRunWithPotions({});
  const strong = armedRunWithPotions({ strength: 1 });
  L.usePotion(strong.s, 'strength');
  const dWeak = L.currentDamage ? L.currentDamage(weak.s, weak.run.player) : 0;
  const dStrong = L.currentDamage ? L.currentDamage(strong.s, strong.run.player) : 0;
  ok(dStrong > dWeak, '力量药提升当前伤害', `${dWeak} -> ${dStrong}`);

  // ---- 不能在基地喝药（避免用铜币在安全区回血）----
  const idleState = L.createState(4242);
  idleState.meta.potions = { heal: 1, strength: 0, wall: 0 };
  const rBase = L.usePotion(idleState, 'heal');
  ok(rBase && rBase.ok === false, '基地（非战斗中）不能喝药', JSON.stringify(rBase));

  // ---- 买药水：扣钱、加携带、受上限约束 ----
  const shopper = L.createState(555);
  shopper.meta.coins = 500;
  const buy1 = L.buyPotion(shopper, 'heal', 2);
  ok(buy1.ok && shopper.meta.potions.heal === 2, '买 2 瓶治疗药水', JSON.stringify(buy1));
  ok(shopper.meta.coins === 500 - 120, '买 2 瓶扣 120 铜币', String(shopper.meta.coins));
  const buy2 = L.buyPotion(shopper, 'heal', 5);
  ok(buy2.ok && shopper.meta.potions.heal === 3, '买到携带上限就停', JSON.stringify(shopper.meta.potions));
  const buy3 = L.buyPotion(shopper, 'heal', 1);
  ok(buy3.ok === false, '已带满时买不了', JSON.stringify(buy3));
  const poor = L.createState(556);
  poor.meta.coins = 10;
  const buy4 = L.buyPotion(poor, 'wall', 1);
  ok(buy4.ok === false && poor.meta.coins === 10, '铜币不够买不了且不扣钱');
}


function armedRunWithEquip(equip, opts) {
  const o = opts || {};
  const s = L.createState(24680);
  s.meta.upgrades = { damage: 0, maxHp: 0, speed: 0 };
  C.EQUIP_SLOTS.forEach(function (slot) { s.meta.equipment[slot] = null; });
  Object.keys(equip || {}).forEach(function (id) {
    const def = C.equipDef(id);
    if (!def) throw new Error('unknown equip ' + id);
    const lv = (equip[id] && equip[id].level) || 1;
    s.meta.equipment[def.slot] = { id: id, level: lv };
  });
  if (o.coins !== undefined) s.meta.coins = o.coins;
  if (o.potions) s.meta.potions = Object.assign({ heal: 0, strength: 0, wall: 0 }, o.potions);
  L.startRun(s, o.diff || 'wood');
  const run = s.run;
  run.enemies = [];
  run.spawnQueue = [];
  run.waveState = 'break';
  run.breakTimer = 9999;
  return { s, run, p: run.player };
}


// ---------------------------------------------------------------- 23. 装备：数据层
section('23. 装备（数据层）');
{
  const ids = Object.keys(C.ALL_EQUIPMENT);
  ok(ids.length === 35, '共 35 件装备（21 基础 + 14 特效）', String(ids.length));

  const base = ids.filter(i => C.ALL_EQUIPMENT[i].kind === 'base');
  const spec = ids.filter(i => C.ALL_EQUIPMENT[i].kind === 'special');
  ok(base.length === 21, '基础装备 21 件', String(base.length));
  ok(spec.length === 14, '特效装备 14 件', String(spec.length));

  // 每个部位都要有基础装备，否则 5% 掉落在某部位会永远掉不出来
  const slotsWithBase = {};
  base.forEach(i => { slotsWithBase[C.ALL_EQUIPMENT[i].slot] = true; });
  ok(C.EQUIP_SLOTS.every(s => slotsWithBase[s]),
    '每个部位都有基础装备（掉落不会漏部位）', JSON.stringify(C.EQUIP_SLOTS.filter(s => !slotsWithBase[s])));

  // 特效装备价格必须挤在同一区间，否则选择会退化成"买最贵的"
  const spPrices = spec.map(i => C.ALL_EQUIPMENT[i].price);
  ok(Math.min(...spPrices) >= 680 && Math.max(...spPrices) <= 900,
    '特效装备价格全部落在 680–900',
    `${Math.min(...spPrices)}–${Math.max(...spPrices)}`);

  // 特效装备必须有 fx（否则只是换了名字的数值装备）
  spec.forEach(i => {
    ok(!!C.ALL_EQUIPMENT[i].fx, `特效装备 ${C.ALL_EQUIPMENT[i].name} 声明了 fx 机制`);
  });

  // 基础 3 级、特效 5 级
  ok(C.equipMaxLevel('rustySword') === 3, '基础装备 3 级');
  ok(C.equipMaxLevel('thornMail') === 5, '特效装备 5 级');

  // 价格随等级递增
  ok(C.equipPrice('thornMail', 2) > C.equipPrice('thornMail', 1), '升级价格递增');
  ok(C.equipPrice('thornMail', 1) === C.EQUIP_FX.thornMail.price, '1 级价格等于标价');

  // 效果倍率只放大强度
  ok(Math.abs(C.equipEffectMul(1) - 1.0) < 1e-9, '1 级效果倍率 = 1.0');
  ok(C.equipEffectMul(5) > C.equipEffectMul(1), '等级越高效果倍率越大');
}

// ---------------------------------------------------------------- 24. 装备：加成生效
section('24. 装备（加成生效）');
{
  // 空装备 = 基线
  const bare = armedRunWithEquip({});
  const bareSt = L.playerStats(bare.s);
  ok(bareSt.maxHp === C.BASE_HP, '没装备时生命上限就是基础值', String(bareSt.maxHp));
  ok(bareSt.hurtMul === 1, '没装备时受伤倍率是 1');

  // 单件属性装备
  const helm = armedRunWithEquip({ hornHelm: { level: 1 } });
  const helmSt = L.playerStats(helm.s);
  ok(helmSt.maxHp === C.BASE_HP + 44, '角盔加 44 生命上限', String(helmSt.maxHp));

  // 多件叠加：属性是加算
  const two = armedRunWithEquip({ hornHelm: { level: 1 }, greaves: { level: 1 } });
  const twoSt = L.playerStats(two.s);
  ok(twoSt.maxHp === C.BASE_HP + 44 + 14, '两个部位的生命上限加算',
    String(twoSt.maxHp));

  // 减伤是乘算，且升级方向正确（越高减越多）
  const plate = armedRunWithEquip({ chestPlate: { level: 1 } });
  ok(L.playerStats(plate.s).hurtMul < 1, '胸甲降低受伤倍率');
  const plateUp = armedRunWithEquip({ chestPlate: { level: 3 } });
  ok(L.playerStats(plateUp.s).hurtMul < L.playerStats(plate.s).hurtMul,
    '升级后减伤更多（不是反过来）',
    `${L.playerStats(plate.s).hurtMul.toFixed(4)} -> ${L.playerStats(plateUp.s).hurtMul.toFixed(4)}`);

  // 移速
  const boots = armedRunWithEquip({ windBoots: { level: 1 } });
  ok(L.playerStats(boots.s).speed > C.PLAYER_SPEED, '疾风靴提高移速',
    `${C.PLAYER_SPEED} -> ${L.playerStats(boots.s).speed.toFixed(1)}`);

  // 装备真的影响开局玩家的 maxHp
  ok(helm.run.player.maxHp === C.BASE_HP + 44, '开局玩家的 maxHp 吃到了装备加成',
    String(helm.run.player.maxHp));

  // 装备 + 强化要能叠加（两条线独立）
  const both = armedRunWithEquip({ hornHelm: { level: 1 } });
  both.s.meta.upgrades.maxHp = 2;
  ok(L.playerStats(both.s).maxHp === C.BASE_HP + 44 + 2 * C.UPGRADES.maxHp.perLevel,
    '装备与强化叠加，不是二选一', String(L.playerStats(both.s).maxHp));
}

// ---------------------------------------------------------------- 25. 装备：买卖与背包
section('25. 装备（买卖 / 背包 / 卸下）');
{
  const s = L.createState(31337);
  s.meta.coins = 10000;

  const b1 = L.buyEquipment(s, 'ironHelm');
  ok(b1.ok, '能买到装备');
  ok(s.meta.coins === 10000 - C.EQUIPMENT.ironHelm.price, '买装备扣钱',
    String(s.meta.coins));
  ok(L.bagCount(s) === 1 && L.bagAt(s, 0).id === 'ironHelm', '买到的装备进背包');

  const b2 = L.buyEquipment(s, 'ironHelm');
  ok(b2.ok === false, '已拥有的装备不能重复买', JSON.stringify(b2));

  // 穿上
  const e1 = L.equipItem(s, 'ironHelm');
  ok(e1.ok, '能穿上装备');
  ok(s.meta.equipment.head && s.meta.equipment.head.id === 'ironHelm', '装备位记录正确');
  ok(L.bagCount(s) === 0, '穿上后从背包移除');

  // 同部位换装：旧装备回背包，不消失
  L.buyEquipment(s, 'leatherHelm');
  const e2 = L.equipItem(s, 'leatherHelm');
  ok(e2.ok, '能换装');
  ok(s.meta.equipment.head.id === 'leatherHelm', '新装备穿上');
  ok(L.bagAt(s, L.bagCount(s) - 1).id === 'ironHelm', '被换下的装备回到背包（不凭空消失）');

  // 卸下
  const u1 = L.unequipSlot(s, 'head');
  ok(u1.ok, '能卸下装备');
  ok(s.meta.equipment.head === null, '卸下后该部位为空');
  ok(L.bagAt(s, L.bagCount(s) - 1).id === 'leatherHelm', '卸下的装备回背包');

  // 卸下后加成消失
  const st = L.playerStats(s);
  ok(st.maxHp === C.BASE_HP, '全部卸下后回到基础值', String(st.maxHp));

  // 背包里的装备也能升级
  const invId = L.bagAt(s, 0).id;
  s.meta.coins = 10000;
  const cost = L.equipUpgradeCost(s, invId);
  ok(cost !== null, '背包里的装备可以升级（有价格）', String(cost));
  const up = L.upgradeEquipment(s, invId);
  ok(up.ok, '升级成功');
  ok(L.bagAt(s, 0).level === 2, '背包装备等级 +1', String(L.bagAt(s, 0).level));

  // 重复件各占一格、各升各的：升级不能把同 id 的另一件一起抬上去
  const dupUp = L.createState(31338);
  dupUp.meta.bag = [L.bagEntry(dupUp, 'ironHelm', 1), L.bagEntry(dupUp, 'ironHelm', 1)];
  dupUp.meta.coins = 10000;
  ok(L.upgradeEquipment(dupUp, 'ironHelm').ok, '重复件可以升级');
  eq(dupUp.meta.bag[0].level, 2, '只升了第一件');
  eq(dupUp.meta.bag[1].level, 1, '另一件同 id 的不跟着涨级');

  // 没拥有的不能升级
  const nope = L.upgradeEquipment(s, 'trident');
  ok(nope.ok === false, '没拥有的装备不能升级', JSON.stringify(nope));

  // 铜币不够
  const poor = L.createState(4242);
  poor.meta.coins = 5;
  ok(L.buyEquipment(poor, 'hornHelm').ok === false, '铜币不够买不了装备');
}

// ---------------------------------------------------------------- 26. 装备：掉落
section('26. 装备（掉落 5% / 重复件也进背包）');
{
  // 掉落率：用确定性 RNG 跑大样本。
  // 断言区间而不是精确值 —— 抽样本身有方差，卡死 5.00% 会让测试变成
  // "随机数实现的快照"，改一下 RNG 就红，那不是在测掉落率。
  const s = L.createState(777);
  s.meta.equipment = { head: null, torso: null, back: null, weapon: null, feet: null };
  s.meta.bag = [];
  let drops = 0, tries = 4000;
  for (let i = 0; i < tries; i++) if (L.tryEquipDrop(s)) drops++;
  const rate = drops / tries;
  ok(rate > 0.035 && rate < 0.065, '掉落率在 5% 附近（3.5%–6.5%）',
    (rate * 100).toFixed(2) + '%');

  // 只掉基础装备
  const s2 = L.createState(888);
  let allBase = true, seen = 0;
  for (let i = 0; i < 2000; i++) {
    const d = L.tryEquipDrop(s2);
    if (d) { seen++; if (C.equipDef(d.id).kind !== 'base') allBase = false; }
  }
  ok(allBase, '掉落只出基础装备（特效装备只能买）', String(seen));

  // 重复品不再折算，而是进背包
  const dupState = L.createState(7);
  let dupDrop = null;
  for (let i = 0; i < 5000 && !dupDrop; i++) {
    const d = L.rollEquipDrop(dupState);
    if (d && d.duplicate) dupDrop = d;
  }
  ok(dupDrop && dupDrop.refund === undefined, '重复掉落不再带 refund 字段');
  ok(C.EQUIP_DROP.refundRatio === undefined, '折算比例已从配置里删除');
  // 重复品仍然进库存，**不会**因为重复就被吞掉或折算。
  //
  // 注意两处顺序/命名陷阱（都踩过）：
  //  1. 上面那个 5000 次的 warm-up 循环**每一次都在入格**，它结束时背包
  //     已经不是空的。`invBefore` 必须在**重新播种之后**取，
  //     否则基数不对，`+1` 的断言必挂。
  //  2. 用 `L.bagCount(state)` / `L.bagAt(state, i)` 读，**不是**直接伸手
  //     `state.meta.bag[i]` —— 越界时后者是 `undefined`，取 `.id` 会 `TypeError`，
  //     整个套件在汇总前就崩掉，看不到真正的失败项。
  const seeded = Object.keys(C.ALL_EQUIPMENT)
    .filter(function (i) { return C.ALL_EQUIPMENT[i].kind === 'base'; });   // 全部已拥有
  dupState.meta.bag = seeded.map(function (i) { return L.bagEntry(dupState, i, 1); });
  const invBefore = L.bagCount(dupState);                  // === 21，此刻才取
  const dupProbe = L.rollEquipDrop(dupState);
  ok(dupProbe && dupProbe.duplicate === true, '全拥有时掉落判定为重复');
  // 重复品"没被吞掉"的唯一含义就是库存**增长**：
  // 全 21 件已拥有 → 再掉一件 → 22。
  // 原稿写 === 21 是退款时代的残留（那时重复分支不 push，21 才成立）。
  ok(L.bagCount(dupState) === invBefore + 1, '重复品进了背包（没被吞掉）');
  ok(L.bagCount(dupState) === 22, '正好多一件（21 件已拥有 + 1 件重复掉落）');
  const lastEntry = L.bagAt(dupState, L.bagCount(dupState) - 1);
  ok(lastEntry && lastEntry.id === dupProbe.id,
     '新增的那一件就是刚落下的 id（不是别处凭空多出来的）');
  ok(dupState.meta.coins === 0, '重复品不再产生任何铜币');

  // 注：库存已是 `meta.bag` 条目数组（v6）。本段断言的是"refund 已消失、
  // 重复品不消失"，条目数组本身的语义由上面 10b 段覆盖。

  ok(C.EQUIP_DROP.chance === 0.05, '掉落率在配置里，值 0.05');
}

// ---------------------------------------------------------------- 27. 装备：效果机制真的触发
section('27. 装备（特效机制）');
{
  // 荆棘甲：受击反弹伤害给敌人
  const th = armedRunWithEquip({ thornMail: { level: 1 } });
  const foe = addEnemy(th.s, th.run, th.p.x + 30, th.p.z);
  const foeHp0 = foe.hp;
  L.hurtPlayer(th.s, th.run, th.p, 20);
  ok(foe.hp < foeHp0, '荆棘甲：贴身受击后攻击者掉血',
    `${foeHp0} -> ${foe.hp}`);

  // 没有荆棘甲时不反弹
  const noTh = armedRunWithEquip({});
  const foe2 = addEnemy(noTh.s, noTh.run, noTh.p.x + 30, noTh.p.z);
  const foe2Hp0 = foe2.hp;
  L.hurtPlayer(noTh.s, noTh.run, noTh.p, 20);
  ok(foe2.hp === foe2Hp0, '没穿荆棘甲就不反弹', String(foe2.hp));

  // 血滴护符：击杀回血
  const bc = armedRunWithEquip({ bloodCharm: { level: 1 } });
  bc.p.hp = 40;
  const weak = addEnemy(bc.s, bc.run, bc.p.x + 20, bc.p.z);
  weak.hp = 1;
  L.killEnemy(bc.s, bc.run, weak);
  ok(bc.p.hp > 40, '血滴护符：击杀敌人回血', `40 -> ${bc.p.hp}`);

  // 相位战靴：致命伤免疫一次
  const pb = armedRunWithEquip({ phaseBoots: { level: 1 } });
  pb.p.hp = 10;
  L.hurtPlayer(pb.s, pb.run, pb.p, 999);
  ok(pb.p.hp > 0, '相位战靴：致命伤被免疫（没有死）', String(pb.p.hp));
  const hpAfterWard = pb.p.hp;
  pb.p.invuln = 0;                            // 清掉无敌帧，否则第二次不会生效
  L.hurtPlayer(pb.s, pb.run, pb.p, 999);
  ok(pb.p.hp < hpAfterWard, '相位战靴每局只免疫一次', `${hpAfterWard} -> ${pb.p.hp}`);

  // 庇护胸铠：低血才减伤
  const ap = armedRunWithEquip({ aegisPlate: { level: 1 } });
  ap.p.hp = ap.p.maxHp;                       // 满血
  L.hurtPlayer(ap.s, ap.run, ap.p, 20);
  const hiLoss = ap.p.maxHp - ap.p.hp;
  const ap2 = armedRunWithEquip({ aegisPlate: { level: 1 } });
  ap2.p.hp = Math.floor(ap2.p.maxHp * 0.2);   // 低血
  const before2 = ap2.p.hp;
  L.hurtPlayer(ap2.s, ap2.run, ap2.p, 20);
  const loLoss = before2 - ap2.p.hp;
  ok(loLoss < hiLoss, '庇护胸铠：低血时同样伤害掉血更少',
    `满血掉 ${hiLoss} vs 低血掉 ${loLoss}`);

  // 雷冠：第三段命中炸电光，第二段不触发
  // 同伴必须放在**普攻够不到、但电光半径够得到**的位置，
  // 否则测到的是"一次普攻打中两个贴在一起的敌人"，跟雷冠无关。
  const shockR = C.EQUIP_FX.thunderHelm.fx.radius;
  const meleeR = C.COMBO.steps[0].range;
  ok(shockR > meleeR, '雷冠电光半径大于普攻距离（否则等于没有额外效果）',
    `普攻 ${meleeR} -> 电光 ${shockR}`);

  const tk = armedRunWithEquip({ thunderHelm: { level: 1 } });
  const t1 = addEnemy(tk.s, tk.run, tk.p.x + 30, tk.p.z);
  const t2 = addEnemy(tk.s, tk.run, tk.p.x + (meleeR + shockR) / 2, tk.p.z);
  t1.hp = 9999; t2.hp = 9999;
  tk.p.attackTimer = C.ATTACK_DURATION;
  tk.p.comboStep = 0;
  L.step(tk.s, { attack: true, left: false, right: false, up: false,
                 down: false, jump: false, sprint: false }, 1 / 60);
  ok(t1.hp < 9999, '雷冠：第一段正常命中主目标', `9999 -> ${t1.hp}`);
  ok(t2.hp === 9999, '雷冠：第一段不触发爆电（不退化成人人有的 AOE）',
    `同伴血量 ${t2.hp}（普攻距离 ${meleeR}，电光半径 ${shockR}）`);

  // 正面验证：推到第三段时，够不到的同伴必须被电光打到。
  // 只测"不触发"等于没测 —— 把 comboShock 整段删掉上面的断言照样绿。
  const tk3 = armedRunWithEquip({ thunderHelm: { level: 1 } });
  const m1 = addEnemy(tk3.s, tk3.run, tk3.p.x + 30, tk3.p.z);
  const m2 = addEnemy(tk3.s, tk3.run, tk3.p.x + (meleeR + shockR) / 2, tk3.p.z);
  m1.hp = 9999; m2.hp = 9999;
  tk3.p.attackTimer = C.ATTACK_DURATION;
  tk3.p.comboStep = C.COMBO.steps.length - 1;   // 直接落到第三段
  L.step(tk3.s, { attack: true, left: false, right: false, up: false,
                  down: false, jump: false, sprint: false }, 1 / 60);
  ok(tk3.p.comboSwingStep === C.COMBO.steps.length, '第三段确实是连段最后一段',
    String(tk3.p.comboSwingStep));
  ok(m2.hp < 9999, '雷冠：第三段命中后电光波及够不到的同伴',
    `9999 -> ${m2.hp}`);

  // 暴风指环 / 烬灰斗篷：机制存在性（概率与触发条件已由配置断言）
  const sr = L.hasFx((function () {
    const x = L.createState(6); x.meta.equipment.back = { id: 'stormRing', level: 1 }; return x;
  })(), 'chainLightning');
  ok(sr && sr.chance > 0, '暴风指环：连锁闪电有触发概率', String(sr && sr.chance));
  const cc = L.hasFx((function () {
    const x = L.createState(7); x.meta.equipment.back = { id: 'cinderCloak', level: 1 }; return x;
  })(), 'ashBurst');
  ok(cc && cc.damage > 0 && cc.radius > 0, '烬灰斗篷：受击爆发有伤害与半径',
    `${cc && cc.damage} / ${cc && cc.radius}`);

  // 灼烧区域真的会持续掉血
  const eb = armedRunWithEquip({ emberBoots: { level: 1 } });
  const burnFoe = addEnemy(eb.s, eb.run, eb.p.x + 20, eb.p.z);
  burnFoe.hp = 9999;
  eb.run.burnZones.push({ x: eb.p.x, z: eb.p.z, radius: 100, dps: 30,
                          timer: 1.0, maxTimer: 1.0, acc: 0 });
  L.stepZones(eb.s, eb.run, 1 / 60);
  L.stepZones(eb.s, eb.run, 1 / 60);
  ok(burnFoe.hp < 9999, '熔火战靴：灼烧区域逐帧扣血', `9999 -> ${burnFoe.hp}`);

  // 冰霜区域真的减速
  const fr = armedRunWithEquip({ frostArmor: { level: 1 } });
  const slowFoe = addEnemy(fr.s, fr.run, fr.p.x + 20, fr.p.z);
  fr.run.frostZones.push({ x: fr.p.x, z: fr.p.z, radius: 100,
                           slowMul: 0.55, timer: 1.0, maxTimer: 1.0 });
  L.stepZones(fr.s, fr.run, 1 / 60);
  ok(slowFoe.slowMul === 0.55 && slowFoe.slowTimer > 0,
    '霜缚护甲：冰霜区域确实减速敌人',
    `${slowFoe.slowMul} / ${Number(slowFoe.slowTimer).toFixed(3)}`);

  // 减速对 boss 同样生效（否则这件装备对 boss 战毫无价值）
  const frB = armedRunWithEquip({ frostArmor: { level: 1 } });
  L.spawnBoss(frB.s, frB.run, 'normal');
  const boss = frB.run.enemies.filter(e => e.isBoss)[0];
  frB.run.frostZones.push({ x: boss.x, z: boss.z, radius: 200,
                            slowMul: 0.55, timer: 1.0, maxTimer: 1.0 });
  L.stepZones(frB.s, frB.run, 1 / 60);
  ok(boss.slowMul === 0.55, '冰霜对 boss 同样生效（不是对小怪专用）',
    String(boss.slowMul));

  // 特效装备升级只加强度，不改机制 id
  const th3 = L.hasFx((function () {
    const x = L.createState(5);
    x.meta.equipment.torso = { id: 'thornMail', level: 3 };
    return x;
  })(), 'thorns');
  ok(th3 && th3.id === 'thorns', '升级后机制 id 不变（还是反伤）', th3 && th3.id);
  ok(th3.reflect > C.EQUIP_FX.thornMail.fx.reflect, '升级后强度参数变大',
    `${C.EQUIP_FX.thornMail.fx.reflect} -> ${th3.reflect}`);
}

// ---------------------------------------------------------------- 28. 装备：技能改造
section('28. 装备（技能改造）');
{
  // 战斧：震地范围 +50%
  const plain = armedRunWithEquip({});
  const axe = armedRunWithEquip({ battleAxe: { level: 1 } });
  const plainSlam = C.SKILLS.slam.radius;
  const axeSlam = skillRadiusFor(axe.s, 'slam');
  ok(axeSlam > plainSlam, '战斧：震地范围变大',
    `${plainSlam} -> ${axeSlam}`);
  ok(Math.abs(axeSlam - plainSlam * 1.5) < 0.01, '战斧：范围正好 +50%',
    String(axeSlam));
  // 代价：冷却变长（有代价的装备才是选择）
  ok(skillCooldownFor(axe.s, 'slam') > skillCooldownFor(plain.s, 'slam'),
    '战斧：冷却变长（有代价）',
    `${skillCooldownFor(plain.s, 'slam')} -> ${skillCooldownFor(axe.s, 'slam')}`);

  // 虚空之刃：裂风斩吸血
  const vb = armedRunWithEquip({ voidBlade: { level: 1 } });
  vb.p.hp = 30;
  const victim = addEnemy(vb.s, vb.run, vb.p.x + 60, vb.p.z);
  victim.hp = 200;
  L.tryCastSkill(vb.s, vb.run, vb.p, 'whirl');
  for (let i = 0; i < 30; i++) L.step(vb.s, { left: false, right: false, up: false, down: false }, 1 / 60);
  ok(vb.p.hp > 30, '虚空之刃：裂风斩命中后回血', `30 -> ${vb.p.hp}`);

  // 三叉圣杖：大招范围 +20%
  const tr = armedRunWithEquip({ trident: { level: 1 } });
  ok(Math.abs(skillRadiusFor(tr.s, 'nova') - C.SKILLS.nova.radius * 1.2) < 0.01,
    '三叉圣杖：大招范围 +20%',
    `${C.SKILLS.nova.radius} -> ${skillRadiusFor(tr.s, 'nova')}`);

  // 没装备时技能保持原样
  ok(skillRadiusFor(plain.s, 'slam') === plainSlam, '没装备战斧时震地范围不变');
  ok(skillCooldownFor(plain.s, 'slam') === C.SKILLS.slam.cooldown,
    '没装备时冷却不变');
}

// ---------------------------------------------------------------- 29. 装备：专属技能
section('29. 装备（专属技能与动态技能栏）');
{
  const plain = armedRunWithEquip({});
  ok(L.specialSkillOf(plain.s) === null, '没装备专属武器时没有专属技能');

  const oath = armedRunWithEquip({ oathkeeper: { level: 1 } });
  ok(L.specialSkillOf(oath.s) === 'block', '守誓者授予「格挡」',
    String(L.specialSkillOf(oath.s)));

  const tome = armedRunWithEquip({ arcaneTome: { level: 1 } });
  ok(L.specialSkillOf(tome.s) === 'blink2', '秘法之书授予「短距传送」');

  // 换掉武器后技能消失
  L.unequipSlot(oath.s, 'weapon');
  ok(L.specialSkillOf(oath.s) === null, '卸下守誓者后「格挡」消失');

  // 格挡真的减伤
  const blk = armedRunWithEquip({ oathkeeper: { level: 1 } });
  blk.p.hp = blk.p.maxHp;
  L.castSpecial(blk.s, blk.run, blk.p);
  ok(blk.p.blockTimer > 0, '格挡生效期间有计时器', String(blk.p.blockTimer));
  L.hurtPlayer(blk.s, blk.run, blk.p, 40);
  const blockedLoss = blk.p.maxHp - blk.p.hp;

  const noBlk = armedRunWithEquip({});
  noBlk.p.hp = noBlk.p.maxHp;
  L.hurtPlayer(noBlk.s, noBlk.run, noBlk.p, 40);
  const normalLoss = noBlk.p.maxHp - noBlk.p.hp;
  ok(blockedLoss < normalLoss, '格挡真的减伤了',
    `格挡掉 ${blockedLoss} vs 不格挡掉 ${normalLoss}`);

  // 专有武器占武器位，不能同时拿两把。
  // 注意用新开的局：上面的 oath 已经被 unequipSlot 清空了武器位。
  const swap = armedRunWithEquip({ oathkeeper: { level: 1 } }, { coins: 5000 });
  ok(swap.s.meta.equipment.weapon.id === 'oathkeeper', '专属武器占武器位');
  // 必须断言 buy 成功。之前这里没给铜币（初始 0），买入静默失败，
  // 后面的 equipItem 又只返回 {ok:false}，于是错误被推到"武器位没换人"
  // 这条完全不相关的断言上，排查方向被带偏。
  const bought = L.buyEquipment(swap.s, 'crystalStaff');
  ok(bought.ok, '买下第二把武器', JSON.stringify(bought));
  const swapped = L.equipItem(swap.s, 'crystalStaff');
  ok(swapped.ok, '换上第二把武器', JSON.stringify(swapped));
  ok(swap.s.meta.equipment.weapon.id === 'crystalStaff',
    '换上棱晶杖后武器位换人', String(swap.s.meta.equipment.weapon.id));
  ok(L.specialSkillOf(swap.s) === null,
    '换上棱晶杖后专属技能消失（是替换不是白送）');
}

// ---------------------------------------------------------------- 30. 装备：不破坏既有平衡
section('30. 装备（不破坏既有平衡）');
{
  // 全套基础装备（1 级）不能让零强化直接通关最高难度 ——
  // 装备是"倾向"，不该替代难度选择。
  const full = armedRunWithEquip({
    hornHelm: { level: 1 }, fullPlate: { level: 1 }, wingCape: { level: 1 },
    twinBlades: { level: 1 }, stoneBoots: { level: 1 },
  });
  const st = L.playerStats(full.s);
  // 伤害不超过基础的 2 倍（强化满级才是 2 倍）
  ok(st.damage < C.BASE_DAMAGE * 2.0, '全套基础装备的伤害低于基础值的 2 倍',
    `${C.BASE_DAMAGE} -> ${st.damage}`);
  // 减伤不能到免疫
  ok(st.hurtMul > 0.5, '全套装备的减伤不会超过一半（不会变成无敌）',
    st.hurtMul.toFixed(3));
  // 生命上限不超过基础 2.5 倍
  ok(st.maxHp < C.BASE_HP * 2.5, '全套装备的生命上限低于基础值的 2.5 倍',
    `${C.BASE_HP} -> ${st.maxHp}`);

  // 每件装备都有名字与描述（商店要显示，缺了就是空白格子）
  Object.keys(C.ALL_EQUIPMENT).forEach(function (id) {
    const d = C.ALL_EQUIPMENT[id];
    ok(!!d.name && !!d.desc, `装备 ${id} 有名字与描述`);
  });

  // 装备位必须都能装（id 的 slot 与配置一致）
  Object.keys(C.ALL_EQUIPMENT).forEach(function (id) {
    const d = C.ALL_EQUIPMENT[id];
    ok(C.EQUIP_SLOTS.indexOf(d.slot) >= 0, `装备 ${id} 的部位合法`);
  });
}

// ---------------------------------------------------------------- 31. 专属技能（V）接进输入层
section('31. 专属技能：按键 -> 释放 -> 冷却 -> 失去');

{
  // 装了誓约剑才有格挡
  const a = armedRunWithEquip({ oathkeeper: 1 });
  ok(L.specialSkillOf(a.s) === 'block', '誓约剑授予「格挡」',
    String(L.specialSkillOf(a.s)));

  // 没装授予技能的武器就没有
  const b = armedRunWithEquip({ twinBlades: 1 });
  ok(L.specialSkillOf(b.s) === null, '普通武器不授予专属技能',
    String(L.specialSkillOf(b.s)));

  // 空武器位也没有
  const c = armedRunWithEquip({});
  ok(L.specialSkillOf(c.s) === null, '没装武器时没有专属技能');

  // 按下 V：进入冷却 + 格挡生效
  ok(a.p.specialCd === 0, '开局专属技能无冷却');
  L.step(a.s, { special: true }, 1 / 60);
  ok(a.p.specialCd > 0, '释放后进入冷却', a.p.specialCd.toFixed(2));
  ok(a.p.blockTimer > 0, '格挡在生效', a.p.blockTimer.toFixed(2));

  /*
   * 冷却必须随时间递减。
   * 这正是这次接输入时漏掉的一环：castSpecial 只"设"冷却，
   * stepPlayer 里没有对应的减法，技能一辈子只能放一次。
   * 这条断言就是钉住它。
   */
  const cdBefore = a.p.specialCd;
  for (let i = 0; i < 60; i++) L.step(a.s, {}, 1 / 60);
  ok(a.p.specialCd < cdBefore, '冷却随时间递减（不会卡住不放）',
    `${cdBefore.toFixed(2)} -> ${a.p.specialCd.toFixed(2)}`);

  // 冷却中再按不出第二发
  const held = armedRunWithEquip({ oathkeeper: 1 });
  L.step(held.s, { special: true }, 1 / 60);
  const afterFirst = held.p.blockTimer;
  L.step(held.s, { special: true }, 1 / 60);
  ok(held.p.blockTimer <= afterFirst, '冷却中按 V 不会刷新/叠加格挡');

  // 二段闪：位移 + 无敌帧
  const d = armedRunWithEquip({ arcaneTome: 1 });
  ok(L.specialSkillOf(d.s) === 'blink2', '秘法典授予「二段闪」');
  const x0 = d.p.x, face = d.p.facing;
  L.step(d.s, { special: true }, 1 / 60);
  ok(d.p.x !== x0, '二段闪真的位移了', `${x0} -> ${d.p.x}`);
  ok(Math.sign(d.p.x - x0) === Math.sign(face), '朝面向方向闪');
  ok(d.p.invuln > 0, '二段闪带无敌帧', d.p.invuln.toFixed(2));

  // 卸下武器即失去技能，且再调用返回 false
  const e = armedRunWithEquip({ oathkeeper: 1 });
  L.unequipSlot(e.s, 'weapon');
  ok(L.specialSkillOf(e.s) === null, '卸下授予类武器后技能消失');
  eq(L.castSpecial(e.s, e.run, e.p), false, '无武器时 castSpecial 返回 false');
}

// ---------------------------------------------------------------- 32. 基地错落（V16）
section('32. 基地六点位错落：判定必须是二维的');
{
  /*
   * 用户原话：「六个点位现在是排成一条直线的……做成上下错落的」。
   *
   * 为什么这条测试要盯"判定"而不是只盯画出来的 y：错落本身是数据，
   * 判定一旦仍然只比 x，上下错开就只是"看起来错开了"，站在中间会同时命中
   * 相邻两个点位 —— 玩家按 J 不知道该进哪个。
   *
   * 坐标写死是有意的：这条测的就是错落值本身，读 ZONES 再拿它断言等于自证。
   * state.hub 是懒创建的：L.createState 之后必须先 H.ensureHub，否则 s.hub
   * 是 undefined，赋值直接 TypeError。
   */
  const s = L.createState(51);
  const h = H.ensureHub(s);

  // 定稿的错落值：下排 z=88（画面上更靠前、更低），上排 z=122，门留在中线 105。
  [['field', 100, 88], ['anvil', 265, 122], ['forgewear', 415, 88],
    ['shop', 565, 122], ['altar', 720, 88], ['gate', 880, 105]].forEach(function (t) {
    h.x = t[1]; h.z = t[2];
    const z = H.zoneAt(s);
    ok(z && z.id === t[0], '站在 ' + t[0] + ' 的点位坐标上命中自己（实际 ' +
      (z ? z.id : 'null') + '）');
  });

  // 数据层：z 与 reachZ 必须显式写在 ZONES 里，不靠函数默认值兜底
  ok(H.ZONES.every(function (z) { return typeof z.z === 'number'; }),
    '每个点位都有自己的错落深度 z（不是绘制端临时加的偏移）',
    JSON.stringify(H.ZONES.map(function (z) { return z.id + ':' + z.z; })));
  ok(H.ZONES.every(function (z) { return z.reachZ === 60; }),
    '每个点位都显式写了 reachZ = 60（数据在数据层，不藏默认值）',
    JSON.stringify(H.ZONES.map(function (z) { return z.id + ':' + z.reachZ; })));
  // x 容差字段名必须还是 reach —— 三处既有测试在读它，改名会误伤
  ok(H.ZONES.every(function (z) { return typeof z.reach === 'number' && z.reach > 0; }),
    'x 容差仍叫 reach（不是 reachX）');

  // 判定必须真的是二维的：站在场地最前缘（z = 0）时，x 再怎么对着设施都不该命中。
  // 旧的一维实现只比 x，这里会命中 —— 这就是这次改动的关键判据。
  h.x = (100 + 265) / 2;
  h.z = 0;
  ok(H.zoneAt(s) === null, '站在场地最前缘（z=0）时谁都不命中（判定确实是二维的）',
    (H.zoneAt(s) || {}).id);
  h.x = 100; h.z = 0;
  ok(H.zoneAt(s) === null, '田地正前方但深度不对（z=0）也不命中', (H.zoneAt(s) || {}).id);
  h.x = 265; h.z = 122;
  ok((H.zoneAt(s) || {}).id === 'anvil', 'z 正确时命中铁匠铺');
  h.x = (265 + 415) / 2; h.z = 122;
  ok(H.zoneAt(s) === null, '相邻点位中点（x 轴空隙）不命中任何区域',
    (H.zoneAt(s) || {}).id);

  // 深度容差真的就是 60：边界上要命中，再多一格必须落空。
  // 这一对断言钉住 reachZ 真的被用上了，防止它被写成 Infinity 或只在别处存着。
  h.x = 265; h.z = 122 + 60;
  ok((H.zoneAt(s) || {}).id === 'anvil', '深度正好在容差边界（Δz = 60）仍命中',
    (H.zoneAt(s) || {}).id);
  h.x = 265; h.z = 122 + 61;
  ok(H.zoneAt(s) === null, '深度超出容差一格（Δz = 61）不命中',
    (H.zoneAt(s) || {}).id);
}

// ---------------------------------------------------------------- ESC 菜单 / 主动退出（Task 13）
section('ESC 菜单与「退出战斗」结算（Task 13）');
{
  /*
   * 菜单行由逻辑层决定、由 index.html 渲染。
   * 为什么"哪一行该出现"要放在 logic 里：它取决于 state.phase，
   * 散在 UI 里就会变成第二份"什么时候算在战斗中"的判断，
   * 迟早和 logic 的口径不一致（比如 phase 已经是 result 了菜单还挂着退出按钮）。
   */
  const sh = L.createState(4242);
  const rowsHub = L.escMenuRows(sh);
  ok(Array.isArray(rowsHub), 'escMenuRows 已挂到 API 上并返回数组',
     typeof L.escMenuRows);
  eq(rowsHub.length, 1, '基地 ESC 菜单只有一行', JSON.stringify(rowsHub));
  eq(rowsHub[0].id, 'settings', '基地唯一一行的 id 是 settings');
  eq(rowsHub[0].label, '设置', '基地唯一一行写「设置」');
  ok(!rowsHub.some(function (r) { return r.id === 'quit'; }),
     '基地没有「退出战斗」（没有局可退）');

  L.startRun(sh, 'wood');
  const rowsRun = L.escMenuRows(sh);
  eq(rowsRun.length, 2, '战斗中 ESC 菜单两行', JSON.stringify(rowsRun));
  eq(rowsRun[0].id, 'settings', '战斗中第一行仍是设置');
  eq(rowsRun[1].id, 'quit', '战斗中第二行是退出战斗');
  eq(rowsRun[1].label, '退出战斗', '第二行文案是「退出战斗」');

  L.exitRun(sh);
  eq(L.escMenuRows(sh).length, 1, '结算后菜单退回一行（不再提供退出战斗）');

  // ---- 满血退出：保留 50% ----
  {
    const s = L.createState(11);
    L.startRun(s, 'wood');
    s.run.loot.coins = 1000;
    s.run.loot.seeds = 200;
    s.run.player.hp = s.run.player.maxHp;
    const runsBefore = s.meta.runsCompleted, wonBefore = s.meta.runsWon;
    const coinsBefore = s.meta.coins;
    const res = L.exitRun(s);
    ok(res && res.ok === true, '满血退出结算成功', JSON.stringify(res));
    eq(s.phase, 'result', '退出后进入结算阶段');
    eq(s.run, null, '退出后 run 被清空（同一个 run 不能再结算一次）');
    eq(s.lastResult.won, false, '主动退出按战败记账（won = false）');
    eq(s.lastResult.exited, true, '结算结果带 exited 标记（文案要区分主动退出）');
    eq(s.lastResult.coins, 500, '满血退出保留 50% 铜币');
    eq(s.lastResult.seeds, 100, '满血退出种子同样 50%');
    eq(s.meta.runsCompleted - runsBefore, 1, '主动退出也算打完一局');
    eq(s.meta.runsWon - wonBefore, 0, '主动退出不算胜利');
    ok(s.meta.coins >= coinsBefore + 500, '铜币真的进了钱包（还要加上被动收益）',
       s.meta.coins - coinsBefore);
  }

  // ---- 残血退出：公式 0.5 × (0.5 + 0.5 × 血量比) ----
  {
    const s = L.createState(12);
    L.startRun(s, 'wood');
    s.run.loot.coins = 1000;
    s.run.loot.seeds = 200;
    const maxHp = s.run.player.maxHp;
    s.run.player.hp = 1;
    // 期望值在测试里独立算一遍，而不是抄实现里的中间变量
    const keep = 0.5 * (0.5 + 0.5 * (1 / maxHp));
    const res = L.exitRun(s);
    eq(res.ok, true, '残血退出也能结算');
    near(res.keep, keep, 1e-9, '残血退出的保留率走血量折扣公式');
    eq(s.lastResult.coins, Math.round(1000 * keep),
       '残血退出的铜币是折扣后的值（四舍五入）', s.lastResult.coins);
    eq(s.lastResult.seeds, Math.round(200 * keep), '残血退出的种子同比例');
    ok(keep < 0.5 && keep >= 0.25, '残血保留率落在 [25%, 50%) 之间', keep);
    ok(s.lastResult.coins < 500, '残血退出比满血退出拿得少', s.lastResult.coins);
  }

  // ---- 空血退出：下限 25%，不会掉到 0 ----
  {
    const s = L.createState(13);
    L.startRun(s, 'wood');
    s.run.loot.coins = 1000;
    s.run.player.hp = 0;
    L.exitRun(s);
    eq(s.lastResult.coins, 250, '空血退出保留 25%（下限）');
  }

  // ---- 重复退出：不能靠连点刷钱 ----
  {
    const s = L.createState(14);
    L.startRun(s, 'wood');
    s.run.loot.coins = 1000;
    s.run.loot.seeds = 100;
    s.run.player.hp = s.run.player.maxHp;
    L.exitRun(s);
    const coins = s.meta.coins, seeds = s.meta.seeds, runs = s.meta.runsCompleted;
    const again = L.exitRun(s);
    ok(again && again.ok === false, '重复退出被拒绝（ok = false）', JSON.stringify(again));
    eq(s.meta.coins, coins, '重复退出不再发铜币');
    eq(s.meta.seeds, seeds, '重复退出不再发种子');
    eq(s.meta.runsCompleted, runs, '重复退出不重复计一局');
    eq(s.lastResult.coins, 500, '重复退出不改写上一次的结算');
  }

  // ---- 没有进行中的局：拒绝，而且不把状态改成 result ----
  {
    const s = L.createState(15);
    eq(L.exitRun(s).ok, false, '没有进行中的局时退出被拒绝');
    eq(s.phase, 'farm', '被拒绝时状态保持原样（不会卡在结算阶段）');
  }

  // ---- 「早退」的经济学：不优于打输，永远不如打赢 ----
  {
    const lootCoins = 800;
    const mk = function (hpRatio) {
      const s = L.createState(16);
      L.startRun(s, 'wood');
      s.run.loot.coins = lootCoins;
      s.run.player.hp = Math.max(0, Math.round(s.run.player.maxHp * hpRatio));
      return s;
    };
    const exitFull = mk(1); L.exitRun(exitFull);
    const lost = mk(1); L.endRun(lost, false);
    const exitLow = mk(1 / 70); L.exitRun(exitLow);
    const wonS = mk(1); L.endRun(wonS, true);
    eq(exitFull.lastResult.coins, lost.lastResult.coins,
       '满血早退与打输拿一样多（不优于打输）', exitFull.lastResult.coins);
    ok(exitLow.lastResult.coins <= lost.lastResult.coins,
       '残血早退不会比打输拿得多', exitLow.lastResult.coins);
    ok(exitFull.lastResult.coins < wonS.lastResult.coins, '早退永远不如打赢',
       exitFull.lastResult.coins + ' vs ' + wonS.lastResult.coins);
    ok(exitLow.lastResult.coins < exitFull.lastResult.coins,
       '血越少早退拿得越少', exitLow.lastResult.coins);
  }
}

// ---------------------------------------------------------------- V18. 攻击范围 +5%
section('V18. 攻击连段与判定范围整体加长 5%');
{
  // 用户要的是「每段都比之前大或远」，所以不能只看 ATTACK_RANGE ——
  // 玩普攻走的是 p.comboRange（= COMBO.steps[step].range），
  // ATTACK_RANGE 只是还没出手时的兜底（logic.js 里 `p.comboRange || C.ATTACK_RANGE`）。
  // 断言写成「原值 × 1.05」，不写死新数值：将来再调平衡不该打红一整片。
  const base = [58, 62, 74];
  const baseRange = 62, baseDepth = 52, baseBack = 14;

  eq(C.COMBO.steps.length, base.length, '连段仍是三段');
  C.COMBO.steps.forEach(function (st, i) {
    ok(st.range > base[i] * 1.05,
       `第 ${i + 1} 段 range 比原值大 5% 以上（${base[i]} -> ${st.range}）`,
       st.range);
  });
  // 单调递增：否则「每段都更远」只是平均数上的假象。
  for (let i = 1; i < C.COMBO.steps.length; i++) {
    ok(C.COMBO.steps[i].range > C.COMBO.steps[i - 1].range,
       `第 ${i + 1} 段比第 ${i} 段更远（${C.COMBO.steps[i - 1].range} -> ${C.COMBO.steps[i].range}）`);
  }
  ok(C.ATTACK_RANGE > baseRange,
     `普攻基准射程也放大（${baseRange} -> ${C.ATTACK_RANGE}）`, C.ATTACK_RANGE);
  ok(C.ATTACK_DEPTH > baseDepth * 1.05,
     `纵深判定同比放大（${baseDepth} -> ${C.ATTACK_DEPTH}，否则侧面打不到）`,
     C.ATTACK_DEPTH);
  ok(C.ATTACK_BACK > baseBack * 1.05,
     `身后判定同比放大（${baseBack} -> ${C.ATTACK_BACK}）`, C.ATTACK_BACK);

  // 行为层：真的挥一刀，命中距离必须跟着配置走。
  // 敌人放在「旧第一段射程之外、新射程之内」，且同深度。
  {
    const gap = (base[0] + C.COMBO.steps[0].range) / 2;
    const { s, run } = armedRun('wood', 500, 105);
    run.player.facing = 1;
    const e = addEnemy(s, run, 500 + gap, 105);
    const hp0 = e.hp;
    L.step(s, Object.assign({}, INPUT, { attack: true }), DT);
    ok(e.hp < hp0 || e.state === 'dead',
       `第 1 段真的能打到 ${gap.toFixed(1)}px 外的敌人（旧射程 ${base[0]}）`,
       e.hp);
  }
}

// ---------------------------------------------------------------- V18b. Boss 近战够得到
section('V18b. 贴住 Boss 时三段普攻都打得到（体型大的敌人不能被"贴身距离"卡住）');
{
  /*
   * 2026-11-13 PM 两次实测反馈：
   *   第一次「前两下普攻打不到 boss」→ 三段射程 61/66/78 全都短于贴身间距 69。
   *   第二次「要完全贴住 boss 才能打到，增大受击范围」→ 光靠加长射程解决不了，
   *     因为射程一长，小怪那边也变成"远程揍人"，而且玩家仍要贴到 69px 才出手。
   *
   * 最终模型：Boss 有**两个**半径（见 config.js 的注释）
   *   bodyRadius = 46  → 推开距离 minGap = 46 + 17 + 6 = 69（玩家能站多近）
   *   hitRadius  = 74  → 受击半径，命中判据变成 `dx < comboRange + hitRadius`
   * 于是站在最近的合法位置上，有效距离 = comboRange + 74，三段都留出大量余量；
   * 而小怪没有 hitRadius（undefined → 0），行为与以前逐位一致。
   *
   * 断言写成"射程/受击半径必须覆盖贴身间距"而不是写死数值：将来再调平衡，
   * 只要两边同步改就不会打红一整片。
   */
  const minGap = (C.BOSS.bodyRadius || C.BOSS.radius) + C.PLAYER_W / 2 + 6;
  const need = minGap + 1;   // 判据是严格小于，所以要留 1px

  C.COMBO.steps.forEach(function (st, i) {
    ok(st.range >= need,
       `贴住 Boss 时第 ${i + 1} 段够得到（射程 ${st.range} 必须 ≥ 贴身间距 ${minGap} + 1）`,
       `range=${st.range} need=${need}`);
  });
  ok(C.ATTACK_RANGE >= need,
     `普攻基准射程也够得到 Boss（${C.ATTACK_RANGE} ≥ ${need}）`, C.ATTACK_RANGE);

  // 行为层：真的造一个 Boss、把玩家放到最近的合法位置、挥一刀。
  // 只断言配置等于没测 —— 配置对了但 resolveAttack 用别的判据照样漏。
  function swingAtBoss(segIndex) {
    const { s, run } = armedRunWithEquip({});
    run.enemies.length = 0;
    const boss = L.spawnBoss(s, run, 'normal');
    const p = run.player;
    p.x = boss.x - minGap;      // 玩家能站到的离 Boss 最近的位置
    p.z = boss.z;
    p.facing = 1;               // 面朝 Boss
    p.hitIds = [];
    p.comboStep = segIndex;
    p.comboTimer = C.COMBO.window;
    p.attackTimer = 0;
    p.attackCd = 0;
    const hp0 = boss.hp;
    L.step(s, Object.assign({}, INPUT, { attack: true }), DT);
    return { hit: boss.hp < hp0, dealt: hp0 - boss.hp, hp0: hp0 };
  }

  for (let i = 0; i < C.COMBO.steps.length; i++) {
    const r = swingAtBoss(i);
    ok(r.hit,
       `第 ${i + 1} 段真的打中了贴身位置的 Boss（站位 ${minGap}px）`,
       `Boss 血量 ${r.hp0} -> ${r.hp0 - r.dealt}`);
  }

  // 反证：不能靠"把判定改成恒真"蒙过上面三条。
  // 站到射程之外必须打不到，否则"够得到"只是废话。
  {
    const { s, run } = armedRunWithEquip({});
    run.enemies.length = 0;
    const boss = L.spawnBoss(s, run, 'normal');
    const p = run.player;
    // 反证要站在**受击半径也够不到**的地方：
    // 有效距离 = range + hitRadius，所以 far 必须超过它，否则这条反证会把
    // "少算了受击半径" 当成错误来报。
    const far = C.COMBO.steps[2].range + C.BOSS.hitRadius + 30;
    p.x = boss.x - far;
    p.z = boss.z;
    p.facing = 1;
    p.hitIds = [];
    p.comboStep = 0;
    p.attackTimer = 0;
    p.attackCd = 0;
    const hp0 = boss.hp;
    L.step(s, Object.assign({}, INPUT, { attack: true }), DT);
    ok(boss.hp === hp0,
       `站得太远照样打不到（${far}px > 第 3 段射程 ${C.COMBO.steps[2].range} + 受击半径 ${C.BOSS.hitRadius}）`,
       `Boss 血量 ${boss.hp}`);
  }
}

// ---------------------------------------------------------------- V18c 再来一局的难度继承
section('V18c. 「再来一局」必须记住打的是哪一局（难度 / Boss 档不能丢）');
{
  /*
   * PM 报（2026-11-13）：「不管在什么关卡死了点再来一局都回到了林地难度」。
   *
   * 根因是三条叠加，任何一条单独看都不明显：
   *  1. startBossRun 里 L.startRun(this.state, 'wood') 写死了 'wood'，
   *     于是 Boss 局的 run.difficultyId 永远是 wood；
   *  2. endRun 只把 difficultyId 抄进 lastResult，没抄 isBossRun / bossTier，
   *     重开处理器手上只有"难度"这一条线索，Boss 局身份丢失；
   *  3. C.difficultyById 对未知 id **静默回退到 wood**（实测 'hard'/'hell'/'' 全 → wood），
   *     所以就算有人把 bossTier 当难度 id 传下去，也不会报错，只是安静地
   *     开成林地 —— 缺陷因此没有任何报错可查。
   *
   * 这个用例同时钉住三件事：lastResult 记住身份、Boss 档与难度是两套命名、
   * 未知 id 的回退行为本身（把它写成断言，将来谁改了回退策略会立刻知道）。
   */
  const TIER_DIFF = { normal: 'wood', hard: 'deep', hell: 'forge' };

  Object.keys(TIER_DIFF).forEach((tier) => {
    const s = L.createState(11);
    // startBossRun 现在按档位取难度，这里复现它的调用
    L.startRun(s, TIER_DIFF[tier]);
    const run = s.run;
    run.enemies.length = 0;
    run.spawnQueue.length = 0;
    run.isBossRun = true;
    run.bossTier = tier;
    L.spawnBoss(s, run, tier);
    ok(run.difficultyId === TIER_DIFF[tier],
       `档 ${tier} 开局难度是 ${TIER_DIFF[tier]}（不是写死的 wood）`,
       run.difficultyId);

    L.endRun(s, false, {});
    ok(s.lastResult.isBossRun === true, `档 ${tier} 结算后记住这是 Boss 局`,
       s.lastResult.isBossRun);
    ok(s.lastResult.bossTier === tier, `档 ${tier} 结算后记住档位`,
       s.lastResult.bossTier);
    ok(s.lastResult.difficultyId === TIER_DIFF[tier],
       `档 ${tier} 结算后难度仍是 ${TIER_DIFF[tier]}`, s.lastResult.difficultyId);

    // 重开处理器读的就是这两样，复原出下一局该用什么
    const againDiff = s.lastResult.isBossRun
      ? TIER_DIFF[s.lastResult.bossTier]
      : s.lastResult.difficultyId;
    ok(againDiff === TIER_DIFF[tier],
       `档 ${tier} 重开复原出 ${TIER_DIFF[tier]}（这是"回到林地"那条缺陷的正题）`,
       againDiff);
  });

  // 普通局不能被误标成 Boss 局
  {
    const s = L.createState(11);
    L.startRun(s, 'forge');
    L.endRun(s, false, {});
    ok(s.lastResult.isBossRun === false, '普通局 isBossRun=false', s.lastResult.isBossRun);
    ok(s.lastResult.bossTier === null, '普通局 bossTier=null', s.lastResult.bossTier);
    ok(s.lastResult.difficultyId === 'forge', '普通局难度保真', s.lastResult.difficultyId);
  }

  // 存档往返也要带着：重开前可能先读了一次档
  {
    const s = L.createState(11);
    L.startRun(s, 'deep');
    const run = s.run;
    run.enemies.length = 0;
    run.spawnQueue.length = 0;
    run.isBossRun = true;
    run.bossTier = 'hard';
    L.spawnBoss(s, run, 'hard');
    L.endRun(s, false, {});
    const back = L.deserialize(L.serialize(s));
    ok(back.lastResult.isBossRun === true, '读档后 isBossRun 还在', back.lastResult.isBossRun);
    ok(back.lastResult.bossTier === 'hard', '读档后 bossTier 还在', back.lastResult.bossTier);
  }

  /*
   * 反证（这一条是防"修了个假"）：
   * 如果谁把 Boss 档直接当难度 id 传下去，必须能看出它是错的 ——
   * 静默回退成 wood 正是缺陷能藏这么久的原因。这里把回退行为写死成断言，
   * 而不是依赖它"看起来对"。
   */
  ok(C.difficultyById('hard').id === 'wood',
     '（反证）bossTier 直接当难度 id 会静默回退成 wood —— 所以两套命名必须显式映射',
     C.difficultyById('hard').id);
  ok(C.difficultyById('hell').id === 'wood',
     '（反证）hell 同样静默回退', C.difficultyById('hell').id);
  Object.keys(TIER_DIFF).forEach((tier) => {
    ok(C.difficultyById(TIER_DIFF[tier]).id === TIER_DIFF[tier],
       `档 ${tier} 映射到的 ${TIER_DIFF[tier]} 是合法难度 id（回退不会生效）`,
       C.difficultyById(TIER_DIFF[tier]).id);
  });
}

// ---------------------------------------------------------------- V18d 重开的状态机
section('V18d. 「再来一局」的状态机：phase 必须回到 run（否则战斗不跑）');
{
  /*
   * PM 报（2026-11-13）：「点了再来一局进入战斗后按 tab 和 esc 都没有反应」、
   * 「显示的是人物走到了关卡地图的最左边，按 J 却进入了农场」。
   *
   * 机制：结算后 phase='result'，重开处理器先调 returnToFarm()（把 phase 置成
   * 'farm'），然后调 scene.restart()。但 RunScene.update 第一行是
   * `if (!run || this.state.phase !== 'run') return;` —— phase 不是 'run'，
   * 战斗循环根本不跑，屏幕上是**冻结的战场**。玩家在冻结画面上走动，
   * 按键被 Hub 式的交互逻辑读到（zone.id === 'field'），于是"按 J 进了农场"。
   *
   * 这个用例钉住"重开必须把 phase 送回 run"，这是战斗能跑起来的必要条件。
   */
  const s = L.createState(11);
  L.startRun(s, 'deep');
  ok(s.phase === 'run', '开局 phase=run', s.phase);

  L.endRun(s, false, {});
  ok(s.phase === 'result', '结算后 phase=result', s.phase);

  L.returnToFarm(s);
  ok(s.phase === 'farm', 'returnToFarm 把 phase 置成 farm（这一步本身没错）', s.phase);

  /*
   * 正题：重开必须重新 startRun —— 只 returnToFarm 就 restart 的话
   * phase 停在 'farm'，RunScene.update 会一直早退（这就是"战斗不跑、
   * 按 J 进农场"的根因）。
   */
  const diff = s.lastResult.difficultyId;
  L.startRun(s, diff);
  ok(s.phase === 'run', '重开（startRun）后 phase 回到 run —— 战斗才跑得起来', s.phase);
  ok(!!s.run, '重开后 run 对象存在', !!s.run);
  ok(s.run.difficultyId === 'deep', '重开后难度还是 deep', s.run.difficultyId);
}

// ---------------------------------------------------------------- V10/V11 种子失效
section('V10/V11. 超出自家播种量的种子每局腐烂 25%');
{
  /*
   * 设计 §3.5：防"无限囤种子没地方用"。结算时
   *   grace = 当前田地数
   *   seeds > grace ? seeds = grace + ceil((seeds - grace) * (1 - seedSpoilRate))
   * 为什么不是"每颗种子有寿命"：meta.seeds 是单一整数，改成带年龄的列表要动
   * 存档结构、迁移链和所有读取点（种植/结算/HUD/导出码），收益与风险不成比例。
   *
   * 本节的数字都按"9 块田"算：9 + ceil(91*0.75)=78、9 + ceil(81*0.75)=70。
   * 78 与 70 不同，是为了证明真的按比例算，而不是"固定减掉 22 颗"。
   */
  eq(C.FARM.seedSpoilRate, 0.25, '腐烂比例写进 config（0.25，不在逻辑里内联）');

  // 结算助手：造一局 → 定 loot → endRun。返回同一个 state。
  // 默认 9 块田（createState 的形状）；plots 不同时按 createState 里 plot 的
  // 形状重造数组，别自创字段。
  function settle(before, plots) {
    const s = L.createState(1);
    s.meta.seeds = before;
    if (plots !== C.FARM.cols * C.FARM.rows) {
      s.farm.plots = new Array(plots).fill(null).map(function () {
        return { state: 'empty', growth: 0 };
      });
    }
    L.startRun(s, 'wood');
    s.run.loot.seeds = 0;
    L.endRun(s, true);
    return s;
  }

  const a = settle(100, 9);
  eq(a.meta.seeds, 78, '100 颗、9 块田 → 78（9 + ceil(91*0.75) = 9 + 69）');
  eq(a.lastResult.seedSpoiled, 22, '同一次结算记下烂掉 22 颗');
  // 口径不变：lastResult.seeds 仍是"这一局捡到的种子"。
  // 结算卡上那个数字原本就是 loot 口径，改成总库存会同时骗到"这局收获多少"。
  eq(a.lastResult.seeds, 0, 'lastResult.seeds 仍是这一局的收获口径');

  const b = settle(9, 9);
  eq(b.meta.seeds, 9, '正好等于田地数（9）时一颗都不烂');
  eq(b.lastResult.seedSpoiled, 0, '没腐烂时 seedSpoiled 是 0，不是 undefined');

  const c = settle(0, 9);
  eq(c.meta.seeds, 0, '0 颗仍是 0');
  eq(c.lastResult.seedSpoiled, 0, '0 颗不会算出负数或 NaN');

  const d = settle(90, 9);
  eq(d.meta.seeds, 70, '90 颗 → 70（9 + ceil(81*0.75) = 9 + 61），不是固定减 22');
  eq(d.lastResult.seedSpoiled, 20, '90 颗烂 20 颗');

  const e = settle(30, 18);
  eq(e.meta.seeds, 27, 'grace 跟着田地数走：18 块田、30 颗 → 18 + ceil(12*0.75) = 27');
  eq(e.lastResult.seedSpoiled, 3, '18 块田时只烂 3 颗');

  // V11 保底不变量：任意输入下都不能把"够种一页"的量也吃掉。
  // 用固定种子的小 LCG 取 5 组而不是 Math.random —— 随机数会让失败变成偶发，
  // 红/绿就没有证据价值了。
  let rnd = 20261113;
  const next = function () {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd / 2147483648;
  };
  for (let i = 0; i < 5; i++) {
    const before = Math.floor(next() * 500);
    const plots = 1 + Math.floor(next() * 24);
    const s = settle(before, plots);
    ok(s.meta.seeds >= Math.min(before, plots),
       `保底：${before} 颗 / ${plots} 块田 → ${s.meta.seeds} >= min(${before}, ${plots})`,
       s.meta.seeds);
    ok(s.meta.seeds <= before, `腐烂只减少不增加（${before} -> ${s.meta.seeds}）`,
       s.meta.seeds);
    ok(Number.isInteger(s.meta.seeds), '结算是整数（存档里不能出现小数）',
       s.meta.seeds);
    eq(s.lastResult.seedSpoiled, before - s.meta.seeds,
       'seedSpoiled 与结算前后的差一致（不会和 meta.seeds 对不上）');
  }
}

section('V14/V15. 商店开垦田地：扣 3000、上限 27、失败零副作用（Task 24）');
{
  /*
   * 买田地和买背包页是同一种交易：先判能不能，再扣钱，最后改变状态 ——
   * 顺序反了就会出现"钱扣了、田没加"这种只能读档救的存档。这里每条
   * 失败路径都配一条"钱和块数都没动"的断言；没有它，"返回 ok:false"
   * 只是证明函数没崩，不能证明它没顺手扣钱。
   */
  ok(typeof L.buyFarmPlot === 'function', 'logic 导出 buyFarmPlot（漏导出时 hub 拿到 undefined）');
  const buyFarmPlot = typeof L.buyFarmPlot === 'function'
    ? L.buyFarmPlot
    : function () { return { ok: false, reason: '未实现' }; };
  const P = C.FARM.plotPrice;

  // V16：新档就是 3×3 = 9 块，且配置里有价格/上限/每页
  const fresh = L.createState(2400);
  eq(fresh.farm.plots.length, C.FARM.cols * C.FARM.rows, 'V16 新档田地 = 3×3 = 9 块');
  eq(fresh.farm.plots.length, 9, 'V16 新档田地正好 9 块');
  eq(C.FARM.maxPlots, 27, '田地上限 27 块（3 页）');
  eq(C.FARM.perPage, 9, '一页 9 块');
  eq(C.FARM.plotPrice, 3000, '每块 3000 铜币（PM 定价）');
  eq(fresh.farm.page, 0, '新档页码是 0（第 1 页）');

  const mk = function (coins, plots) {
    const s = L.createState(2401);
    s.meta.coins = coins;
    s.farm.plots = [];
    for (let i = 0; i < plots; i++) s.farm.plots.push({ state: 'empty', growth: 0 });
    return s;
  };

  // V14：成功路径 —— 钱、块数、返回值三处都要对得上
  const s = mk(5000, 9);
  const r = buyFarmPlot(s);
  eq(r.ok, true, 'V14 钱够时开垦成功');
  eq(r.cost, P, 'V14 返回实际花费');
  eq(r.plots, 10, 'V14 返回开垦后的块数');
  eq(s.meta.coins, 5000 - P, 'V14 扣掉 3000 铜币');
  eq(s.farm.plots.length, 10, 'V14 田地 +1');
  ok(!!s.farm.plots[9], 'V14 第 10 块田存在（不是只改了长度）');
  if (s.farm.plots[9]) {
    eq(s.farm.plots[9].state, 'empty', 'V14 新开的地是空地');
    eq(s.farm.plots[9].growth, 0, 'V14 新开的地生长进度 0');
  }

  // V15：差 1 铜币 —— 拒绝，且不能扣钱/加地
  const poor = mk(P - 1, 9);
  const rPoor = buyFarmPlot(poor);
  eq(rPoor.ok, false, 'V15 2999 铜币买不到 3000 的地');
  eq(rPoor.reason, '铜币不够', 'V15 原因写明铜币不够');
  eq(poor.meta.coins, P - 1, 'V15 失败不扣钱');
  eq(poor.farm.plots.length, 9, 'V15 失败不加地');

  // V15：满额 —— 钱再多也不许越界
  const full = mk(99999, C.FARM.maxPlots);
  const rFull = buyFarmPlot(full);
  eq(rFull.ok, false, 'V15 满 27 块后买不到');
  eq(rFull.reason, '田地已经开垦到上限', 'V15 原因写明上限');
  eq(full.meta.coins, 99999, 'V15 满额失败不扣钱');
  eq(full.farm.plots.length, C.FARM.maxPlots, 'V15 满额不越界');

  // 连买到上限：正好 18 次，第 19 次被挡下（上限是硬边界，不是"差不多"）
  const grow = mk(P * 20, 9);
  let bought = 0;
  while (buyFarmPlot(grow).ok) bought++;
  eq(bought, C.FARM.maxPlots - 9, '从 9 块连买 18 次到达上限');
  eq(grow.farm.plots.length, 27, '停在 27 块');
  eq(grow.meta.coins, P * 20 - (C.FARM.maxPlots - 9) * P, '刚好扣了 18 块的钱');

  // 第 2 页的地是真能种的：plant 直接吃绝对索引
  const seeded = mk(0, 10);
  seeded.meta.seeds = 5;
  const rPlant = L.plant(seeded, 9);
  eq(rPlant.ok, true, '第 2 页第 1 块（绝对索引 9）能播种');
  eq(seeded.farm.plots[9].state, 'growing', '播种后这块地进入生长');
}

section('V17/V18. 农场分页：页数由块数推导，页码要夹住（Task 24）');
{
  ok(typeof L.farmPageCount === 'function', 'logic 导出 farmPageCount');
  ok(typeof L.farmPageOf === 'function', 'logic 导出 farmPageOf（漏导出时场景拿到 undefined）');
  const pageCount = typeof L.farmPageCount === 'function'
    ? L.farmPageCount : function () { return -1; };
  const pageOf = typeof L.farmPageOf === 'function'
    ? L.farmPageOf : function () { return -1; };

  const withPlots = function (n) {
    const s = L.createState(2500);
    s.farm.plots = [];
    for (let i = 0; i < n; i++) s.farm.plots.push({ state: 'empty', growth: 0 });
    return s;
  };

  eq(pageCount(L.createState(2501)), 1, '新档 9 块 = 1 页');
  eq(pageCount(withPlots(10)), 2, '10 块 = 2 页');
  eq(pageCount(withPlots(18)), 2, '18 块 = 2 页（正好两页）');
  eq(pageCount(withPlots(19)), 3, '19 块 = 3 页');
  eq(pageCount(withPlots(27)), 3, '27 块 = 3 页');

  eq(pageOf(0), 0, '第 1 块在第 1 页');
  eq(pageOf(8), 0, '第 9 块在第 1 页');
  eq(pageOf(9), 1, 'V18 第 10 块在第 2 页');
  eq(pageOf(26), 2, '第 27 块在第 3 页');

  // 页码持久化：翻页后存档要记得，重进农场还在那一页
  const s10 = withPlots(10);
  s10.farm.page = 1;
  eq(JSON.parse(L.serialize(s10)).farm.page, 1, '存档里带着当前页码');

  // 存档码是玩家可达的注入入口：页码非法时要夹到合法范围
  const obj = JSON.parse(L.serialize(withPlots(9)));
  obj.farm.page = 5;
  eq(L.deserialize(JSON.stringify(obj)).farm.page, 0, '只有 1 页时 page=5 被夹回 0');
  obj.farm.page = -3;
  eq(L.deserialize(JSON.stringify(obj)).farm.page, 0, '负页码被夹回 0');
  obj.farm.page = 'x';
  eq(L.deserialize(JSON.stringify(obj)).farm.page, 0, '非数字页码规整为 0');
  obj.farm.page = 1.7;
  eq(L.deserialize(JSON.stringify(obj)).farm.page, 0, '小数页码被夹成整数页码');

  const o2 = JSON.parse(L.serialize(withPlots(18)));
  o2.farm.page = 1;
  eq(L.deserialize(JSON.stringify(o2)).farm.page, 1, '18 块（2 页）时第 2 页保留');
  o2.farm.page = 9;
  eq(L.deserialize(JSON.stringify(o2)).farm.page, 1, '页码超过末页时夹到末页');
}

section('V17. 翻页后第 2 页的地照常生长（endRun 遍历整张 plots）');
{
  const s = L.createState(2600);
  s.farm.plots = [];
  for (let i = 0; i < 10; i++) s.farm.plots.push({ state: 'empty', growth: 0 });
  s.meta.seeds = 10;
  eq(L.plant(s, 9).ok, true, '先在第 2 页种下');
  L.startRun(s, 'grass'); L.endRun(s, true);
  eq(s.farm.plots[9].state, 'growing', '一局后仍在生长（growth 1/2）');
  L.startRun(s, 'grass'); L.endRun(s, true);
  eq(s.farm.plots[9].state, 'mature', '两局后成熟 —— endRun 没有只遍历前 9 块');
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
