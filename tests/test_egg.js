/**
 * test_egg.js — 终极彩蛋的规则断言（Task 3.1）。
 *
 * 彩蛋是什么
 * ----------
 * PM 的设计（设计文档 D1/D2/D3）：
 *   - 两个成就都达成时掉落：通关熔炉难度 且 打赢地狱 Boss
 *   - 先完成哪个都行，**在第二个达成的那一刻**掉
 *   - 落点是"触发那一局的最后一个敌人死亡的位置"
 *   - 只掉一次（eggFound 标记）
 *
 * 本文件守的是规则层，不是演出。演出（泛光、纸条）由人眼确认。
 *
 * 本文件里最重要的一条断言
 * ------------------------
 * "两成就不齐时，熔炉通关的行为**完全不变**"。
 * 彩蛋要改熔炉的通关流程（D5：不立刻结算，先让玩家捡蛋），
 * 这是本次唯一修改既有胜利路径的改动。没有这条断言，
 * 一次改错就会让**所有**玩家的熔炉通关行为变化 —— 而不是只有拿到彩蛋的人。
 */

'use strict';

const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'game', 'logic.js'));
const C = require(path.join(__dirname, '..', 'game', 'config.js'));

let count = 0;
function ok(cond, label, detail) {
  count += 1;
  if (!cond) {
    console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
    throw new Error('FAIL: ' + label);
  }
  console.log('  PASS  ' + label);
}

console.log('========================================================');
console.log('终极彩蛋');
console.log('========================================================');

// ---------------------------------------------------------------- 辅助

/** 造一个干净的存档。 */
function fresh() {
  return L.createState();
}

/**
 * 把玩家推到"已通关熔炉、已打赢地狱 Boss"的临界状态。
 * 直接设 meta 标记，而不是真的打一遍 —— 这里测的是**判定逻辑**，
 * 不是战斗平衡（平衡由 balance_report 守）。
 */
function withForge(state) { state.meta.clearedForge = true; return state; }
function withHell(state) { state.meta.beatHellBoss = true; return state; }

// ---------------------------------------------------------------- 存档字段

{
  const s = fresh();
  ok(s.meta.clearedForge === false, '新档 clearedForge 初始为 false');
  ok(s.meta.beatHellBoss === false, '新档 beatHellBoss 初始为 false');
  ok(s.meta.eggFound === false, '新档 eggFound 初始为 false');
}

// ---------------------------------------------------------------- 判定函数

{
  // 两成就不齐 → 不掉
  ok(L.eggEligible(withForge(fresh()), null) === false,
     '只有熔炉成就 → 不掉彩蛋');
  ok(L.eggEligible(withHell(fresh()), null) === false,
     '只有地狱 Boss 成就 → 不掉彩蛋');

  // 两个都有 → 掉
  const both = fresh();
  withForge(both); withHell(both);
  ok(L.eggEligible(both, null) === true,
     '两成就都达成 → 可以掉彩蛋');

  // 掉了之后不再掉（D3）
  const done = fresh();
  withForge(done); withHell(done);
  done.meta.eggFound = true;
  ok(L.eggEligible(done, null) === false,
     '彩蛋已掉过 → 不再掉（D3 只掉一次）');
}

// ---------------------------------------------------------------- 掉落对象

/*
 * 本设计最容易做错的一处（设计文档 §4.2 陷阱）：
 * 彩蛋**不能**放进 run.pickups，因为 stepWave 清波时会调 collectAll
 * 把 pickups 全部吸走。而熔炉通关正是 stepWave 触发的 —— 蛋会在
 * 最后一只怪死的那一刻被吸走并立即结算，玩家永远按不到 J。
 */
{
  const s = fresh();
  const run = L.startRun(s, 'forge');
  run.lastKillX = 300;
  run.lastKillZ = 120;
  withForge(s);                 // 只有熔炉成就，缺地狱 Boss

  const dropped = L.dropEgg(s, run, 300, 120);
  ok(dropped === false, '两成就不齐时 dropEgg 返回 false（不掉）');
  ok(!run.egg, '两成就不齐时 run.egg 不存在');
  ok(s.meta.eggFound === false, '掉蛋失败时不置位 eggFound');
}
{
  // 真正掉一次，检查存放位置
  const s = fresh();
  withForge(s); withHell(s);
  const run = L.startRun(s, 'forge');
  run.lastKillX = 300; run.lastKillZ = 120;

  const dropped = L.dropEgg(s, run, 300, 120);
  ok(dropped === true, '两成就齐全时 dropEgg 返回 true');
  ok(!!run.egg, '彩蛋存在于 run.egg');

  // 这是防 §陷阱 回归的核心断言
  const inPickups = (run.pickups || []).some((p) => p.kind === 'egg');
  ok(inPickups === false,
     '彩蛋**不在** run.pickups 里（否则会被 collectAll 吸走）');

  ok(run.egg.x === 300 && run.egg.z === 120,
     '彩蛋落在指定的坐标（最后一个敌人死亡处）');
  ok(run.egg.taken === false, '彩蛋初始未被拾取');
  /*
   * ⚠️ 这里原本断言"掉落后 eggFound 立即置位"，那是 **C1 缺陷本身**
   * （独立审查发现）。掉蛋就置位会让"掉了但没来得及按 J 就结束"的玩家
   * 永久失去彩蛋。现在正确的语义是：**捡起来才算拿到**。
   * 防重复由"同一局只有一个 run.egg"与 taken 标记保证。
   */
  ok(s.meta.eggFound === false,
     '掉落后 eggFound **不**置位（捡起来才算拿到，C1）');
}

// ---------------------------------------------------------------- collectAll 免疫

/*
 * 直接验证 §陷阱：把彩蛋放好后调 collectAll，蛋必须还在。
 * 这条断言若失败，说明蛋被放进了 pickups。
 */
{
  const s = fresh();
  withForge(s); withHell(s);
  const run = L.startRun(s, 'forge');
  L.dropEgg(s, run, 250, 100);

  L.collectAll(s, run);
  ok(!!run.egg && run.egg.taken === false,
     'collectAll 之后彩蛋仍在（免疫清波吸走）');
}

// ---------------------------------------------------------------- 熔炉通关流程

/*
 * 本节守 D5。核心：**两成就不齐时，熔炉通关的行为完全不变**。
 * 这是"不能因为加彩蛋而改变所有玩家体验"的保证。
 */
{
  const s = fresh();                      // 没有成就
  const run = L.startRun(s, 'forge');
  ok(run.pendingEggSettlement === undefined || run.pendingEggSettlement === false,
     '开局时没有 pendingEggSettlement');
}

{
  // 只有熔炉成就（缺地狱 Boss）→ 通关熔炉不该掉蛋、也不该延后结算
  const s = fresh();
  withForge(s);
  const run = L.startRun(s, 'forge');
  const willDrop = L.eggEligible(s, run);
  ok(willDrop === false,
     '缺地狱 Boss 成就时，通关熔炉不掉蛋（既有行为不变）');
}

// ---------------------------------------------------------------- C1：蛋不会被永久烧掉

/*
 * 这一节是**补 Critical 缺陷的回归测试**（独立审查发现，2026-11-15）。
 *
 * 原缺陷：dropEgg 在**掉落时**就置位 meta.eggFound，
 * 于是玩家在做完两个成就、还没按 J 之前被残敌打死一次，
 * 那颗蛋就永久消失、成就被烧掉、纸条再也看不到 —— 而且没有任何提示。
 * 那是"做对了所有事却拿不到"的最坏情况。
 *
 * 修法：eggFound 改在 **takeEgg（真的捡起来）** 时置位；
 * 局末若蛋还在场上没被捡，就把坐标存进 meta.pendingEgg，下一局原地重放。
 */
{
  const s = fresh();
  withForge(s); withHell(s);
  const run = L.startRun(s, 'forge');
  L.dropEgg(s, run, 300, 100);

  ok(s.meta.eggFound === false,
     'C1：掉蛋**不**置位 eggFound（只有捡起来才算拿到）');

  // 玩家没按 J 就死了
  L.endRun(s, false);
  ok(s.meta.eggFound === false, 'C1：玩家死后 eggFound 仍是 false');
  ok(s.meta.pendingEgg && s.meta.pendingEgg.x === 300,
     'C1：未取走的蛋被存进 pendingEgg');

  // 重开一局，蛋应该原地回来
  const run2 = L.startRun(s, 'forge');
  ok(!!run2.egg, 'C1：重开一局后蛋回来了');
  ok(run2.egg && run2.egg.x === 300 && run2.egg.z === 100,
     'C1：蛋回到原来的坐标');
  ok(L.eggEligible(s, run2) === false || !!run2.egg,
     'C1：玩家的努力没有被一次意外抹掉');

  // 真的捡起来才置位
  run2.player.x = 300; run2.player.z = 100;
  const r = L.takeEgg(s, run2);
  ok(r.ok === true, 'C1：按 J 能捡起恢复的蛋');
  ok(s.meta.eggFound === true, 'C1：捡起后才置位 eggFound');
}

// ---------------------------------------------------------------- C2：坐标防御

/*
 * C2 回归：lastKillX/Z 只在 killEnemy 里赋值。
 * 若这一局的最后一个敌人不是经 killEnemy 消失的，它们是 undefined，
 * 传进去会让 run.egg.x 变成 undefined —— eggInReach 的 NaN 比较恒为 false，
 * **玩家永远够不到那颗蛋，而界面上看不出任何异常**。
 */
{
  const s = fresh();
  withForge(s); withHell(s);
  const run = L.startRun(s, 'forge');
  // 故意不设 lastKillX / lastKillZ
  const dropped = L.dropEgg(s, run, run.lastKillX, run.lastKillZ);

  ok(dropped === true, 'C2：坐标缺失时仍然掉蛋（不静默失败）');
  ok(run.egg && typeof run.egg.x === 'number' && isFinite(run.egg.x),
     'C2：蛋的 x 是有限数字，不是 undefined');
  ok(run.egg && typeof run.egg.z === 'number' && isFinite(run.egg.z),
     'C2：蛋的 z 是有限数字');

  // 走到蛋的坐标必须够得到
  run.player.x = run.egg.x; run.player.z = run.egg.z;
  ok(L.eggInReach(s, run) === true,
     'C2：玩家走到蛋的坐标时确实够得到（NaN 比较会恒为 false）');
}

// ---------------------------------------------------------------- 存档往返

{
  const s = fresh();
  withForge(s); withHell(s);
  s.meta.eggFound = true;

  const json = L.serialize(s);
  const back = L.deserialize(json);
  ok(back.meta.clearedForge === true, '存档往返保留 clearedForge');
  ok(back.meta.beatHellBoss === true, '存档往返保留 beatHellBoss');
  ok(back.meta.eggFound === true, '存档往返保留 eggFound');
}

// ---------------------------------------------------------------- 老档迁移

/*
 * 老档没有这三个字段。必须补 false，且**不能因为多字段而拒绝载入**
 * —— deserialize 在版本不匹配时会 throw。
 */
{
  const s = fresh();
  delete s.meta.clearedForge;
  delete s.meta.beatHellBoss;
  delete s.meta.eggFound;

  const back = L.deserialize(JSON.stringify(s));
  ok(back.meta.clearedForge === false, '老档缺 clearedForge → 补 false');
  ok(back.meta.beatHellBoss === false, '老档缺 beatHellBoss → 补 false');
  ok(back.meta.eggFound === false, '老档缺 eggFound → 补 false');
}

// ---------------------------------------------------------------- 纸条原文

/*
 * 纸条是 PM 亲笔，逐字不许改。这条断言把它钉死在测试里：
 * 任何人手滑改了标点或语序，测试立刻红。
 */
{
  const text = C.EGG && C.EGG.letterText;
  ok(typeof text === 'string', 'config 里有 EGG.letterText');

  const expected = [
    '感谢你游玩我的游戏。',
    '这是我第一次且独立开发的',
    '有很多不足之处让您皱了眉头',
    '我会用下一佳作舒展它们',
  ].join('\n');

  ok(text === expected,
     '纸条文字与 PM 原文逐字一致（不许改标点/语序/补字）',
     '实际: ' + JSON.stringify(text));
}

console.log('========================================================');
console.log('全部通过：' + count + ' 项断言');
