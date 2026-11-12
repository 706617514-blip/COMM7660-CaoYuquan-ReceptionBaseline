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
    // Task 11：判定改成二维（x 与纵深都要在容差内），所以必须同时站到
    // 该点位自己的纵深上；只对 x 会落在 z 容差之外，六个点位全变红。
    s.hub.z = z.z;
    eq((H.zoneAt(s) || {}).id, z.id, `站在「${z.name}」位置判定为该区域`);
  });

  // 区域之间的空隙应当判定为"不在任何区域"：
  // 取相邻两区判定边界的中点，那里必须落空。
  // 纵深先摆回默认值（HUB_D/2 = 105，门所在的中线），这样"空隙"就只剩
  // x 一个变量；否则上一次循环残留的 z 会把结论搅混。
  s.hub.z = 105;
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
  ok(r.ok, '通过 perform 买治疗药水成功', JSON.stringify(r));
  eq(rich.meta.potions.heal, 1, '治疗药水携带数 +1');
  eq(rich.meta.coins, 300 - C.POTIONS.heal.price, '扣掉对应铜币');

  // 带满后按钮要变灰并说明原因（而不是点了没反应）
  rich.meta.potions.heal = C.POTIONS.heal.carry;
  const acts3 = H.zoneActions(rich, 'shop');
  const full = acts3.find((a) => a.payload.id === 'heal');
  ok(!full.enabled, '带满后治疗药水不可再买');
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
  const bagHelm = s.meta.bag.filter(function (e) { return e.id === 'leatherHelm'; })[0];
  ok(!!bagHelm, '换下来的皮盔回到背包（v6 条目数组）', JSON.stringify(s.meta.bag));
  eq(bagHelm && bagHelm.level, 3, '换下来时等级记在条目上（不是另一张等级表）');
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
  eq(maxedActions.length, 2, '满级后仍有两个条目：满级状态 + 卸掉');
  ok(!maxedActions.some(function (a) { return a.kind === 'equip-upgrade'; }),
     '满级后没有可点的升级动作（不是留一个按不动的升级）');
  eq(maxedActions[0].kind, 'equip-owned', '第一条是"已满级"状态条目');
  ok(!maxedActions[0].enabled, '满级条目不可点');
  eq(maxedActions[0].disabledReason, '已满级 Lv.' + maxLv, '写明已满级');
  eq((maxedActions[1] || {}).kind, 'equip-unequip', '第二条是卸掉（满级的件也能卸）');
}

// ---------------------------------------------------------------- 兵器架三态（V14）
section('兵器架三态：购买 / 穿戴 / 升级 + 卸掉（V14）');
{
  const s = L.createState(4324);
  H.ensureHub(s);
  s.meta.coins = 5000;
  const rowsFor = function (id, filter) {
    return H.zoneActions(s, 'forgewear', filter).filter(function (a) {
      return a.payload && a.payload.id === id;
    });
  };

  // ① 没买：一个「购买」动作，label 仍是物品名
  const unowned = rowsFor('hornHelm');
  eq(unowned.length, 1, '没买的件只有一个动作');
  eq(unowned[0].kind, 'equip-buy', '没买的件动作是购买');
  eq(unowned[0].verb, '购买', '没买时按钮写"购买"');
  eq(unowned[0].label, C.equipDef('hornHelm').name, 'label 是物品名，不是按钮文案');

  // ② 买了没穿：一个「穿戴」动作，不花钱
  eq(H.perform(s, unowned[0]).ok, true, '买下角盔');
  const owned = rowsFor('hornHelm');
  eq(owned.length, 1, '买了没穿仍只有一个动作');
  eq(owned[0].kind, 'equip-wear', '买了没穿的动作是穿戴');
  eq(owned[0].verb, '穿戴', '买了没穿按钮写"穿戴"（旧实现只能写"执行"）');
  eq(owned[0].cost, 0, '穿戴不花钱');
  eq(owned[0].label, C.equipDef('hornHelm').name, '穿戴行 label 仍是物品名');

  // ③ 穿上：升级 + 卸掉 两条都要在（只给"卸掉"会让升级失去入口）
  eq(H.perform(s, owned[0]).ok, true, '穿上角盔');
  const worn = rowsFor('hornHelm');
  eq(worn.length, 2, '穿上后有两个动作（升级 + 卸掉）');
  eq(worn[0].kind, 'equip-upgrade', '第一条是升级');
  eq(worn[0].verb, '升级', '升级按钮写"升级"');
  ok(worn[0].cost > 0, '升级带价格（否则点下去不知道花多少）', String(worn[0].cost));
  eq((worn[1] || {}).kind, 'equip-unequip', '第二条是卸掉');
  eq((worn[1] || {}).verb, '卸掉', '卸掉按钮写"卸掉"');
  eq((worn[1] || {}).cost, 0, '卸掉不花钱');
  eq(worn[1] && worn[1].payload ? worn[1].payload.slot : null,
     C.equipDef('hornHelm').slot, '卸掉动作知道卸哪个部位');
  ok(worn.every(function (a) { return a.label === C.equipDef('hornHelm').name; }),
     '两条动作的 label 都是物品名');

  // ④ 卸掉真的落地：部位清空、件回背包、等级跟着走
  const lvBefore = s.meta.equipment.head.level;
  const un = H.perform(s, worn[1]);
  ok(un.ok, '通过 perform 执行「卸掉」', JSON.stringify(un));
  eq(s.meta.equipment.head, null, '卸掉后头部槽空了');
  eq(L.equipOwned(s, 'hornHelm'), 'owned', '卸下来的件回到背包（没有消失）');
  const bagHelm = s.meta.bag.filter(function (e) { return e.id === 'hornHelm'; })[0];
  eq(bagHelm && bagHelm.level, lvBefore, '等级跟着条目回背包');
  eq(rowsFor('hornHelm')[0].verb, '穿戴', '卸掉后又回到"穿戴"（三态真的闭环）');
}

section('兵器架动作带 uid：同名两件各穿各的（Task 3 三参修复从 UI 可达）');
{
  const s = L.createState(4325);
  H.ensureHub(s);
  s.meta.coins = 999999;
  s.meta.bag.length = 0;
  const i1 = L.bagAdd(s, 'hornHelm', 1);
  const i2 = L.bagAdd(s, 'hornHelm', C.equipMaxLevel('hornHelm'));
  const uid1 = s.meta.bag[i1].uid;
  const uid2 = s.meta.bag[i2].uid;
  ok(typeof uid1 === 'string' && uid1.length > 0 &&
     typeof uid2 === 'string' && uid2.length > 0 && uid1 !== uid2,
     '背包里两件同名装备各有 uid（logic 层的 uid 是字符串 u<n>）',
     JSON.stringify([uid1, uid2]));

  const rows = H.zoneActions(s, 'forgewear').filter(function (a) {
    return a.payload && a.payload.id === 'hornHelm';
  });
  eq(rows.length, 1, '兵器架按 id 出行（重复件不额外占一行）');
  eq((rows[0] || {}).kind, 'equip-wear', '背包里的件给穿戴动作');
  ok(rows[0] && rows[0].payload && rows[0].payload.uid !== undefined,
     '动作 payload 带 uid（旧实现只有 id/slot）');
  eq(rows[0] && rows[0].payload ? rows[0].payload.uid : null, uid2,
     'uid 指向等级最高的那件（sub 写满级就得穿满级那件）');
  ok(!!rows[0] && String(rows[0].sub).indexOf('Lv.' + C.equipMaxLevel('hornHelm')) >= 0,
     'sub 写的也是满级（显示与动作指向同一件）', rows[0].sub);

  eq(rows[0] ? H.perform(s, rows[0]).ok : false, true, '穿上');
  eq(s.meta.equipment.head.level, C.equipMaxLevel('hornHelm'),
     '穿上的确实是满级那件（uid 真的透传到 equipItem）');
  ok(L.bagIndexOfUid(s, uid1) >= 0, '1 级那件还在背包里（没被顺手穿走）');
}

section('兵器架页签：全部 / 未拥有 / 已拥有 / 已穿戴 / 特殊');
{
  const s = L.createState(4326);
  H.ensureHub(s);
  s.meta.coins = 5000;
  const total = Object.keys(C.ALL_EQUIPMENT).length;
  const specials = Object.keys(C.ALL_EQUIPMENT).filter(function (id) {
    return C.equipDef(id).kind === 'special';
  }).length;
  eq(H.zoneActions(s, 'forgewear').length, total, '不带 filter 时列全部（老调用不受影响）');
  eq(H.zoneActions(s, 'forgewear', 'all').length, total, '页签 all 也是全部');
  eq(H.zoneActions(s, 'forgewear', 'unowned').length, total, '新档全是未拥有');
  eq(H.zoneActions(s, 'forgewear', 'owned').length, 0, '新档没有已拥有');
  eq(H.zoneActions(s, 'forgewear', 'worn').length, 0, '新档没有已穿戴');
  eq(H.zoneActions(s, 'forgewear', 'special').length, specials, '特殊页签只列特效装备');

  L.buyEquipment(s, 'hornHelm');
  L.buyEquipment(s, 'ironHelm');
  L.equipItem(s, 'ironHelm');
  const unowned = H.zoneActions(s, 'forgewear', 'unowned');
  eq(unowned.length, total - 2, '未拥有页签只剩没买的件（买过的两件都消失）');
  eq(unowned.some(function (a) { return a.payload.id === 'hornHelm'; }), false,
     '已买(未穿)的角盔不在"未拥有"页签里');
  eq(unowned.some(function (a) { return a.payload.id === 'ironHelm'; }), false,
     '"已穿戴"的铁盔也不在"未拥有"页签里');
  ok(unowned.every(function (a) { return a.kind === 'equip-buy'; }),
     '未拥有页签里每一条都是购买动作（页签不改变三态）');
  // 注意口径：已拥有的件不是固定 1 行 —— 身上那件给"升级 + 卸掉"两行。
  const ownedTab = H.zoneActions(s, 'forgewear', 'owned');
  eq(ownedTab.length, 3, '已拥有页签=背包那件 1 行 + 身上那件 2 行');
  eq(ownedTab.filter(function (a) { return a.payload.id === 'hornHelm'; }).length, 1,
     '背包里的角盔只有 1 行（穿戴）');
  eq(ownedTab.filter(function (a) { return a.payload.id === 'ironHelm'; }).length, 2,
     '身上的铁盔有 2 行（升级 + 卸掉）');
  const wornTab = H.zoneActions(s, 'forgewear', 'worn');
  eq(wornTab.length, 2, '已穿戴页签只有身上那件的两条动作（升级 + 卸掉）');
  ok(wornTab.every(function (a) { return a.payload.id === 'ironHelm'; }), '已穿戴页签只含铁盔');
  eq(H.zoneActions(s, 'forgewear', '不存在').length,
     H.zoneActions(s, 'forgewear').length, '未知页签退化为不过滤（不白屏）');
}

section('铁匠铺分类与图标：cat / icon / 分类过滤（Task 17）');
{
  const s = L.createState(4331);
  H.ensureHub(s);
  s.meta.coins = 5000;

  const anvil = H.zoneActions(s, 'anvil');
  eq(anvil.length, 3, '铁匠铺仍是三条强化');
  eq(anvil.map(function (a) { return a.payload.key; }).join(','), 'damage,maxHp,speed',
     '强化顺序不变（分类与图标按这个顺序对齐）');
  // 没有分类字段的话，页签无从过滤；没有图标键的话，UI 不知道该贴哪张图。
  eq(anvil.map(function (a) { return a.cat; }).join(','), 'attack,defense,move',
     '三条各自带分类（damage→attack / maxHp→defense / speed→move）');
  eq(anvil.map(function (a) { return a.icon; }).join(','), 'ic-damage,ic-maxHp,ic-speed',
     '三条各自带图标键（UI 靠它取贴图）');

  // 页签必须真的过滤，而不是挂个 cat 字段让 UI 自己去猜
  const keysOf = function (filter) {
    return H.zoneActions(s, 'anvil', filter).map(function (a) { return a.payload.key; }).join(',');
  };
  eq(keysOf('attack'), 'damage', '页签「攻击」只剩锋刃');
  eq(keysOf('defense'), 'maxHp', '页签「生存」只剩耐力');
  eq(keysOf('move'), 'speed', '页签「机动」只剩轻步');
  eq(keysOf('all'), 'damage,maxHp,speed', '页签「全部」不过滤');
  eq(keysOf(undefined), 'damage,maxHp,speed', 'filter 缺省不过滤（老调用不受影响）');
  eq(H.zoneActions(s, 'anvil', '不存在').length, anvil.length,
     '未知分类退化为不过滤（与兵器架同一口径：宁可多显示，也别给一片空白）');

  // 过滤只影响"显示哪几条"，不能顺手改掉动作本身
  const rich = L.createState(4332);
  H.ensureHub(rich);
  rich.meta.coins = 5000;
  const dmg = H.zoneActions(rich, 'anvil', 'attack')[0];
  ok(dmg.enabled, '分类过滤出来的动作仍然可用（过滤不改 enabled）');
  ok(H.perform(rich, dmg).ok, '分类过滤出来的动作能真的执行');
  eq(rich.meta.upgrades.damage, 1, '执行后锋刃等级 +1');
}

section('兵器架每行带装备贴图键（Task 17 / 设计 §5.1 欠账）');
{
  const s = L.createState(4333);
  H.ensureHub(s);
  s.meta.coins = 5000;
  const all = H.zoneActions(s, 'forgewear');
  const total = Object.keys(C.ALL_EQUIPMENT).length;
  eq(all.length, total, '兵器架仍列全部 ' + total + ' 件（加图标不改行数）');

  const wrong = all.filter(function (a) {
    return a.icon !== 'eq-' + a.payload.slot + '-' + a.payload.id;
  });
  eq(wrong.length, 0, '每行 icon 都是 eq-<slot>-<id>（' + total + ' 行全中）',
     wrong.slice(0, 3).map(function (a) { return a.label + '→' + a.icon; }).join(' '));
  // 抽查三个不同部位：全部拿同一个部位的 key 也能让上面那条瞎绿
  const iconOf = function (id) {
    const hit = all.filter(function (a) { return a.payload.id === id; })[0];
    return hit ? hit.icon : null;
  };
  eq(iconOf('leatherHelm'), 'eq-head-leatherHelm', '头部：皮盔的图标键带 head');
  eq(iconOf('crystalStaff'), 'eq-weapon-crystalStaff', '武器：棱晶杖的图标键带 weapon');
  eq(iconOf('strawShoes'), 'eq-feet-strawShoes', '脚部：草鞋的图标键带 feet');
  const uniq = new Set(all.map(function (a) { return a.icon; }));
  eq(uniq.size, total, '35 个图标键两两不同（不是全贴同一张图）', uniq.size + ' 个唯一键');

  // 加 icon 不能顺手改了动作语义。下面三条是**改图标前实测**的快照
  // （commit acd36bc，state=createState(4327)、coins 5000），原样钉住。
  const snap = function (id) {
    const hit = all.filter(function (a) { return a.payload.id === id; })[0] || {};
    return [hit.kind, hit.label, hit.cost, hit.enabled, hit.verb].join('|');
  };
  eq(snap('leatherHelm'), 'equip-buy|皮盔|80|true|购买', '皮盔动作字段与加图标前一致');
  eq(snap('crystalStaff'), 'equip-buy|棱晶杖|900|true|购买', '棱晶杖动作字段与加图标前一致');
  eq(snap('strawShoes'), 'equip-buy|草鞋|80|true|购买', '草鞋动作字段与加图标前一致');
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
