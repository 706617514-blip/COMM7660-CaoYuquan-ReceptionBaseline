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
  s.hub.x = 150;
  eq(H.zoneAt(s).id, 'field', '站在田地位置判定为田地');

  s.hub.x = 400;
  eq(H.zoneAt(s).id, 'anvil', '站在铁匠铺判定为铁匠铺');

  s.hub.x = 620;
  eq(H.zoneAt(s).id, 'altar', '站在祭坛判定为祭坛');

  s.hub.x = 850;
  eq(H.zoneAt(s).id, 'gate', '站在门口判定为门');

  // 区域之间的空隙应当判定为"不在任何区域"
  s.hub.x = 275;      // field 右边界 245，anvil 左边界 320
  eq(H.zoneAt(s), null, '走在区域之间的空隙时没有可交互对象');
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
