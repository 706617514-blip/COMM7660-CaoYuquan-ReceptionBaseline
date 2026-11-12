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

// ---------------------------------------------------------------- 追加修复 1：通道
section('追加修复1：overwrote 必须真的走通 equipDrops 通道');
group('追加修复1：overwrote 必须真的走通 equipDrops 通道', function(){
  // 上一次只断言了 rollEquipDrop 的**返回值**，没断言**通道** ——
  // killEnemy 往 run.equipDrops 里推的时候把 overwrote 丢掉了，
  // 于是 UI 永远看不到被覆盖的是哪一件。返回值对、通道断，等于没修。
  const s = L.createState(51);
  s.meta.bagPages = 1;
  s.meta.bag.length = 0;
  fillBag(s, 'strawShoes');                 // 塞满 35 格
  const lastIdx = L.bagCapacity(s) - 1;
  const victimUid = s.meta.bag[lastIdx].uid;   // 末格那件（会被覆盖）
  const victimId = s.meta.bag[lastIdx].id;
  L.startRun(s, 'grass');
  const run = s.run;
  run.equipDrops = [];

  // 走真实的 killEnemy 路径（用 isBoss=false 的普通敌人触发掉落判定）。
  // 掉落是 5% 概率，所以循环击杀直到真的掉出一件为止 ——
  // 这比手搓一个 drop 对象更能证明"通道"通了。
  let entry = null;
  for (let i = 0; i < 2000 && !entry; i++) {
    const e = L.makeEnemy(s, 'crawler', run.diff);
    e.hp = 0;
    L.killEnemy(s, run, e);
    if (run.equipDrops.length) entry = run.equipDrops[run.equipDrops.length - 1];
  }
  ok(!!entry, '2000 次击杀内至少掉出一件（5% 掉落）');
  ok(entry.bagFull === true, '满包时这条掉落被标记 bagFull', JSON.stringify(entry));
  ok('overwrote' in entry, 'run.equipDrops 的那一条真的带 overwrote（通道通了）',
    JSON.stringify(entry));
  ok(entry.overwrote && entry.overwrote.uid === victimUid,
    'overwrote 指向被覆盖的末格那件（不是随手编一个）', JSON.stringify(entry.overwrote));
  eq(entry.overwrote ? entry.overwrote.id : null, victimId,
    'overwrote 带出被覆盖装备的 id，UI 才能指名道姓');
  eq(entry.id, s.meta.bag[lastIdx].id, '掉落的那件确实落进了末格');
});

// ---------------------------------------------------------------- 追加修复 2：输入校验
section('追加修复2：bagPages 非法输入必须收敛，coins 不得变 NaN');
group('追加修复2：bagPages 非法输入必须收敛，coins 不得变 NaN', function(){
  // 存档码是玩家可达的注入入口：deserialize 不校验，'abc' / 1.5 / 7 / 0
  // 都能原样进来，随后 pagePrices[bagPages] 取到 undefined，
  // 一扣钱 coins 就成 NaN —— 而 NaN 会顺着存档一路传下去。
  const bad = [1.5, 0, 7, -3, 'abc', null, undefined, NaN];
  bad.forEach(function (v) {
    const s = L.createState(60);
    s.meta.coins = 100000;
    s.meta.bagPages = v;
    const cap = L.bagCapacity(s);
    ok(cap >= 35 && cap <= 210 && cap % 35 === 0,
      'bagPages=' + JSON.stringify(v) + ' 时容量收敛到合法值', String(cap));
    const r = L.buyBagPage(s);
    ok(!Number.isNaN(s.meta.coins),
      'bagPages=' + JSON.stringify(v) + ' 时买页不会把 coins 变成 NaN', String(s.meta.coins));
    ok(s.meta.bagPages >= 1 && s.meta.bagPages <= 6 && Number.isInteger(s.meta.bagPages),
      'bagPages=' + JSON.stringify(v) + ' 时买页后仍是 1..6 的整数', String(s.meta.bagPages));
    ok(typeof r.ok === 'boolean', 'bagPages=' + JSON.stringify(v) + ' 时返回结构正常', JSON.stringify(r));
  });

  // 存档注入：deserialize 必须拦住这些值。
  [1.5, 0, 7, -3, 'abc', null].forEach(function (v) {
    const s = L.createState(61);
    const o = JSON.parse(L.serialize(s));
    o.meta.bagPages = v;
    const back = L.deserialize(JSON.stringify(o));
    ok(back.meta.bagPages >= 1 && back.meta.bagPages <= 6 && Number.isInteger(back.meta.bagPages),
      '存档里 bagPages=' + JSON.stringify(v) + ' 读出来收敛到 1..6 整数', String(back.meta.bagPages));
    ok(!Number.isNaN(L.bagCapacity(back)), '读档后容量不是 NaN');
  });

  // 合法的值必须原样保留（校验不能把正确数据也改了）。
  const good = L.createState(62);
  good.meta.coins = 100000;
  good.meta.bagPages = 3;
  eq(L.bagCapacity(good), 105, '合法页数 3 不被校验误伤');
  eq(L.deserialize(L.serialize(good)).meta.bagPages, 3, '合法的 3 页跨序列化仍是 3');
});

// ---------------------------------------------------------------- 追加修复 1b：UI 文案
section('追加修复1b：满包覆盖时 UI 必须说出被顶掉的是哪一件');
group('追加修复1b：满包覆盖时 UI 必须说出被顶掉的是哪一件', function(){
  // 通道通了还不够 —— 接了通道却仍然印"已进背包"，玩家照样不知道
  // 自己少了一件。这一段用真实的 app.js 代码路径驱动，不是重写一份文案。
  const fs = require('fs');
  const vm = require('vm');
  const ROOT = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'game', 'app.js'), 'utf-8');

  // 只抽出掉落提示那一段真实代码来跑：整份 app.js 依赖 Phaser 场景与 DOM，
  // 在这里全量求值成本高且脆。抽段落能证明"这段代码真的会把 overwrote 印出来"。
  const start = src.indexOf('if (run.equipDrops && run.equipDrops.length) {');
  ok(start >= 0, 'app.js 里找得到掉落提示段');
  const end = src.indexOf('run.equipDrops.length = 0;', start);
  ok(end > start, '找得到段落结尾');
  // 必须一路取到标记之后的闭合大括号，否则抽出来的片段语法不完整
  // （vm 会报 Unexpected end of input）。
  const close = src.indexOf('}', end + 'run.equipDrops.length = 0;'.length);
  ok(close > end, '找得到段落的闭合花括号');
  const snippet = src.slice(start, close + 1);

  const toasts = [];
  const ctx = {
    C: C,
    run: {
      equipDrops: [{
        id: 'rustySword', duplicate: false, bagFull: true,
        overwrote: { id: 'strawShoes', uid: 'u35', level: 1 },
      }],
    },
    global: { EmberfieldUI: { toast: function (m) { toasts.push(m); } } },
  };
  vm.createContext(ctx);
  vm.runInContext(snippet, ctx, { filename: 'app.js#equipDrops' });

  eq(toasts.length, 1, '满包覆盖只弹一条提示');
  const msg = toasts[0] || '';
  ok(msg.indexOf('背包已满') >= 0, '提示说明背包已满', msg);
  ok(msg.indexOf(C.equipDef('rustySword').name) >= 0,
    '提示说出掉落的那件（' + C.equipDef('rustySword').name + '）', msg);
  ok(msg.indexOf(C.equipDef('strawShoes').name) >= 0,
    '提示说出被顶掉的那件（' + C.equipDef('strawShoes').name + '）', msg);
  eq(ctx.run.equipDrops.length, 0, '提示取走后清空，不会每帧重复弹');

  // 非满包的普通掉落仍走原来的文案（别把正常路径改坏了）。
  const ctx2 = {
    C: C,
    run: { equipDrops: [{ id: 'rustySword', duplicate: false, bagFull: false, overwrote: null }] },
    global: { EmberfieldUI: { toast: function (m) { toasts.push(m); } } },
  };
  vm.createContext(ctx2);
  vm.runInContext(snippet, ctx2, { filename: 'app.js#equipDrops' });
  ok(toasts[1] && toasts[1].indexOf('已进背包') >= 0,
    '没满包时仍是「已进背包」文案', toasts[1]);
});

// ---------------------------------------------------------------- 卖出价（V8）
section('卖出价 sellValue / equipInvested（V8）');
group('卖出价 sellValue / equipInvested（V8）', function(){
  // 实测（直接读 config 的 equipDef.price 与 equipPrice 逐级求和，不经实现）：
  //   thornMail  price 700  prices 700,1015,1472,2134,3094 -> sell 350,857,1593,2660,4207
  //   longCloak  price 200  prices 200,290,421            -> sell 100,245,455
  // 公式 floor(0.5 × (底价 + 升级投入))，三条数都核对过上表。
  eq(L.sellValue('thornMail', 1), 350, 'thornMail Lv1 = 350');
  eq(L.sellValue('thornMail', 3), 1593, 'thornMail Lv3 = 1593');
  eq(L.sellValue('longCloak', 2), 245, 'longCloak Lv2 = 245');

  // 升级投入只从 Lv2 起算：1 级没有任何投入，投入必须是 0 而不是底价本身。
  eq(L.equipInvested('longCloak', 1), 0, 'Lv1 没有升级投入');
  eq(L.equipInvested('longCloak', 3), 711, 'longCloak Lv3 投入 = 290+421');
  // 卖出价严格递增，否则升级就是纯粹的亏钱。
  ok(L.sellValue('thornMail', 5) > L.sellValue('thornMail', 3), '满级卖价高于 3 级');
});

// ---------------------------------------------------------------- 单件出售（语义 1/2/3/4）
section('单件出售 sellItem 的四种语义');
group('单件出售 sellItem 的四种语义', function(){
  // 语义 1：uid 在背包 → 卖出、加钱、移除。
  const s1 = L.createState(41);
  s1.meta.bag.length = 0;
  s1.meta.coins = 100;
  L.bagAdd(s1, 'longCloak', 2);
  const uid1 = s1.meta.bag[0].uid;
  const val1 = L.sellValue('longCloak', 2);
  const r1 = L.sellItem(s1, uid1);
  eq(r1.ok, true, '背包里的 uid 能卖');
  eq(r1.value, val1, '回报的卖价与 sellValue 一致');
  eq(s1.meta.coins, 100 + val1, '铜币按卖价增加');
  eq(s1.meta.bag.length, 0, '条目已从背包移除');
  eq(L.bagIndexOfUid(s1, uid1), -1, '按 uid 再也找不到这件');

  // 语义 2：uid 不存在 → 失败且**不动铜币**。
  // 只断言 ok===false 不够：把扣款写成「先加再判断」也能让 ok 是 false，
  // 但玩家已经凭空多/少了钱。所以铜币必须逐字不变。
  const coinsBefore = s1.meta.coins;
  const r2 = L.sellItem(s1, 'u-not-exist');
  eq(r2.ok, false, '不存在的 uid 出售失败');
  ok(typeof r2.reason === 'string' && r2.reason.length > 0, '失败带原因', r2.reason);
  eq(s1.meta.coins, coinsBefore, '失败时铜币分文未动');

  // 语义 3：uid 指向已穿戴 → 防御性拒绝。
  // 正常路径不可达（穿戴即离包），但存档码可注入，所以这条是防御。
  const s3 = L.createState(42);
  s3.meta.bag.length = 0;
  s3.meta.coins = 99999;
  L.buyEquipment(s3, 'longCloak');
  L.equipItem(s3, 'longCloak', s3.meta.bag[0].uid);
  const wornUid = s3.meta.equipment.back.uid;
  const c3 = s3.meta.coins;
  const r3 = L.sellItem(s3, wornUid);
  eq(r3.ok, false, '已穿戴的 uid 拒绝出售（防御）');
  eq(s3.meta.equipment.back.id, 'longCloak', '身上那件还在');
  eq(s3.meta.coins, c3, '拒绝时铜币未变');

  // 语义 4：该 id 只剩背包里的最后一件 → **必须能卖**。
  // 「每 id 留一件」只属于 sellBatch；若错写进 sellItem，
  // 玩家最后一件就永远卖不掉，只能当传家宝。
  const s4 = L.createState(43);
  s4.meta.bag.length = 0;
  s4.meta.coins = 0;
  L.bagAdd(s4, 'windBoots', 1);
  eq(s4.meta.bag.length, 1, '背包里就这一件 windBoots');
  const r4 = L.sellItem(s4, s4.meta.bag[0].uid);
  eq(r4.ok, true, '仅剩一件也允许单件卖出');
  eq(s4.meta.bag.length, 0, '卖完背包里没有这个 id 了');
  eq(s4.meta.coins, L.sellValue('windBoots', 1), '铜币到账');
});

// ---------------------------------------------------------------- 已穿戴不可卖（V27 + V9）
section('批量出售不动身上那件（V27）');
group('批量出售不动身上那件（V27）', function(){
  // ⚠ 不能用 `sellItem(s, 已穿戴uid).ok === false` 来证明这条规则：
  //   穿戴时条目已从 meta.bag 移除（实测 bagIndexOfUid 返回 -1），
  //   sellItem 找不到 uid 自然失败 —— 那是恒真断言，什么都证明不了。
  //   真正的规则是：卖光同 id 的背包件之后，身上那件**必须还在**。
  const s = L.createState(31);
  s.meta.coins = 99999;
  L.buyEquipment(s, 'longCloak');
  L.equipItem(s, 'longCloak', s.meta.bag[0].uid);
  const wornUidBefore = JSON.stringify(s.meta.equipment.back);
  L.bagAdd(s, 'longCloak', 1);
  L.bagAdd(s, 'longCloak', 1);
  const n0 = s.meta.bag.length;
  eq(n0, 2, '背包里有两件同 id（前置条件）');

  const rSell = L.sellBatch(s, L.sellableUids(s));
  eq(rSell.ok, true, '批量出售成功');
  ok(JSON.stringify(s.meta.equipment.back) === wornUidBefore,
    '身上那件装备卖不掉，卖完还在（不能连穿着的都卖掉）');
  ok(s.meta.bag.length < n0,
    '背包件确实被卖掉了一些（否则上一条是空转）',
    'bag.length=' + s.meta.bag.length + ', n0=' + n0);
  // 身上那件的 uid 不在背包里，sellableUids 自然也点不到它。
  eq(L.bagIndexOfUid(s, s.meta.equipment.back.uid), -1,
    'sellableUids 不包含已穿戴条目（身上那件不在背包里）');
  const sellable = L.sellableUids(s);
  ok(sellable.every(function (uid) {
    return L.bagIndexOfUid(s, uid) >= 0 && uid !== s.meta.equipment.back.uid;
  }), 'sellableUids 全部是背包里、且不是身上那件的 uid', JSON.stringify(sellable));
});

// ---------------------------------------------------------------- 每 id 留一件（V26）
section('批量出售每 id 强制留一件（V26）');
group('批量出售每 id 强制留一件（V26）', function(){
  const s2 = L.createState(32);
  s2.meta.bag.length = 0;
  L.bagAdd(s2, 'longCloak', 1);
  L.bagAdd(s2, 'longCloak', 3);
  s2.meta.coins = 0;
  const r = L.sellBatch(s2, L.sellableUids(s2));
  eq(r.count, 1, '两件同 id 只卖掉一件');
  eq(s2.meta.bag.length, 1, '强制保留一件');
  eq(s2.meta.bag[0].level, 3, '保留的是等级最高的那件');
  eq(r.total, L.sellValue('longCloak', 1), '拿到的是 1 级那件的钱（不是 3 级那件）');
  eq(s2.meta.coins, L.sellValue('longCloak', 1), '铜币等于卖掉的 1 级价');
  // 全选一次之后再全选：已经没有重复件可卖，不能把最后一件也清走。
  const r2 = L.sellBatch(s2, L.sellableUids(s2));
  eq(r2.count, 0, '重复件卖完后全选不再卖任何东西');
  eq(s2.meta.bag.length, 1, '最后一件仍在背包里');
});

// ---------------------------------------------------------------- 总价逐件求和（V28）
section('批量出售总价逐件求和（V28）');
group('批量出售总价逐件求和（V28）', function(){
  // ⚠ 原 brief 的 fixture 是「longCloak 一件 + windBoots 一件」，期望两件都卖掉。
  //   这与 V26「每 id 强制留一件」直接矛盾：两个 id 各只有一件，
  //   按规则两件都该留，count 只能是 0（实测 sellableUids 返回 []）。
  //   修法不是放宽断言，而是让 fixture 满足规则：每个 id 各放两件，
  //   于是每 id 留一件、各卖一件，count=2 且总价仍是逐件求和。
  //   这样 V28 要证明的东西（总价是逐件求和，不是单价×件数）一点没弱化。
  const s3 = L.createState(33);
  s3.meta.bag.length = 0;
  L.bagAdd(s3, 'longCloak', 1);
  L.bagAdd(s3, 'longCloak', 1);
  L.bagAdd(s3, 'windBoots', 2);
  L.bagAdd(s3, 'windBoots', 2);
  s3.meta.coins = 0;
  const r3 = L.sellBatch(s3, L.sellableUids(s3));
  eq(r3.count, 2, '两个 id 各卖一件（每 id 留一件）');
  eq(r3.total, L.sellValue('longCloak', 1) + L.sellValue('windBoots', 2), '总价逐件求和');
  eq(s3.meta.coins, r3.total, '铜币等于总价');
  eq(s3.meta.bag.length, 2, '每个 id 各留一件');
  // 反证：不能是「一个价 × 件数」。longCloak Lv1=100、windBoots Lv2=245，
  // 若实现取了第一件的价乘以件数会得到 200，与 345 不等。
  ok(r3.total !== L.sellValue('longCloak', 1) * 2, '总价不是一个单价乘件数', r3.total);
});

// ---------------------------------------------------------------- sellBatch 排序
section('sellBatch 保留等级最高、并列保留下标最靠前');
group('sellBatch 保留等级最高、并列保留下标最靠前', function(){
  // 三件同 id，等级 1 / 3 / 2，背包顺序就是下标顺序。
  // 保留的必须是下标 1 那件（Lv3），卖掉的应是下标 0 与 2。
  const s = L.createState(34);
  s.meta.bag.length = 0;
  L.bagAdd(s, 'longCloak', 1);      // 下标 0
  L.bagAdd(s, 'longCloak', 3);      // 下标 1 ← 应保留
  L.bagAdd(s, 'longCloak', 2);      // 下标 2
  s.meta.coins = 0;
  const uids = s.meta.bag.map(function (e) { return e.uid; });
  eq(JSON.stringify(L.sellableUids(s)), JSON.stringify([uids[0], uids[2]]),
    '可卖的正好是 1 级与 2 级那两件（等级最高的不卖）');

  const r = L.sellBatch(s, L.sellableUids(s));
  eq(r.count, 2, '三件卖两件');
  eq(s.meta.bag.length, 1, '留下一件');
  eq(s.meta.bag[0].level, 3, '留下的是等级最高的');
  eq(s.meta.bag[0].uid, uids[1], '留下的正是下标 1 那件的 uid（不是别件冒充）');
  // 反证：总价必须是「卖掉的两件」之和（1 级 + 2 级），缺一件都凑不出。
  eq(r.total, L.sellValue('longCloak', 1) + L.sellValue('longCloak', 2),
    '总价 = 被卖掉那两件的价之和');

  // 等级相同时保留**下标靠前**那件：结果必须稳定可复现，
  // 否则同一份存档两次全选会卖不同的件，玩家以为见了鬼。
  const t = L.createState(35);
  t.meta.bag.length = 0;
  L.bagAdd(t, 'longCloak', 2);      // 下标 0 ← 保留
  L.bagAdd(t, 'longCloak', 2);      // 下标 1
  L.bagAdd(t, 'longCloak', 2);      // 下标 2
  const tu = t.meta.bag.map(function (e) { return e.uid; });
  eq(JSON.stringify(L.sellableUids(t)), JSON.stringify([tu[1], tu[2]]),
    '等级并列时保留下标最靠前那件');
  L.sellBatch(t, L.sellableUids(t));
  eq(t.meta.bag[0].uid, tu[0], '并列时留下的是下标 0 那件');
});

// ---------------------------------------------------------------- duplicateUids 与 sellableUids 等价
section('duplicateUids 与 sellableUids 等价');
group('duplicateUids 与 sellableUids 等价', function(){
  const s = L.createState(36);
  s.meta.bag.length = 0;
  L.bagAdd(s, 'longCloak', 1);
  L.bagAdd(s, 'longCloak', 3);
  L.bagAdd(s, 'windBoots', 1);
  L.bagAdd(s, 'thornMail', 2);
  L.bagAdd(s, 'thornMail', 2);
  // 两者必须逐字相同：实现上让一个调用另一个，
  // 两套分组逻辑迟早分叉（一处按等级、一处按下标，就再也对不上了）。
  eq(JSON.stringify(L.sellableUids(s)), JSON.stringify(L.duplicateUids(s)),
    'sellableUids 与 duplicateUids 完全一致');
  eq(L.sellableUids(s).length, 2, '只有两个重复件可卖（longCloak 低等级 + thornMail 后一件）');
  // 单件的 windBoots 不出现在结果里。
  eq(L.sellableUids(s).indexOf(s.meta.bag[2].uid), -1, '只有一件的 id 不进可卖列表');
});

// ---------------------------------------------------------------- 整理（排序）与页签过滤
section('整理排序与页签过滤（V10、V11）');
group('整理排序与页签过滤（V10、V11）', function(){
  const s = L.createState(41);
  L.bagAdd(s, 'longCloak', 1);      // base, back
  L.bagAdd(s, 'thornMail', 1);      // special
  L.bagAdd(s, 'longCloak', 3);
  L.sortBag(s);
  ok(s.meta.bag[0].id === 'thornMail', '特殊件排在基础件前');
  ok(s.meta.bag[1].level === 3, '同 id 内等级高的在前');

  // 「不同种类不独占一行」= 相同 id 必须挨在一起。
  // ⚠ 不要写成 `ids.indexOf(X) + 1 === ids.lastIndexOf(X)` —— 实测该表达式
  //   等价于「恰好出现两次且相邻」，对数量敏感：只出现一次时为 false
  //   （会把正确实现判失败），三件同 id 时也为 false。要断言的是"分组连续"，
  //   与出现几次无关，所以写成「对每个 id，其首次与末次出现之间不含别的 id」：
  const ids = s.meta.bag.map((e) => e.id);
  const grouped = ids.every((id) => {
    const seg = ids.slice(ids.indexOf(id), ids.lastIndexOf(id) + 1);
    return seg.every((x) => x === id);
  });
  ok(grouped === true, '同 id 的元素连续挨在一起，不被别的装备隔开（不独占行）');
  ok(ids.indexOf('longCloak') >= 0 && ids.filter((x) => x === 'longCloak').length >= 2,
     '前提成立：确实有两件 longCloak，否则上一条是空转');

  // V11：页签过滤
  ok(L.bagFilter(s.meta.bag, 'special').length === 1, '特殊页签只出特殊件');
  ok(L.bagFilter(s.meta.bag, 'all').length === 3, '全部页签出所有件');
  ok(L.bagFilter(s.meta.bag, 'weapon').length === 0, '空分类返回空数组而不是报错');
});

// ---------------------------------------------------------------- 整理与稀有度（Task 20）
section('整理排序纳入稀有度 tier（Task 20）');
group('整理排序纳入稀有度 tier（Task 20）', function(){
  /*
   * PM 原话「整理按钮（按稀有度从低到高排）」，但改前 bagSortKey 只有
   * kindRank → slotRank → level 降序 → id，**没有 tier**。后果：同为 base、
   * 同为武器位、同为 Lv1 时，rustySword(tier 0) 与 crystalStaff(tier 4) 只按
   * id 字典序排 —— 玩家点「整理」看到的不是「先低级后高级」。
   *
   * 期望顺序是**先说清再断言**（上一批有过"按实现设计写断言"的教训）。
   * 比较链：kindRank(special 先) → tier 升序 → slotRank(EQUIP_SLOTS 顺序) →
   * level 降序 → id 升序。
   * EQUIP_SLOTS = ['head','torso','back','weapon','feet']，所以
   * slotRank: head=0 torso=1 back=2 weapon=3 feet=4。
   */

  // (1) tier 生效：这是"当前状态下的反例" —— 改前排的是 ironHelm(1) 在
  //     leatherHelm(0) 前（因为同 slot、靠 id 字典序 ironHelm < leatherHelm），
  //     而按稀有度应当 tier0 的皮盔在前、tier1 的铁盔在后。
  const t = L.createState(42);
  t.meta.coins = 999999;
  L.bagAdd(t, 'crystalStaff', 1);   // base, weapon, tier 4
  L.bagAdd(t, 'rustySword', 1);     // base, weapon, tier 0
  L.bagAdd(t, 'ironHelm', 1);       // base, head,   tier 1
  L.sortBag(t);

  const seq = t.meta.bag.filter((e) => C.equipDef(e.id).kind !== 'special')
    .map((e) => C.equipDef(e.id).tier);
  ok(seq.every((v, i) => i === 0 || v >= seq[i - 1]),
     '基础件按稀有度从低到高（tier 单调不减）', JSON.stringify(seq));
  ok(t.meta.bag[0].id === 'rustySword',
     '最低稀有度的锈剑排在最前（改前 crystalStaff/ironHelm 靠 id 抢占前面）',
     t.meta.bag.map((e) => e.id).join(','));

  // (2) 同 tier 内仍按部位：皮盔(tier0,head) 与 锈剑(tier0,weapon)
  const t2 = L.createState(43);
  L.bagAdd(t2, 'rustySword', 1);    // tier0, weapon (slotRank 3)
  L.bagAdd(t2, 'leatherHelm', 1);   // tier0, head   (slotRank 0)
  L.sortBag(t2);
  eq(t2.meta.bag.map((e) => e.id).join(','), 'leatherHelm,rustySword',
     '同为 tier 0 时按 EQUIP_SLOTS 顺序：head 在 weapon 前');

  // (3) 同 tier 同部位仍按等级降序：两件锈剑 Lv1 / Lv3 → Lv3 在前
  const t3 = L.createState(44);
  L.bagAdd(t3, 'rustySword', 1);
  L.bagAdd(t3, 'rustySword', 3);
  L.sortBag(t3);
  eq(t3.meta.bag[0].level, 3, '同为 tier 0 同为武器位时，等级高的在前');
  eq(t3.meta.bag[1].level, 1, '等级低的在后');

  // (4) special 仍整体在 base 之前（kindRank 不能被 tier 顶掉）
  const t4 = L.createState(45);
  L.bagAdd(t4, 'crystalStaff', 1);  // base, tier 4
  L.bagAdd(t4, 'thornMail', 1);     // special, tier undefined
  L.bagAdd(t4, 'rustySword', 1);    // base, tier 0
  L.sortBag(t4);
  eq(t4.meta.bag[0].id, 'thornMail',
     '特殊件仍排在所有基础件之前（kindRank 优先于 tier）');
  eq(t4.meta.bag.map((e) => e.id).join(','), 'thornMail,rustySword,crystalStaff',
     '特殊件在前，其后基础件按 tier 升序（锈剑 tier0 在棱晶杖 tier4 前）');

  // (5) 稳定性：两个完全相同的条目（同 id 同 level）相对顺序不变。
  //     用 uid 认"哪一件是原来那一件" —— 排序前后 uid 序列应当一致。
  const t5 = L.createState(46);
  L.bagAdd(t5, 'ironHelm', 2);
  L.bagAdd(t5, 'ironHelm', 2);
  const uidsBefore = t5.meta.bag.map((e) => e.uid).join(',');
  L.sortBag(t5);
  eq(t5.meta.bag.map((e) => e.uid).join(','), uidsBefore,
     '两个完全相同的条目排序前后相对顺序不变（稳定）');
  eq(t5.meta.bag.length, 2, '稳定性断言的前提成立：确实有两件');

  // (6) 回归：tier 插进来之后，同 id 仍必须连续挨着（不独占行）
  const t6 = L.createState(47);
  L.bagAdd(t6, 'rustySword', 1);
  L.bagAdd(t6, 'crystalStaff', 1);
  L.bagAdd(t6, 'rustySword', 3);
  L.bagAdd(t6, 'ironHelm', 1);
  L.sortBag(t6);
  const ids6 = t6.meta.bag.map((e) => e.id);
  const grouped6 = ids6.every((id) => {
    const seg = ids6.slice(ids6.indexOf(id), ids6.lastIndexOf(id) + 1);
    return seg.every((x) => x === id);
  });
  ok(grouped6 === true, '加了 tier 之后同 id 仍连续挨着（不独占行）', ids6.join(','));
  ok(ids6.filter((x) => x === 'rustySword').length === 2,
     '前提成立：确实有两件锈剑，否则上一条是空转');
  // tier 层生效后，同一条背包的期望顺序是：
  //   rustySword Lv3(tier0) → rustySword Lv1(tier0) → ironHelm(tier1) → crystalStaff(tier4)
  eq(ids6.join(','), 'rustySword,rustySword,ironHelm,crystalStaff',
     '整条期望顺序：tier 升序，同 tier 内等级降序');
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
