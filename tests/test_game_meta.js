/**
 * test_game_meta.js — 玩家档案与基地交互的测试。
 *
 * 覆盖：
 *   - 多档案互不覆盖（"每个玩家有自己的数据"的核心保证）
 *   - 存档码导出/导入往返
 *   - 基地区域判定（走到哪算不算在那个区域里）
 *   - 区域动作的可用性与禁用原因
 *   - 动作执行后状态真的变了
 *
 * 用法: node tests/test_game_meta.js
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
const L = require(path.join(__dirname, '..', 'game', 'logic.js'));
const P = require(path.join(__dirname, '..', 'game', 'profile.js'));
const H = require(path.join(__dirname, '..', 'game', 'hub.js'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}` + (detail !== undefined ? `  -> ${detail}` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(t) { console.log(`\n=== ${t} ===`); }

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// ---------------------------------------------------------------- 档案
section('1. 多档案互不覆盖');
{
  const store = makeStorage();
  ok(P.createProfile(store, '小明').ok, '可以建第一个档案');
  ok(P.createProfile(store, '小红').ok, '可以建第二个档案');
  ok(!P.createProfile(store, '小明').ok, '重名会被拒绝（不会静默覆盖）');
  eq(P.listProfiles(store).length, 2, '档案列表里有两个人');

  const s1 = L.createState(11);
  s1.meta.coins = 500; s1.meta.skills.whirl = 3;
  const s2 = L.createState(22);
  s2.meta.coins = 7;

  P.saveRaw(store, '小明', L.serialize(s1));
  P.saveRaw(store, '小红', L.serialize(s2));

  const a = L.deserialize(P.loadRaw(store, '小明'));
  const b = L.deserialize(P.loadRaw(store, '小红'));
  eq(a.meta.coins, 500, '档案 A 的铜币没被 B 覆盖');
  eq(b.meta.coins, 7, '档案 B 的铜币没被 A 覆盖');
  eq(a.meta.skills.whirl, 3, '档案 A 的技能等级保留');
  eq(b.meta.skills.whirl, 1, '档案 B 的技能等级独立');

  P.deleteProfile(store, '小红');
  eq(P.listProfiles(store).length, 1, '删除后只剩一个档案');
  eq(L.deserialize(P.loadRaw(store, '小明')).meta.coins, 500, '删除别人不影响 A');
}

section('2. 档案名规整');
{
  eq(P.normalize('  张三  '), '张三', '去掉首尾空格');
  eq(P.normalize('a b'), 'a_b', '内部空格转下划线（避免键名问题）');
  eq(P.normalize(''), '', '空名返回空');
  ok(P.normalize('x'.repeat(50)).length <= 20, '超长名字被截断', P.normalize('x'.repeat(50)).length);
  const store = makeStorage();
  ok(!P.createProfile(store, '   ').ok, '纯空格的名字被拒绝');
}

section('3. 存档码导出/导入往返');
{
  const s = L.createState(99);
  s.meta.coins = 1234; s.meta.seeds = 5; s.meta.skills.nova = 2;
  const json = L.serialize(s);
  const code = P.exportCode('行者', json);
  ok(typeof code === 'string' && code.indexOf('|') > 0, '导出的是一行存档码');
  ok(code.indexOf('\n') < 0, '不含换行（方便聊天粘贴）');

  const back = P.importCode(code);
  ok(back.ok, '能被解析回来', back.reason);
  eq(back.name, '行者', '名字还原');
  const restored = L.deserialize(back.json);
  eq(restored.meta.coins, 1234, '铜币还原');
  eq(restored.meta.skills.nova, 2, '大招等级还原');

  ok(!P.importCode('乱码').ok, '格式不对的存档码被拒绝');
  ok(!P.importCode('名字|不是base64!!').ok, '内容损坏的存档码被拒绝');
}

// ---------------------------------------------------------------- 基地
section('4. 基地区域判定');
{
  const s = L.createState(5);
  H.ensureHub(s);
  // 位置不写死数字：建筑加进基地后坐标必然调整，
  // 写死会让"新增一个建筑"变成一堆无关测试变红。
  H.ZONES.forEach((z) => {
    s.hub.x = z.x;
    eq(H.zoneAt(s).id, z.id, `站在「${z.name}」位置判定为该区域`);
  });

  // 区域之间的空隙应当判定为"不在任何区域"：
  // 取相邻两区判定边界的中点，那里必须落空。
  const sorted = H.ZONES.slice().sort((a, b) => a.x - b.x);
  let gapsChecked = 0, gapsOk = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const leftEdge = sorted[i].x + sorted[i].reach;
    const rightEdge = sorted[i + 1].x - sorted[i + 1].reach;
    if (rightEdge <= leftEdge) continue;         // 相邻无空隙，跳过
    const mid = (leftEdge + rightEdge) / 2;
    gapsChecked += 1;
    s.hub.x = mid;
    if (H.zoneAt(s) === null) gapsOk += 1;
  }
  ok(gapsChecked > 0, '确实存在区域之间的空隙', `${gapsChecked} 处`);
  eq(gapsOk, gapsChecked, '走在区域之间的空隙时没有可交互对象');
}

section('5. 基地走动');
{
  const s = L.createState(6);
  H.ensureHub(s);
  s.hub.x = 480; s.hub.z = 100;
  for (let i = 0; i < 30; i++) H.moveHub(s, { right: true }, 1 / 60);
  ok(s.hub.x > 480, '按右会向右走', s.hub.x.toFixed(1));
  const zBefore = s.hub.z;
  for (let i = 0; i < 20; i++) H.moveHub(s, { up: true }, 1 / 60);
  ok(s.hub.z > zBefore, '在基地里按 W 也是往远处走（与战斗一致）', s.hub.z.toFixed(1));

  // 边界
  for (let i = 0; i < 600; i++) H.moveHub(s, { right: true }, 1 / 60);
  ok(s.hub.x <= H.HUB_W - 40 + 0.01, '不会走出基地右边界', s.hub.x.toFixed(1));
}

section('6. 区域动作的可用性');
{
  const s = L.createState(7);
  s.meta.coins = 0; s.meta.seeds = 0;

  // 田地不再出面板（按 J 直接进农场场景），所以这里只断言它不再列出动作，
  // 避免留下"测试通过但成品里根本走不到"的死路径。
  eq(H.zoneActions(s, 'field').length, 0,
     '田地不列面板动作（改了会重新出现不可达的死路径）');

  const anvil = H.zoneActions(s, 'anvil');
  eq(anvil.length, 3, '铁匠铺有三条强化');
  ok(anvil.every((a) => !a.enabled), '没钱时全部不可购买');

  const altar = H.zoneActions(s, 'altar');
  eq(altar.length, C.SKILL_ORDER.length, '祭坛列出全部技能');
  ok(altar.find((a) => a.payload.key === 'nova').ultimate === true, '大招被标记出来');

  const gate = H.zoneActions(s, 'gate');
  // 门口现在有两类入口：普通难度 + Boss 挑战。
  // 之前断言"数量等于难度数"，加了 Boss 后失效 —— 改成按类型分别断言，
  // 这样以后再加入口不会又让这条测试变红。
  const normalRuns = gate.filter((a) => a.kind === 'run');
  const bossRuns = gate.filter((a) => a.kind === 'boss');
  eq(normalRuns.length, C.DIFFICULTIES.length, '门口列出全部普通难度');
  eq(bossRuns.length, Object.keys(C.BOSS.tiers).length, '门口列出全部 Boss 难度档');
  ok(gate.every((a) => a.enabled), '任何入口都可以出发');
  // Boss 入口要标出它对应的装备门槛，否则玩家不知道该带什么来
  bossRuns.forEach((a) => {
    ok(a.sub && a.sub.length > 0, `Boss 入口「${a.label}」写明了门槛`, a.sub);
  });
}

section('6b. 药水铺（新增的第四个建筑）');
{
  // 建筑要真的存在于基地里，而不是只在代码里有个分支
  const shop = H.ZONES.find((z) => z.id === 'shop');
  ok(!!shop, '基地里有一个药水铺区域（新增建筑）');
  eq(shop.art, 'shop', '药水铺有自己的美术标记（不是复用铁砧）');

  const s = L.createState(77);
  H.ensureHub(s);
  s.hub.x = shop.x;
  eq(H.zoneAt(s).id, 'shop', '站在药水铺判定为药水铺');

  // 建在铁匠铺与祭坛之间：动线上"打完一局回来先补给"最顺
  ok(shop.x > 400 && shop.x < 620, '药水铺位于铁匠铺与祭坛之间', String(shop.x));
  // 新增建筑不能把原有四个区域挤掉
  ['field', 'anvil', 'altar', 'gate'].forEach((id) => {
    ok(!!H.ZONES.find((z) => z.id === id), `原有区域 ${id} 仍在`);
  });
  // 区域之间必须留出空隙，否则相邻区域会同时命中
  const sorted = H.ZONES.slice().sort((a, b) => a.x - b.x);
  let overlap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].x + sorted[i].reach >= sorted[i + 1].x - sorted[i + 1].reach) overlap += 1;
  }
  eq(overlap, 0, '任意两个区域的判定范围不重叠');

  // 动作清单：没钱时三种药水都不可买，但都要列出来让玩家看到价格
  const poor = L.createState(78);
  poor.meta.coins = 0;
  const acts = H.zoneActions(poor, 'shop');
  eq(acts.length, C.POTION_ORDER.length, '药水铺列出全部三种药水');
  eq(acts.map((a) => a.payload.id).join(','), C.POTION_ORDER.join(','), '顺序与配置一致');
  ok(acts.every((a) => !a.enabled), '没钱时都不可购买');
  ok(acts.every((a) => typeof a.cost === 'number' && a.cost > 0), '每种药水都标价');

  // 有钱时能买，且真的扣钱加携带
  const rich = L.createState(79);
  rich.meta.coins = 300;
  const acts2 = H.zoneActions(rich, 'shop');
  ok(acts2.every((a) => a.enabled), '钱够时都能买');
  const buyHeal = acts2.find((a) => a.payload.id === 'heal');
  const r = H.perform(rich, buyHeal);
  ok(r.ok, '通过 perform 买回春药成功', JSON.stringify(r));
  eq(rich.meta.potions.heal, 1, '回春药携带数 +1');
  eq(rich.meta.coins, 300 - C.POTIONS.heal.price, '扣掉对应铜币');

  // 带满后按钮要变灰并说明原因（而不是点了没反应）
  rich.meta.potions.heal = C.POTIONS.heal.carry;
  const acts3 = H.zoneActions(rich, 'shop');
  const full = acts3.find((a) => a.payload.id === 'heal');
  ok(!full.enabled, '带满后回春药不可再买');
  ok(full.disabledReason && full.disabledReason.length > 0,
     '带满后写明原因', full.disabledReason);

  // sub 行要写清效果与上限，玩家不需要猜
  ok(acts2.every((a) => a.sub && a.sub.length > 0), '每种药水都有说明行');
}

section('7. 农场田块几何（成品里点击播种走的就是这一段）');
section('7. 农场田块几何（成品里点击播种走的就是这一段）');
{
  const geo = H.farmLayout(960, 452);
  eq(geo.length, 9, '三行三列共 9 块田');
  eq(geo.map((g) => g.idx).join(','), '0,1,2,3,4,5,6,7,8', '索引连续且按行优先');

  // 三行确实有透视：越远的行越窄、越靠上
  const rowY = [geo[0].cy, geo[3].cy, geo[6].cy];
  ok(rowY[0] > rowY[1] && rowY[1] > rowY[2], '行位置自下而上排列', rowY.join(' > '));
  ok(geo[0].w > geo[6].w && geo[0].h > geo[6].h, '远处一行更窄更矮（透视成立）',
     `${geo[0].w.toFixed(0)}x${geo[0].h.toFixed(0)} → ${geo[6].w.toFixed(0)}x${geo[6].h.toFixed(0)}`);

  // 点击每块田的中心都必须命中自己
  let miss = 0;
  geo.forEach((g) => { if (H.farmHitPlot(geo, g.cx, g.cy) !== g.idx) miss += 1; });
  eq(miss, 0, '点击任一块田的中心都命中它自己');

  // 点在田外要返回 -1（不能误播种）
  eq(H.farmHitPlot(geo, 5, 5), -1, '点画面左上角不命中任何田');
  eq(H.farmHitPlot(geo, 480, 590), -1, '点画面底部中央不命中任何田');

  // 播种仍然走 logic.plant，且真的改变状态
  const s = L.createState(8);
  s.meta.seeds = 2;
  const hit = H.farmHitPlot(geo, geo[4].cx, geo[4].cy);
  ok(hit === 4, '命中第 5 块田', hit);
  ok(L.plant(s, hit).ok, '对该田播种成功');
  eq(s.farm.plots[4].state, 'growing', '第 5 块田进入生长');
  eq(s.meta.seeds, 1, '种子减少');

  // 钱够时买强化
  s.meta.coins = 1000;
  const anvil = H.zoneActions(s, 'anvil');
  const up = anvil.find((a) => a.payload.key === 'damage');
  ok(up.enabled, '钱够时强化可买');
  const before = s.meta.upgrades.damage;
  ok(H.perform(s, up).ok, '购买执行成功');
  eq(s.meta.upgrades.damage, before + 1, '强化等级 +1');

  // 技能升级
  const altar = H.zoneActions(s, 'altar');
  const sk = altar.find((a) => a.payload.key === 'whirl');
  const lvl0 = s.meta.skills.whirl;
  ok(H.perform(s, sk).ok, '技能可以升级');
  eq(s.meta.skills.whirl, lvl0 + 1, '技能等级 +1');
  ok(L.skillStats('whirl', lvl0 + 1).damage > L.skillStats('whirl', lvl0).damage,
     '升级后伤害确实提高');

  // 不可用的动作不能被强行执行
  s.meta.coins = 0;
  const anvil2 = H.zoneActions(s, 'anvil');
  const broke = anvil2.find((a) => a.payload.key === 'maxHp');
  ok(!H.perform(s, broke).ok, '钱不够时执行被拒绝（不能绕过 UI 判断）');
}

section('8. 技能升级到满级后关闭');
{
  const s = L.createState(9);
  s.meta.coins = 1e9;
  const max = C.SKILLS.nova.maxLevel;
  for (let i = 0; i < max; i++) L.buySkill(s, 'nova');
  eq(s.meta.skills.nova, max, '大招升到满级');
  eq(L.skillCost(s, 'nova'), null, '满级后没有下一档价格');
  const altar = H.zoneActions(s, 'altar');
  const nova = altar.find((a) => a.payload.key === 'nova');
  ok(!nova.enabled, '满级技能在祭坛里不可再买');
  eq(nova.disabledReason, '已满级', '禁用原因写明已满级');
}

// ---------------------------------------------------------------- 兵器架（装备商店）
section('兵器架：买 → 穿 → 升级 → 换装');
{
  const s = L.createState(4321);
  H.ensureHub(s);
  s.meta.coins = 5000;

  // 面板必须列全 35 件：这是玩家唯一能看到"还有什么装备、特效是什么"的地方
  const all = H.zoneActions(s, 'forgewear');
  eq(all.length, Object.keys(C.ALL_EQUIPMENT).length, '兵器架列出全部装备');
  const everySlot = C.EQUIP_SLOTS.every(function (slot) {
    return all.some(function (a) { return a.payload.slot === slot; });
  });
  ok(everySlot, '五个部位在兵器架里都有条目');

  const find = function (kind, id) {
    return H.zoneActions(s, 'forgewear')
      .find(function (a) { return a.kind === kind && a.payload.id === id; });
  };

  eq(H.perform(s, find('equip-buy', 'leatherHelm')).ok, true, '买下皮盔');
  eq(s.meta.coins, 5000 - C.equipDef('leatherHelm').price, '铜币按价格扣除');
  eq(L.equipOwned(s, 'leatherHelm'), 'owned', '买完进背包');

  eq(H.perform(s, find('equip-wear', 'leatherHelm')).ok, true, '从背包穿上皮盔');
  eq(s.meta.equipment.head.id, 'leatherHelm', '皮盔进了头部槽');
  eq(L.equipOwned(s, 'leatherHelm'), 'equipped', '装备状态跟着变');

  // 同一件不能再买
  const again = H.zoneActions(s, 'forgewear')
    .find(function (a) { return a.payload.id === 'leatherHelm' && a.kind === 'equip-buy'; });
  ok(!again, '已拥有的装备不再出现"购买"动作');

  const up = find('equip-upgrade', 'leatherHelm');
  ok(up && up.cost > 0, '已装备的装备出现升级动作', up && String(up.cost));
  eq(H.perform(s, up).ok, true, '升级成功');
  eq(s.meta.equipment.head.level, 2, '等级 +1');

  // 升到 2 级后再换掉再换回来，等级必须还在
  H.perform(s, find('equip-upgrade', 'leatherHelm'));
  eq(s.meta.equipment.head.level, 3, '升到 3 级');
  H.perform(s, find('equip-buy', 'ironHelm'));
  H.perform(s, find('equip-wear', 'ironHelm'));
  eq(s.meta.equipment.head.id, 'ironHelm', '换上了铁盔');
  eq(s.meta.inventory.indexOf('leatherHelm') >= 0, true, '换下来的皮盔回到背包');
  eq(s.meta.inventoryLevels.leatherHelm, 3, '换下来时等级记在背包里');
  L.equipItem(s, 'leatherHelm');
  eq(s.meta.equipment.head.level, 3, '换回来等级没有丢（升级成果不会被换装罚掉）');

  // 铜币不够时禁用并写明原因
  const poor = L.createState(4322);
  H.ensureHub(poor);
  poor.meta.coins = 0;
  const blocked = H.zoneActions(poor, 'forgewear')
    .find(function (a) { return a.payload.id === 'crystalStaff'; });
  ok(!blocked.enabled, '买不起时禁用');
  eq(blocked.disabledReason, '铜币不够', '禁用原因写明铜币不够');
  eq(H.perform(poor, blocked).ok, false, '禁用动作执行会失败');

  // 满级后升级动作消失（不是留一个按不动的按钮）
  const maxed = L.createState(4323);
  H.ensureHub(maxed);
  maxed.meta.coins = 999999;
  L.buyEquipment(maxed, 'strawShoes');
  L.equipItem(maxed, 'strawShoes');
  const maxLv = C.equipMaxLevel('strawShoes');
  for (let i = 1; i < maxLv; i++) L.upgradeEquipment(maxed, 'strawShoes');
  eq(maxed.meta.equipment.feet.level, maxLv, '基础装备升到满级 ' + maxLv);
  const maxedActions = H.zoneActions(maxed, 'forgewear')
    .filter(function (a) { return a.payload.id === 'strawShoes'; });
  eq(maxedActions.length, 1, '满级后只剩一个条目（没有可点的升级）');
  eq(maxedActions[0].kind, 'equip-owned', '满级条目的种类是"已拥有"');
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
