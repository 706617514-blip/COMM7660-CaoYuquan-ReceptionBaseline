/**
 * test_farm_crops.js — 作物种植（Task 4 / D6）。
 *
 * PM 的要求（D6）：
 *   「远征掉种子 → 种 → 等成熟 → 收获才能用」
 *   PM 原话：**"不种还要农场干啥？"**
 *
 * 设计选择（见交付说明）：**不废掉通用种子**，而是新增一条作物通道。
 *   meta.seeds          通用种子（整数）—— 语义与行为**完全不变**
 *   meta.cropSeeds      作物种子（{ id: n }）—— 新增
 *   farm.plots[i].crop  这块田种的是什么（老田没有 = 通用作物）
 *
 * 这样做的收益：test_game_logic 的 650 条断言**一条都不用改** ——
 * 那是"没有弄坏既有农场经济"的最好证明。
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
console.log('作物种植');
console.log('========================================================');

// ---------------------------------------------------------------- 作物表

{
  const crops = C.CROPS;
  ok(!!crops, 'config 里有 CROPS 表');
  const ids = Object.keys(crops || {});
  ok(ids.length >= 3, `至少 3 种作物（实际 ${ids.length} 种）`);

  // 每种作物必须有可食用的效果，否则"收获了不知道干嘛"
  const noEffect = ids.filter((id) => {
    const d = crops[id];
    return !d.effect || !d.effect.kind;
  });
  ok(noEffect.length === 0, '每种作物都有 effect.kind', JSON.stringify(noEffect));

  // 效果必须落在既有的两种 kind 里（instant / buff），
  // 这样收获物能直接复用 POTIONS 那套使用路径（D7 最小版）
  const badKind = ids.filter((id) => {
    const k = crops[id].effect.kind;
    return k !== 'instant' && k !== 'buff';
  });
  ok(badKind.length === 0, '效果 kind 只能是 instant 或 buff', JSON.stringify(badKind));
}

// ---------------------------------------------------------------- 新档

{
  const s = L.createState();
  ok(typeof s.meta.cropSeeds === 'object' && s.meta.cropSeeds !== null,
     '新档有 meta.cropSeeds（对象）');
  ok(s.meta.seeds === 3, '通用种子初始仍是 3（既有行为不变）');
}

// ---------------------------------------------------------------- 种植

{
  const s = L.createState();
  const ids = Object.keys(C.CROPS);
  const first = ids[0];

  // 没有作物种子时种不了
  const r0 = L.plantCrop(s, 0, first);
  ok(r0.ok === false, '没有该作物的种子时种不下去');

  // 给种子后能种
  s.meta.cropSeeds[first] = 2;
  const r1 = L.plantCrop(s, 0, first);
  ok(r1.ok === true, '有种子时能种');
  ok(s.meta.cropSeeds[first] === 1, '种下去消耗 1 颗该作物的种子');
  ok(s.farm.plots[0].state === 'growing', '田地进入 growing');
  ok(s.farm.plots[0].crop === first, '田地记住了种的是什么作物');

  // 已种的田不能再种
  const r2 = L.plantCrop(s, 0, first);
  ok(r2.ok === false, '已种的田不能再种');
}

// ---------------------------------------------------------------- 成熟与收获

{
  const s = L.createState();
  const first = Object.keys(C.CROPS)[0];
  s.meta.cropSeeds[first] = 1;
  L.plantCrop(s, 0, first);

  // 通用种子也给足，保证既有农场逻辑能跑
  s.meta.seeds = 10;

  /*
   * 推进到成熟。
   *
   * ⚠️ 成熟后是**自动收获**的（见 endRun 里的说明），所以
   * runsToMature 局跑完，田已经空了、收获物已经入库 —— 不会停在 mature。
   * 这条行为是设计要的：既有通用作物就是"成熟后自动产出"，
   * 同一农场不该有两套规则（种植手动=决策，收获自动=结果）。
   *
   * 因此要观察"成熟"这个中间态，必须**少跑一局**：
   *   runsToMature-1 局 → 还差一局，若 runsToMature == 2 则此时已 mature
   * 这里直接断言最终结果（收获物到手 + 田变空），
   * 那才是玩家能看到的实事，比断言中间态更结实。
   */
  const need = C.FARM.runsToMature;
  for (let i = 0; i < need - 1; i++) {
    L.startRun(s, 'grass'); L.endRun(s, false);
  }
  if (need > 1) {
    ok(s.farm.plots[0].state === 'growing',
       `还差 1 局时仍在生长（增长 ${s.farm.plots[0].growth}/${need}）`);
  }
  L.startRun(s, 'grass'); L.endRun(s, false);

  ok((s.meta.cropHarvest[first] || 0) === 1,
     `${need} 局后收获物自动入库（成熟即收获）`);
  ok(s.farm.plots[0].state === 'empty', '收获后田自动变空');
  ok(!s.farm.plots[0].crop, '收获后田里的作物标记被清掉');

  // 手动收获 API 仍然可用（用于"玩家在成熟那一刻恰好点了一下"的情形）
  s.meta.cropSeeds[first] = 1;
  L.plantCrop(s, 1, first);
  s.farm.plots[1].state = 'mature';
  s.farm.plots[1].growth = need;
  const r = L.harvestCrop(s, 1);
  ok(r.ok === true, '成熟的田也能手动收获（API 保留）');
  ok((s.meta.cropHarvest[first] || 0) === 2, '手动收获也进 cropHarvest');
}

// ---------------------------------------------------------------- 不能重复收获

{
  const s = L.createState();
  const r = L.harvestCrop(s, 0);
  ok(r.ok === false, '空田不能收获');
}

// ---------------------------------------------------------------- 吃下去

{
  const s = L.createState();
  const first = Object.keys(C.CROPS)[0];
  s.meta.cropHarvest[first] = 1;
  const run = L.startRun(s, 'grass');
  run.player.hp = 30;
  const before = run.player.hp;

  const r = L.eatCrop(s, run, first);
  ok(r.ok === true, '有收获物时能吃');
  ok((s.meta.cropHarvest[first] || 0) === 0, '吃掉后库存减 1');

  const def = C.CROPS[first];
  if (def.effect.kind === 'instant' && def.effect.heal) {
    ok(run.player.hp > before,
       `吃下回血作物后血量上升（${before} → ${run.player.hp}）`);
  }
  if (def.effect.kind === 'buff') {
    ok(!!run.player.potionBuff || !!run.player.cropBuff,
       '吃下增益作物后有 buff');
  }
}

// ---------------------------------------------------------------- 老档迁移

{
  const s = L.createState();
  delete s.meta.cropSeeds;
  delete s.meta.cropHarvest;

  const back = L.deserialize(JSON.stringify(s));
  ok(typeof back.meta.cropSeeds === 'object' && back.meta.cropSeeds !== null,
     '老档缺 cropSeeds → 补空对象');
  ok(typeof back.meta.cropHarvest === 'object' && back.meta.cropHarvest !== null,
     '老档缺 cropHarvest → 补空对象');
  ok(back.meta.seeds === 3,
     '老档的通用种子语义不变（仍是整数 3）');
}

// ---------------------------------------------------------------- 存档往返

{
  const s = L.createState();
  const first = Object.keys(C.CROPS)[0];
  s.meta.cropSeeds[first] = 5;
  s.meta.cropHarvest[first] = 2;

  const back = L.deserialize(L.serialize(s));
  ok(back.meta.cropSeeds[first] === 5, '存档往返保留 cropSeeds');
  ok(back.meta.cropHarvest[first] === 2, '存档往返保留 cropHarvest');
}

// ---------------------------------------------------------------- 腐烂

/*
 * 通用种子的腐烂规则**行为必须不变**（既有 650 条断言守着）。
 * 这里只验证新增的作物种子也有腐烂，且不干扰通用种子。
 */
{
  const s = L.createState();
  s.farm.plots.forEach((p, i) => { p.state = 'empty'; });
  s.meta.seeds = 20;                    // 远超田地数
  const first = Object.keys(C.CROPS)[0];
  s.meta.cropSeeds[first] = 20;

  const beforeSeeds = s.meta.seeds;
  const run = L.startRun(s, 'grass');
  L.endRun(s, false);

  ok(s.meta.seeds < beforeSeeds, '通用种子超额部分仍会腐烂（既有行为）');
  ok(s.meta.cropSeeds[first] < 20, '作物种子超额部分也会腐烂');
}

console.log('========================================================');
console.log('全部通过：' + count + ' 项断言');
