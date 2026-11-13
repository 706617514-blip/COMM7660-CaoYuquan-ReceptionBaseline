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
  // Task 24 被迫改值：商店多了「开垦一块田地」一行，4 → 5。
  // 这不是新增断言，是把既有断言的期望值跟着行数走。
  eq(acts.length, C.POTION_ORDER.length + 2, '商店列出三种药水 + 一行扩容 + 一行田地（Task 24）');
  eq(acts.map((a) => a.payload && a.payload.id).filter(Boolean).join(','),
     C.POTION_ORDER.join(','), '顺序与配置一致');
  ok(acts.every((a) => !a.enabled), '没钱时都不可购买');
  ok(acts.every((a) => typeof a.cost === 'number' && a.cost > 0), '每种药水都标价');

  // 有钱时能买，且真的扣钱加携带
  const rich = L.createState(79);
  rich.meta.coins = 300;
  const acts2 = H.zoneActions(rich, 'shop');
  // 300 铜币够买三瓶药水，但不够开垦田地（3000）—— 这一条问的是药水，
  // 所以只看药水行。Task 24 加行后"全部可买"不再成立（被迫改值）。
  const potionActs2 = acts2.filter((a) => a.kind === 'potion');
  eq(potionActs2.length, C.POTION_ORDER.length, '三瓶药水都列出来了');
  ok(potionActs2.every((a) => a.enabled), '三瓶药水钱够时都能买');
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

section('6c. 药水铺卖「背包页数+1」（Task 20）');
{
  /*
   * 为什么这一行必须出现在药水铺
   * --------------------------
   * PM 原话是「在药水铺卖一个『背包页数+1』的道具」，设计 §4.7 第三行也写着
   * 「扩容商品 背包页数+1 出现在药水铺」。实测改前药水铺只有三瓶药水，
   * L.buyBagPage / C.BAG.pagePrices / 背包面板的 +扩容 按钮全都写好了，
   * 但玩家从药水铺这条路径根本够不到 —— 等于白送。这一节钉的是"补上了"。
   *
   * 价格表 C.BAG.pagePrices = [0, 200, 500, 1000, 2000, 5000]：
   * 买第 2 页落在下标 1（=200），买第 3 页落在下标 2（=500），以此类推。
   */
  const shopActs = (s) => H.zoneActions(s, 'shop');

  // (1) 新档药水铺 = 3 瓶药水 + 1 扩容，且扩容排在最后
  const fresh = L.createState(901);
  fresh.meta.coins = 9999;
  const a1 = shopActs(fresh);
  // Task 24 被迫改值：商店多了「开垦一块田地」，4 → 5；扩容行不再是最后一行，
  // 改成按 kind 查找。断言本身（扩容行在、价对、文案对）一条没减。
  eq(a1.length, C.POTION_ORDER.length + 2, '商店行数 = 三瓶药水 + 一行扩容 + 一行田地');
  eq(a1.length, 5, '商店一共五行（3 + 1 + 1）');
  const last1 = a1.filter((a) => a.kind === 'bag-page')[0];
  eq(last1 && last1.kind, 'bag-page', '扩容商品在（不是夹在药水中间）');
  eq(last1 && last1.id, 'bag-page', '扩容行的 id 是稳定字符串 bag-page');

  // (2) 文案一字不差
  eq(last1 && last1.label, '背包页数+1', '标签就是需求原文里的那五个字');

  // (3) 新档 1 页：收 pagePrices[1] = 200，钱够就能点
  eq(fresh.meta.bagPages, 1, '新档从 1 页开始（下面 200 这个价才对）');
  eq(last1 && last1.cost, 200, '新档扩容价 = pagePrices[1] = 200');
  eq(last1 && last1.enabled, true, '铜币 9999 时扩容行可点');
  eq(last1 && last1.verb, '购买', '动词是「购买」（和兵器架一致，按钮渲染成 购买 · 200）');
  eq(last1 && last1.icon, undefined, '药水铺这轮不给图标（icon 缺省）');
  ok(typeof last1.sub === 'string' && last1.sub.indexOf('当前 1/6 页') >= 0,
     '说明行写出当前页数「当前 1/6 页」', last1 && last1.sub);
  ok(typeof last1.sub === 'string' && last1.sub.indexOf('70 格') >= 0,
     '说明行写出解锁后的格数收益（第 2 页解锁后共 70 格）', last1 && last1.sub);

  // (4) 买一次：页数 +1、正好扣 200、刷新后价格跳到 500
  const r1 = H.perform(fresh, last1);
  ok(r1 && r1.ok === true, '通过 perform 买下一页成功', JSON.stringify(r1));
  eq(fresh.meta.bagPages, 2, '买完变成 2 页');
  eq(fresh.meta.coins, 9999 - 200, '铜币正好少 200（不多不少）');
  const a2 = shopActs(fresh);
  const last2 = a2.filter((a) => a.kind === 'bag-page')[0];
  eq(last2 && last2.kind, 'bag-page', '刷新后扩容行仍在');
  eq(last2 && last2.cost, 500, '价格跟着页数走：2 页时 = pagePrices[2] = 500');
  ok(typeof last2.sub === 'string' && last2.sub.indexOf('当前 2/6 页') >= 0,
     '说明行的当前页数跟着变', last2 && last2.sub);
  ok(typeof last2.sub === 'string' && last2.sub.indexOf('105 格') >= 0,
     '第 3 页解锁后共 105 格', last2 && last2.sub);

  // (5) 铜币 199 < 200：灰掉并写明原因，而且点了不能有任何副作用
  const poorS = L.createState(902);
  poorS.meta.coins = 199;
  const a3 = shopActs(poorS);
  const poorRow = a3.filter((a) => a.kind === 'bag-page')[0];
  eq(poorRow && poorRow.kind, 'bag-page', '没钱时扩容行仍然列出来（不能悄悄消失）');
  eq(poorRow && poorRow.enabled, false, '铜币 199 买不起 200 的页，按钮灰掉');
  eq(poorRow && poorRow.disabledReason, '铜币不够', '灰掉的原因写明「铜币不够」');
  const rPoor = H.perform(poorS, poorRow);
  eq(rPoor && rPoor.ok, false, '点灰按钮返回 ok:false（而不是硬扣）');
  eq(poorS.meta.coins, 199, '被拒绝后铜币一分没少');
  eq(poorS.meta.bagPages, 1, '被拒绝后页数没变');

  // (6) 连买到 6 页：行还在、灰掉、原因换成"已解锁全部 6 页"、价格给 null
  const maxS = L.createState(903);
  maxS.meta.coins = 999999;
  for (let i = 0; i < C.BAG.maxPages - 1; i++) {
    const row = shopActs(maxS).filter((a) => a.kind === 'bag-page')[0];
    const rr = H.perform(maxS, row);
    ok(rr && rr.ok === true, `连买第 ${i + 2} 页成功`, JSON.stringify(rr));
  }
  eq(maxS.meta.bagPages, C.BAG.maxPages, '已经到 6 页（maxPages 顶）');
  const a4 = shopActs(maxS);
  // Task 24 被迫改值：4 → 5（商店加了一行田地），扩容行改按 kind 查找。
  eq(a4.length, 5, '满页时商店仍是五行（扩容行只占一行，没消失也没裂开）');
  const fullRow = a4.filter((a) => a.kind === 'bag-page')[0];
  eq(fullRow && fullRow.kind, 'bag-page', '满页时扩容行还在');
  eq(fullRow && fullRow.enabled, false, '满页后按钮灰掉');
  eq(fullRow && fullRow.disabledReason, '已解锁全部 6 页', '灰掉原因与 buyBagPage 的 reason 一致');
  eq(fullRow && fullRow.cost, null, '满页时 cost 给 null（没有下一页可卖）');
  ok(typeof fullRow.sub === 'string' && fullRow.sub.indexOf('已解锁全部 6 页') === 0,
     '满页的说明行给终态文案', fullRow && fullRow.sub);
  ok(typeof fullRow.sub === 'string' && fullRow.sub.indexOf('210 格') >= 0,
     '满页说明行写出总格数 210', fullRow && fullRow.sub);
  const coinsBeforeFull = maxS.meta.coins;
  const rFull = H.perform(maxS, fullRow);
  eq(rFull && rFull.ok, false, '满页再点返回 ok:false');
  eq(maxS.meta.coins, coinsBeforeFull, '满页再点铜币不变（没有静默扣钱）');
  eq(maxS.meta.bagPages, C.BAG.maxPages, '满页再点页数也不变');

  // (7) perform 的返回值与 L.buyBagPage 同形状 —— hub 不能在中间吞字段
  /*
   * 这条是"hub 没自己另算规则"的证据：同一个起始状态，两条路径各走一遍，
   * 返回对象的键集合必须一模一样。少了 cost/pages 就说明 hub 里长出了
   * 第二份扩容实现（那样 buyBagPage 的三种拒绝也会被绕过）。
   */
  const viaHubState = L.createState(904);
  viaHubState.meta.coins = 9999;
  const viaLogicState = L.createState(904);
  viaLogicState.meta.coins = 9999;
  const hubRow = shopActs(viaHubState).filter((a) => a.kind === 'bag-page')[0];
  const rHub = H.perform(viaHubState, hubRow);
  const rLogic = L.buyBagPage(viaLogicState);
  eq(Object.keys(rHub).sort().join(','), Object.keys(rLogic).sort().join(','),
     'perform 与 L.buyBagPage 的返回键集合完全一致', Object.keys(rHub).join(','));
  eq(rHub.ok, rLogic.ok, '两条路径的 ok 相同');
  eq(rHub.cost, rLogic.cost, '两条路径的 cost 相同（hub 没另算价格）');
  eq(rHub.pages, rLogic.pages, '两条路径的 pages 相同');
  eq(viaHubState.meta.coins, viaLogicState.meta.coins, '两条路径扣的钱一致');
  ok(Object.prototype.hasOwnProperty.call(rHub, 'cost')
     && Object.prototype.hasOwnProperty.call(rHub, 'pages'),
     'ok/cost/pages 三个键都在（hub 没吞字段）', JSON.stringify(rHub));

  // (8) 页签过滤口径：未知 filter 不能把这行吃掉
  /*
   * 药水铺这轮不加页签条（PANEL_TABS 里没有 shop），但将来加的时候
   * filter 会传进来。口径与兵器架一致：未知页签退化为不过滤 ——
   * 宁可多显示一行，也别让这一行莫名消失。
   */
  const filterProbe = H.zoneActions(fresh, 'shop', 'no-such-tab');
  // Task 24 被迫改值：4 → 5（多了一行田地）。filter 口径本身没变。
  eq(filterProbe.length, 5, '未知 filter 退化为不过滤（扩容行还在）');
  const filteredAll = H.zoneActions(fresh, 'shop', 'all');
  eq(filteredAll.length, 5, 'filter=all 时五行齐全');
  eq(H.zoneActions(fresh, 'shop', undefined).length, 5, 'filter 缺省时五行齐全');
}

section('6d. 商店开垦田地（Task 24：药水铺扩容成商店）');
{
  /*
   * 名字与身份
   * ----------
   * 商店现在卖的不只是药水，还有田地（永久资产）。名字不改，玩家会以为
   * "田地"是个临时道具；但区域 id 必须还是 'shop' —— 存档和动线判断都靠它。
   */
  const shop = H.ZONES.find((z) => z.id === 'shop');
  ok(!!shop, '商店区域仍在（只改名，不换 id）');
  eq(shop && shop.name, '商店', '药水铺改名为商店');
  eq(shop && shop.id, 'shop', '区域 id 仍是 shop（存档可读性靠它）');
  ok(!!shop && shop.hint.indexOf('田地') >= 0, 'hint 里提到田地', shop && shop.hint);

  const rowOf = (s) => H.zoneActions(s, 'shop').find((a) => a.kind === 'farm-plot');

  // (1) 有一行「开垦田地」，价格/动词/说明都对
  const fresh = L.createState(1101);
  fresh.meta.coins = 9999;
  const row = rowOf(fresh);
  ok(!!row, '商店里有一行开垦田地');
  if (row) {
    eq(row.id, 'farm-plot', 'id 稳定（hub.perform 靠它派发）');
    eq(row.label, '开垦一块田地', '标签明说买的是田地');
    eq(row.cost, C.FARM.plotPrice, '价格来自 C.FARM.plotPrice，不是内联 3000');
    eq(row.verb, '购买', '动词与其它商品一致（面板按钮靠它）');
    ok(row.enabled, '钱够时能买', JSON.stringify(row));
    ok(typeof row.sub === 'string' && row.sub.indexOf('9/27') >= 0,
       '说明行写「当前 9/27 块」', row && row.sub);
    ok(row.sub.indexOf('+' + C.FARM.yieldPerPlot) >= 0,
       '说明行写每块产出（数字来自配置）', row && row.sub);
  }

  // (2) 说明行的数字是算出来的，不是写死的 9/27
  const grown = L.createState(1102);
  grown.meta.coins = 9999;
  while (grown.farm.plots.length < 26) grown.farm.plots.push({ state: 'empty', growth: 0 });
  const row26 = rowOf(grown);
  ok(!!row26 && row26.sub.indexOf('26/27') >= 0, '26 块时说明行是 26/27',
     row26 && row26.sub);
  ok(!!row26 && row26.sub.indexOf('9/27') < 0, '26 块时不再出现 9/27（不是硬编码）',
     row26 && row26.sub);

  // (3) 差钱：变灰 + 写明原因，且仍标价（玩家要知道差多少）
  const poor = L.createState(1103);
  poor.meta.coins = C.FARM.plotPrice - 1;
  const rowPoor = rowOf(poor);
  ok(!!rowPoor && !rowPoor.enabled, '差 1 铜币时不可买');
  eq(rowPoor && rowPoor.disabledReason, '铜币不够', '差钱时写明「铜币不够」');
  eq(rowPoor && rowPoor.cost, C.FARM.plotPrice, '买不起时仍标价');

  // (4) 满额：不能用"价格 null"混过去，要明说上限
  const fullS = L.createState(1104);
  fullS.meta.coins = 99999;
  while (fullS.farm.plots.length < C.FARM.maxPlots) {
    fullS.farm.plots.push({ state: 'empty', growth: 0 });
  }
  const rowFull = rowOf(fullS);
  ok(!!rowFull && !rowFull.enabled, '满 27 块时不可买');
  eq(rowFull && rowFull.disabledReason, '田地已经开垦到上限', '满额时写明上限原因');

  // (5) 通过 perform 真的能买到 —— 只测 zoneActions 测不到"派发没接上"
  const buyer = L.createState(1105);
  buyer.meta.coins = 5000;
  const beforePlots = buyer.farm.plots.length;
  const rBuy = H.perform(buyer, rowOf(buyer));
  eq(rBuy.ok, true, '通过 perform 开垦成功');
  eq(buyer.farm.plots.length, beforePlots + 1, '田地 +1');
  eq(buyer.meta.coins, 5000 - C.FARM.plotPrice, '扣掉 C.FARM.plotPrice');

  // (6) 满额时强行 perform 也要被拒（不能绕过 UI 判断）
  const rFull = H.perform(fullS, rowOf(fullS));
  eq(rFull.ok, false, '满额时 perform 被拒绝');
  eq(fullS.meta.coins, 99999, '满额时 perform 没扣钱');
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

section('7b. 第 2 页起的田块几何（Task 24 翻页）');
{
  /*
   * 翻页只换索引，不换位置：第 2 页的田块布局与第 1 页逐像素一致，
   * 只是 geo.idx 从 9 开始。这样 FarmScene 只需要换 plotGeo，
   * 绘制/命中/点击三处都不用写第二份逻辑。
   */
  ok(typeof H.farmLayout === 'function', 'farmLayout 存在');

  const p0 = H.farmLayout(960, 452, 0);
  const p1 = H.farmLayout(960, 452, C.FARM.perPage);
  eq(p0.map((g) => g.idx).join(','), '0,1,2,3,4,5,6,7,8', 'startIdx=0 时索引仍是 0..8');
  eq(p1.map((g) => g.idx).join(','), '9,10,11,12,13,14,15,16,17',
     'V18 第 2 页索引从 9 开始');
  ok(p1.every((g, i) => g.cx === p0[i].cx && g.cy === p0[i].cy &&
                        g.w === p0[i].w && g.h === p0[i].h),
     '翻页只换索引，位置与尺寸逐块一致');

  const def = H.farmLayout(960, 452);
  eq(def.map((g) => g.idx).join(','), '0,1,2,3,4,5,6,7,8',
     '不传 startIdx 时向后兼容（不会跑到第 2 页）');
  eq(def.length, 9, '缺省仍然 9 块（每页 9 块）');

  // 第 2 页的田块也能被命中，且命中结果是绝对索引
  const hit1 = H.farmHitPlot(p1, p1[0].cx, p1[0].cy);
  eq(hit1, 9, '第 2 页第 1 块的中心命中绝对索引 9');
  eq(H.farmHitPlot(p1, 5, 5), -1, '第 2 页点田外仍是 -1');
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

section('兵器架页签：全部 / 头部 / 躯干 / 背部 / 武器 / 脚部 / 特殊');
{
  /*
   * 这一节钉的是**部位维度**的页签（Task 21）。
   *
   * 改前是状态维度（全部/未拥有/已拥有/已穿戴/特殊，Task 10 按设计 §5.1 定的）。
   * PM 2026-11-12 核对遗漏时明确选了「换成部位分类，和背包一致」——
   * 对背包的「分类」指的就是部位（C.EQUIP_SLOTS）。
   *
   * 维度换了，但这一节原来那些来之不易的口径**必须留着**：
   *   - 穿戴中的件给两条动作（升级 + 卸掉），所以"行数 ≠ 件数"；
   *   - 页签只决定"这一屏显示哪一类"，不改变任何一行的三态；
   *   - 未知页签退化为不过滤（宁可多显示，也别给一片空白）。
   * 只是把过滤键从 unowned/owned/worn 换成 head/torso/back/weapon/feet。
   */
  const s = L.createState(4326);
  H.ensureHub(s);
  s.meta.coins = 5000;
  const ids = Object.keys(C.ALL_EQUIPMENT);
  const total = ids.length;
  const specials = ids.filter(function (id) {
    return C.equipDef(id).kind === 'special';
  }).length;

  // ---- ① 七个页签的文案与顺序（逻辑层的过滤键）----
  // 逻辑层只认 id（filter 参数），文案在 index.html 的 PANEL_TABS 里 ——
  // 那边由 test_game_page.js 的 4c 节钉。这里钉的是"这七个 id 各自过滤出什么"。
  const TABS = ['all', 'head', 'torso', 'back', 'weapon', 'feet', 'special'];
  const TAB_LABELS = ['全部', '头部', '躯干', '背部', '武器', '脚部', '特殊'];
  eq(TABS.length, 7, '七个页签（全部 + 五个部位 + 特殊）');
  eq(TAB_LABELS.length, 7, '七个文案');
  // 部位页签的 id 必须与 C.EQUIP_SLOTS 逐字一致 —— 否则 def.slot === filter 永远不成立。
  eq(C.EQUIP_SLOTS.join('/'), 'head/torso/back/weapon/feet',
     '部位页签的 id 就是 C.EQUIP_SLOTS 本身（顺序也一致）');
  eq(TABS.slice(1, 6).join('/'), C.EQUIP_SLOTS.join('/'),
     '中间五个页签 id 依次等于 C.EQUIP_SLOTS');

  // 每个页签都能被 zoneActions 接受，且都是数组（不是 undefined / null）
  TABS.forEach(function (t, i) {
    const rows = H.zoneActions(s, 'forgewear', t);
    ok(Array.isArray(rows), '页签「' + TAB_LABELS[i] + '」返回数组（filter=' + t + '）');
  });

  // ---- ② 部位页签的件数 = 逐部位统计的行数（穿戴件算 2 行）----
  // 口径：一条"动作"= 一行。穿戴中的件给"升级 + 卸掉"两条，所以算 2 行。
  const expectRows = function (slot) {
    return ids.reduce(function (n, id) {
      const def = C.equipDef(id);
      if (def.slot !== slot) return n;
      return n + (L.equipOwned(s, id) === 'equipped' ? 2 : 1);
    }, 0);
  };
  const expectCount = function (slot) {
    return ids.filter(function (id) { return C.equipDef(id).slot === slot; }).length;
  };
  // 实测分布 head 6 / torso 7 / back 6 / weapon 10 / feet 6，合计 35。
  // 断言仍按 C.equipDef 现算，免得以后改数值时集体假红。
  eq(expectCount('head'), 6, '头部件 6 件（实测）');
  eq(expectCount('torso'), 7, '躯干件 7 件（实测）');
  eq(expectCount('back'), 6, '背部件 6 件（实测）');
  eq(expectCount('weapon'), 10, '武器件 10 件（实测）');
  eq(expectCount('feet'), 6, '脚部件 6 件（实测）');
  eq(expectCount('head') + expectCount('torso') + expectCount('back') +
     expectCount('weapon') + expectCount('feet'), total,
     '五个部位件数之和 = 全部 ' + total + ' 件（不重不漏）');

  // 新档没有穿戴件，行数 = 件数
  C.EQUIP_SLOTS.forEach(function (slot) {
    const rows = H.zoneActions(s, 'forgewear', slot);
    eq(rows.length, expectRows(slot),
       '页签「' + (C.EQUIP_SLOT_NAMES[slot] || slot) + '」行数 = 逐件现算（' +
       expectCount(slot) + ' 件，新档无穿戴）');
    ok(rows.every(function (a) {
      return C.equipDef(a.payload.id).slot === slot;
    }), '页签「' + (C.EQUIP_SLOT_NAMES[slot] || slot) + '」每一条都是该部位');
  });

  // ---- ③ 全部 / 特殊 ----
  eq(H.zoneActions(s, 'forgewear').length, total, '不带 filter 时列全部（老调用不受影响）');
  eq(H.zoneActions(s, 'forgewear', 'all').length, total, '页签「全部」也是全部');
  eq(H.zoneActions(s, 'forgewear', 'special').length, specials, '特殊页签只列特效装备');
  eq(specials, 14, '特效装备共 14 件（实测）');
  const specialRows = H.zoneActions(s, 'forgewear', 'special');
  ok(specialRows.every(function (a) {
    return C.equipDef(a.payload.id).kind === 'special';
  }), '特殊页签每一条都是 kind === special');
  ok(specialRows.every(function (a) {
    return C.equipDef(a.payload.id).kind !== 'base';
  }), '特殊页签不含任何 base 件');

  // ---- ④ 部位页签**不排除** special（本次最容易写错的地方）----
  /*
   * ALL_EQUIPMENT 的 35 件里有 14 件 kind === 'special'，而它们**同时都有 slot**
   * （stormRing 是 head、battleAxe 是 weapon……）。所以"特殊"是**稀有度**维度、
   * 五个部位是**部位**维度，两者各自独立过滤，只有「全部」是并集。
   * 在部位页签里再排除 special 会让 stormRing / thunderHelm 在头部页签里凭空消失。
   */
  const headIds = H.zoneActions(s, 'forgewear', 'head')
    .map(function (a) { return a.payload.id; });
  ['leatherHelm', 'ironHelm', 'guardHelm', 'hornHelm'].forEach(function (id) {
    ok(headIds.indexOf(id) >= 0, '头部页签含 base 件 ' + id);
  });
  ['thunderHelm', 'stormRing'].forEach(function (id) {
    ok(headIds.indexOf(id) >= 0,
       '头部页签含 special 件 ' + id + '（部位页签不排除 special）');
  });
  eq(headIds.length, 6, '头部页签正好 6 件（4 base + 2 special）');
  // 反向也要成立：special 件确实带着 slot，所以上面那条不是巧合
  eq(C.equipDef('stormRing').slot, 'head', 'stormRing 的 slot 是 head（所以它在头部页签里）');
  eq(C.equipDef('stormRing').kind, 'special', 'stormRing 的 kind 是 special');
  eq(C.equipDef('thunderHelm').slot, 'head', 'thunderHelm 的 slot 是 head');
  eq(C.equipDef('thunderHelm').kind, 'special', 'thunderHelm 的 kind 是 special');

  // ---- ⑤ 五个部位件数之和 = 全部页签去重后的件数 ----
  // 口径：这里用**件数**（按 id 去重）而不是行数 —— 行数求和会把穿戴件算两次。
  const partCountSum = C.EQUIP_SLOTS.reduce(function (n, slot) {
    return n + expectCount(slot);
  }, 0);
  eq(partCountSum, total, '五个部位件数之和 = 全部页签件数（' + total + '）');
  // 再按"去重后的 id 集合"验一遍：五个部位页签合起来正好覆盖全表
  const seen = {};
  C.EQUIP_SLOTS.forEach(function (slot) {
    H.zoneActions(s, 'forgewear', slot).forEach(function (a) {
      seen[a.payload.id] = true;
    });
  });
  eq(Object.keys(seen).length, total,
     '五个部位页签合起来正好覆盖全表（' + total + ' 个 id，不重不漏）');

  // ---- ⑥ 未知页签退化为不过滤 ----
  eq(H.zoneActions(s, 'forgewear', '不存在').length,
     H.zoneActions(s, 'forgewear').length, '未知页签退化为不过滤（不白屏）');
  eq(H.zoneActions(s, 'forgewear', 'bogus').length,
     H.zoneActions(s, 'forgewear').length, '未知页签 bogus 也是 ' + total + ' 行');
  // 注：背包侧的 L.bagFilter(bag, 'bogus') 对未知 tab 返回**空数组**，
  // 而 hub 侧是**不过滤** —— 两者语义相反但各自调用方都自洽（背包的 tab
  // 一定来自 PANEL_TABS，hub 的 filter 可能被配错）。game/logic.js 本轮不在
  // 允许改动清单里，这里只把不一致记下来，不顺手改。
  eq(L.bagFilter([], 'bogus').length, 0, '背包侧未知 tab 返回空数组（与 hub 相反，已知不一致）');

  // ---- ⑦ 三态不受页签影响 ----
  // 买一件（头部）→ 在 head 页签里应变成"穿戴"；
  // 穿上 → 同一件给"升级 + 卸掉"两行；未买的件仍必是"购买"。
  L.buyEquipment(s, 'hornHelm');
  L.buyEquipment(s, 'ironHelm');
  L.equipItem(s, 'ironHelm');
  const headAfter = H.zoneActions(s, 'forgewear', 'head');
  // 6 件里 ironHelm 穿了（2 行）、hornHelm 买了（1 行）、其余 4 件未买（各 1 行）
  eq(headAfter.length, expectRows('head'), '穿戴后头部页签行数 = 逐件现算（穿戴件算 2 行）');
  eq(headAfter.length, 7, '头部页签 6 件 → 7 行（铁盔穿了给两条动作）');
  const rowsOfId = function (list, id) {
    return list.filter(function (a) { return a.payload.id === id; });
  };
  eq(rowsOfId(headAfter, 'hornHelm').length, 1, '背包里的角盔只有 1 行');
  eq(rowsOfId(headAfter, 'hornHelm')[0].kind, 'equip-wear',
     '买了没穿的角盔在头部页签里是"穿戴"动作');
  eq(rowsOfId(headAfter, 'ironHelm').length, 2, '身上的铁盔有 2 行（升级 + 卸掉）');
  eq(rowsOfId(headAfter, 'ironHelm').map(function (a) { return a.kind; }).join('/'),
     'equip-upgrade/equip-unequip', '铁盔那两行依次是升级 + 卸掉');
  const unownedHeads = rowsOfId(headAfter, 'leatherHelm');
  eq(unownedHeads.length, 1, '没买过的皮盔在头部页签里仍是 1 行');
  eq(unownedHeads[0].kind, 'equip-buy', '没买过的件在部位页签里仍是"购买"（页签不改变三态）');
  ok(headAfter.filter(function (a) {
    return L.equipOwned(s, a.payload.id) === null;
  }).every(function (a) { return a.kind === 'equip-buy'; }),
     '头部页签里每一条未拥有的动作都是购买');

  // 穿戴的件**只**出现在它自己的部位页签里，不会串到别的部位
  const weaponRows = H.zoneActions(s, 'forgewear', 'weapon');
  eq(rowsOfId(weaponRows, 'ironHelm').length, 0, '头部的铁盔不会出现在武器页签里');
  eq(weaponRows.length, expectRows('weapon'), '武器页签行数不受头部穿戴影响');
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
