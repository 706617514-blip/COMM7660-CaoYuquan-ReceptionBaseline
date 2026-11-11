/**
 * test_bag.js — 背包容量、分页与扩容规则的测试。
 *
 * 覆盖重点不是"函数不报错"，而是那些**如果坏了玩家会立刻感觉到**的规则：
 *   - 满包时不许静默吞装备（买装备扣钱、卸下丢件，都是玩家会记恨的 bug）
 *   - 兵器架上的等级显示必须来自背包条目，不能是写死的 Lv.1
 *   - 35 格一页、最多 6 页、逐页涨价，第 7 页必须被拒绝
 *   - 买了页数、调了音量的存档要能跨会话保留（关掉浏览器再回来不能回到 1 页）
 *
 * 用法: node tests/test_bag.js
 */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'game', 'config.js'));
const L = require(path.join(__dirname, '..', 'game', 'logic.js'));
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
function section(t) { console.log(`\n=== ${t} ===`); }

// 把一段断言包起来：段内任一行抛异常（例如调用了还没实现的 API）时，
// 记为一次失败并继续跑后面的段落，而不是让整个文件崩掉 ——
// 崩掉的套件会把剩余断言全部藏起来，"绿"就成了假象。
function group(label, fn) {
  try { fn(); }
  catch (e) { ok(false, label + '（段落抛异常）', e.message); }
}

// 填满当前已解锁的全部格子。用同一件基础装备重复填 ——
// 背包不堆叠，同一 id 的多件各占一格（重复件本来就该各自进包）。
function fillBag(state, id) {
  while (L.bagCount(state) < L.bagCapacity(state)) L.bagAdd(state, id || 'strawShoes', 1);
}

// ---------------------------------------------------------------- 前置修复①
section('前置修复① 兵器架等级取自背包条目（hub.js:190）');
group('前置修复① 兵器架等级取自背包条目（hub.js:190）', function(){
  // 实测：修复前任何背包装备在兵器架上都显示 Lv.1，
  // 因为 hub.js 读的是已被删除的 meta.inventoryLevels。
  const s = L.createState(101);
  s.meta.bagPages = 1;
  s.meta.bag.length = 0;
  L.bagAdd(s, 'leatherHelm', 3);   // leatherHelm 满级就是 3
  const row = H.zoneActions(s, 'forgewear').filter(function (a) {
    return a.payload && a.payload.id === 'leatherHelm';
  })[0];
  ok(!!row, '兵器架列出了背包里的皮盔');
  ok(row.sub.indexOf('Lv.3') >= 0, '背包里的皮盔在兵器架上显示 Lv.3，不是 Lv.1', row.sub);
  ok(row.sub.indexOf('Lv.1') < 0, '不再出现错误的 Lv.1', row.sub);
});

// ---------------------------------------------------------------- 前置修复②
section('前置修复② 满包时不许静默吞装备');
group('前置修复② 满包时不许静默吞装备', function(){
  // buyEquipment：满包时必须先判容量再收钱。修复前扣 190 铜币、
  // 返回 {ok:true}、却什么都没给 —— 可无限重复的铜币黑洞。
  const full = L.createState(41);
  full.meta.bagPages = 1;
  fillBag(full);
  eq(L.bagCount(full), 35, '填满页 1 的 35 格');
  full.meta.coins = 99999;
  const coinsBefore = full.meta.coins;
  const buyFull = L.buyEquipment(full, 'ironHelm');
  ok(buyFull.ok === false, '满包时买装备被拒绝，不是假成功', JSON.stringify(buyFull));
  eq(full.meta.coins, coinsBefore, '满包买失败不扣钱（不能是铜币黑洞）');
  ok(L.equipOwned(full, 'ironHelm') === null, '没付钱也没拿到装备');

  // unequipSlot：满包时必须保留身上的装备。修复前返回 {ok:true}、
  // 清空部位、装备凭空消失 —— 谎报成功 + 丢装备。
  const wearer = L.createState(42);
  wearer.meta.bagPages = 1;
  wearer.meta.bag.length = 0;
  wearer.meta.equipment.head = { id: 'ironHelm', level: 1 };
  fillBag(wearer);
  const un = L.unequipSlot(wearer, 'head');
  ok(un.ok === false, '满包时卸下被拒绝，不是谎报 success', JSON.stringify(un));
  ok(wearer.meta.equipment.head && wearer.meta.equipment.head.id === 'ironHelm',
    '卸下失败时装备还穿在身上（不能凭空消失）');

  // rollEquipDrop：掉落不该阻塞战斗，允许覆盖最后一格，
  // 但必须告诉 UI 覆盖了哪一件，且被覆盖的确实是"最后一格"里那件。
  const dropper = L.createState(43);
  dropper.meta.bagPages = 1;
  dropper.meta.bag.length = 0;
  fillBag(dropper, 'strawShoes');
  const lastUid = dropper.meta.bag[L.bagCapacity(dropper) - 1].uid;
  const lastId = dropper.meta.bag[L.bagCapacity(dropper) - 1].id;
  const drop = L.rollEquipDrop(dropper);
  ok(drop && drop.bagFull === true, '满包掉落标记 bagFull', JSON.stringify(drop));
  ok(drop.overwrote && drop.overwrote.uid === lastUid,
    'overwrote 指向被覆盖的那一条（最后一格），不是随机删一件', JSON.stringify(drop.overwrote));
  eq(drop.overwrote.id, lastId, 'overwrote 带出被覆盖装备的 id');
  eq(L.bagCount(dropper), 35, '覆盖不改变件数（还是 35 格）');
  ok(dropper.meta.bag[L.bagCapacity(dropper) - 1].id === drop.id,
    '最后一格确实被换成了掉落的这件');
});

// ---------------------------------------------------------------- 分页
section('分页：35 格一页，第 36 件进页 2');
group('分页：35 格一页，第 36 件进页 2', function(){
  const s = L.createState(21);
  s.meta.coins = 100000;   // createState 起始为 0，扩容要花钱（实测）
  s.meta.bagPages = 1;
  s.meta.bag.length = 0;
  for (let i = 0; i < 35; i++) L.bagAdd(s, 'longCloak', 1);
  eq(L.bagCount(s), 35, '页 1 正好 35 格');
  eq(L.pageOf(s, 34), 0, '第 35 格在页 1（0 基）');
  eq(L.bagAdd(s, 'longCloak', 1), -1, '页 1 满时拒绝（未扩容）');

  const paid = L.buyBagPage(s);
  ok(paid.ok === true, '扩容成功', JSON.stringify(paid));
  eq(L.bagAdd(s, 'longCloak', 1), 35, '扩容后第 36 件落在页 2 首格');
  eq(L.pageOf(s, 35), 1, '下标 35 属于页 2');

  // V5 原文：「塞 36 件，第 1 页 35、第 2 页 1」—— 必须真的数一遍两页各多少件，
  // 只断言下标归属是证明不了这个划分的。
  eq(L.pageSlice(s, 0).filter(Boolean).length, 35, '页 1 里正好 35 件');
  eq(L.pageSlice(s, 1).filter(Boolean).length, 1, '页 2 里正好 1 件');
  ok(L.pageSlice(s, 1)[0] !== null && L.pageSlice(s, 1)[1] === null, '页 2 只有首格有东西');
  eq(L.pageSlice(s, 0).length, 35, '页 1 切片恒为 35 格');
  eq(L.pageSlice(s, 1).length, 35, '页 2 不足 35 格也补到 35（补 null）');
});

// ---------------------------------------------------------------- 扩容定价
section('扩容定价：逐页涨价，第 7 页拒绝');
group('扩容定价：逐页涨价，第 7 页拒绝', function(){
  const s2 = L.createState(22);
  // createState 的起始铜币是 0（实测），买满 6 页共 8700 ——
  // 先给够钱，否则测的是"铜币不够"而不是定价。
  s2.meta.coins = 100000;
  eq(L.buyBagPage(s2).cost, 200, '页 2 价格 200');
  eq(L.buyBagPage(s2).cost, 500, '页 3 价格 500');
  eq(L.buyBagPage(s2).cost, 1000, '页 4 价格 1000');
  eq(L.buyBagPage(s2).cost, 2000, '页 5 价格 2000');
  eq(L.buyBagPage(s2).cost, 5000, '页 6 价格 5000');
  const over = L.buyBagPage(s2);
  ok(over.ok === false, '第 7 页被拒绝', JSON.stringify(over));
  eq(s2.meta.bagPages, 6, '页数封顶 6');
  eq(L.bagCapacity(s2), 210, '总容量 210');

  // 钱不够时不扣钱、不加页。
  const poor = L.createState(24);
  poor.meta.coins = 199;             // 差 1 枚买不起页 2
  const denied = L.buyBagPage(poor);
  eq(denied.ok, false, '铜币不够时买页被拒绝');
  eq(poor.meta.bagPages, 1, '被拒绝时页数不变');
  eq(poor.meta.coins, 199, '被拒绝时不扣钱');
});

// ---------------------------------------------------------------- 配置
section('配置：C.BAG 是唯一数值来源');
group('配置：C.BAG 是唯一数值来源', function(){
  eq(C.BAG.cols, 5, '列数 5');
  eq(C.BAG.rows, 7, '行数 7');
  eq(C.BAG.cellsPerPage, 35, '每页 35 格');
  eq(C.BAG.maxPages, 6, '最多 6 页');
  eq(C.BAG.cols * C.BAG.rows, C.BAG.cellsPerPage, '列×行 = 每页格数');
  eq(JSON.stringify(C.BAG.pagePrices), JSON.stringify([0, 200, 500, 1000, 2000, 5000]),
    '页价表与设计一致');
});

// ---------------------------------------------------------------- 跨会话保留
section('跨会话保留：页数与音量必须活过序列化往返');
group('跨会话保留：页数与音量必须活过序列化往返', function(){
  // 原稿完全没有这条：买了页、调了音量，关掉页面再回来却回到
  // 1 页 / 默认音量，是玩家一定会遇到的丢数据 bug。
  const sRt = L.createState(23);
  sRt.meta.coins = 100000;
  L.buyBagPage(sRt);                                  // 页 2
  L.buyBagPage(sRt);                                  // 页 3
  L.bagAdd(sRt, 'longCloak', 2);
  sRt.meta.settings.volume = 0.7;
  const beforePages = sRt.meta.bagPages;
  const beforeBag = L.bagCount(sRt);
  const json = L.serialize(sRt);
  const back = L.deserialize(json);
  eq(back.meta.bagPages, beforePages, '页数跨序列化保留（买了 3 页回来还是 3 页）');
  eq(back.meta.bagPages, 3, '页数确实是 3，不是被默认值盖掉');
  eq(L.bagCount(back), beforeBag, '背包内容跨序列化保留');
  ok(L.bagAt(back, 0).id === 'longCloak' && L.bagAt(back, 0).level === 2,
    '连件与等级一起保留');
  eq(L.bagCapacity(back), 105, '读档后容量跟着页数走（3 页 = 105）');
  eq(back.meta.settings.volume, 0.7, '音量跨序列化保留（不是回到默认 0.3）');
});

// ---------------------------------------------------------------- 导出完整性
section('导出完整性：hub.js 依赖的函数必须在 API 里');
group('导出完整性：hub.js 依赖的函数必须在 API 里', function(){
  // hub.js 的前置修复①要用 bagIndexOfId。它早已定义在 logic.js:465，
  // 但一直没进 API 导出块，于是 hub.js 拿不到 —— 这是一整类
  // "函数存在却不可达"的缺陷。
  eq(typeof L.bagIndexOfId, 'function', 'bagIndexOfId 已导出');
  const s = L.createState(31);
  s.meta.bag.length = 0;
  L.bagAdd(s, 'strawShoes', 1);
  L.bagAdd(s, 'longCloak', 2);
  eq(L.bagIndexOfId(s, 'longCloak'), 1, 'bagIndexOfId 找到第二件的下标');
  eq(L.bagIndexOfId(s, 'ironHelm'), -1, '没拥有的返回 -1');
  eq(typeof L.buyBagPage, 'function', 'buyBagPage 已导出');
  eq(typeof L.pageOf, 'function', 'pageOf 已导出');
  eq(typeof L.pageSlice, 'function', 'pageSlice 已导出');
});

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
