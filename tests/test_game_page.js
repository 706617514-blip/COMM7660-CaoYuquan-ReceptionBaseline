/**
 * test_game_page.js — 界面层集成测试（DOM 桩 + 最小 Phaser 桩）。
 *
 * Phaser 场景无法在 Node 里真跑（要 canvas/WebGL），所以这里不测"画得好不好看"，
 * 而是测**玩家一点就坏**的那一层：
 *   - 档案：新建、选择、重名拒绝、存档码导入
 *   - HUD：技能条构建、冷却显示、血条与波次更新
 *   - 面板：区域动作渲染、禁用原因、点按钮真的调用到 hub.perform
 *   - 结算：胜负文案与回基地回调
 *
 * 场景层（HubScene/RunScene）的正确性由 app.js 的接线纪律 + 逻辑层测试共同保证。
 *
 * 用法: node tests/test_game_page.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'game', 'index.html');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}` + (detail !== undefined ? `  -> ${detail}` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(t) { console.log(`\n=== ${t} ===`); }

// ---------------------------------------------------------------- DOM 桩
function makeEl(id) {
  const el = {
    id: id || '', textContent: '', _innerHTML: '', title: '', disabled: false,
    className: '', style: { cssText: '' }, children: [], _handlers: {},
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    appendChild(c) {
      this.children.push(c);
      // 真实 DOM 里 append 之后 getElementById 就能找到它；
      // 桩必须同步登记，否则脚本动态创建的元素查不到，测试会误判。
      if (c && c.id) elements.set(c.id, c);
      return c;
    },
    querySelector() { return makeEl(''); },
    click() { (this._handlers.click || []).forEach(fn => fn({ preventDefault() {}, stopPropagation() {} })); },
  };
  const cls = new Set();
  el.classList = {
    add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; this.children.length = 0; },
  });
  return el;
}

const elements = new Map();
const getEl = (id) => {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
};
const store = new Map();
let confirmAnswer = true;

const sandbox = {
  console, Math, Date, JSON, Set, Map, Array, Object, String, Number, Boolean,
  Error, isFinite, parseInt, parseFloat, setTimeout, clearTimeout, encodeURIComponent,
  decodeURIComponent, escape, unescape,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.document = {
  getElementById: getEl,
  createElement: () => makeEl(''),
  addEventListener() {},
  querySelector: () => makeEl(''),
};
sandbox.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
sandbox.confirm = () => confirmAnswer;

// 最小 Phaser 桩：只要让 app.js 能被求值（class extends Phaser.Scene 需要它存在）
sandbox.Phaser = {
  Scene: class Scene { constructor(cfg) { this.key = cfg && cfg.key; } },
  Game: class Game { constructor() { sandbox.__gameConstructed = true; } },
  AUTO: 0,
  Scale: { FIT: 0, CENTER_BOTH: 0 },
  Input: { Keyboard: { JustDown: () => false } },
  Display: {
    Color: {
      Interpolate: { ColorWithColor: (a, b) => ({ r: 30, g: 40, b: 50 }) },
      GetColor: () => 0x1e2832,
    },
  },
};

vm.createContext(sandbox);
const loadModule = (rel) => vm.runInContext(
  fs.readFileSync(path.join(ROOT, rel), 'utf-8'), sandbox, { filename: rel });

// ---------------------------------------------------------------- 启动
section('1. 脚本按序加载且不抛异常');
const html = fs.readFileSync(HTML, 'utf-8');
const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
eq(JSON.stringify(srcs), JSON.stringify([
  'vendor/phaser.min.js', 'config.js', 'audio.js', 'logic.js', 'profile.js', 'hub.js',
  'baghud.js', 'app.js',
]), '脚本加载顺序正确（Phaser 先于 app.js）');

let bootErr = null;
try {
  loadModule('game/config.js');
  // audio.js 只依赖 config.js，且必须早于 baghud.js / app.js ——
  // 那两者在模块求值时就抓了 global.GameAudio（拿不到会退回空实现）。
  loadModule('game/audio.js');
  loadModule('game/logic.js');
  loadModule('game/profile.js');
  loadModule('game/hub.js');
  loadModule('game/baghud.js');
  loadModule('game/app.js');
} catch (e) { bootErr = e; }
ok(!bootErr, '模块加载不抛异常', bootErr && bootErr.message);

ok(typeof sandbox.GameHub === 'object', 'GameHub 已挂在全局');
ok(typeof sandbox.EmberfieldApp === 'object', 'EmberfieldApp 已挂在全局');
ok(typeof sandbox.EmberfieldApp.FarmScene === 'function', '农场场景已定义并注册');
ok(['BootScene', 'HubScene', 'RunScene', 'FarmScene'].every(
  (k) => typeof sandbox.EmberfieldApp[k] === 'function'),
  '四个场景类都存在');
ok(sandbox.EmberfieldApp.toScreen(480, 0, 0).sy >
   sandbox.EmberfieldApp.toScreen(480, 200, 0).sy,
   '坐标映射：远处画得更高');

// 拦截 boot：Phaser 场景不在 Node 里真跑，只记录被调用
let bootedState = null;
sandbox.EmberfieldApp.boot = function (state) { bootedState = state; return { fake: true }; };

const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
let uiErr = null;
try { vm.runInContext(inline, sandbox, { filename: 'index.html:inline' }); }
catch (e) { uiErr = e; }
ok(!uiErr, '界面脚本执行不抛异常', uiErr && (uiErr.message + '\n' + uiErr.stack));
ok(typeof sandbox.EmberfieldUI === 'object', 'EmberfieldUI 暴露给场景');

// ---------------------------------------------------------------- 档案
section('2. 玩家档案');
ok(getEl('plist').children.length === 1, '没有档案时显示占位提示',
   getEl('plist').children.length);

getEl('newName').textContent = '';
getEl('newName').value = '阿青';
getEl('btnCreate').click();
ok(!!bootedState, '新建档案后调用了 boot（进入游戏）');
ok(bootedState && bootedState.meta && typeof bootedState.meta.coins === 'number',
   'boot 收到的是合法 state');
eq(getEl('whoName').textContent, '阿青', '顶栏显示当前玩家');
eq(getEl('profile').className, 'off', '档案界面隐藏');

const namesAfter = JSON.parse(store.get('emberfield.profiles') || '[]');
ok(namesAfter.indexOf('阿青') >= 0, '档案写入了档案索引', JSON.stringify(namesAfter));

// 重复新建应当被拒绝
getEl('newName').value = '阿青';
getEl('btnCreate').click();
ok(JSON.parse(store.get('emberfield.profiles')).length === 1, '重名不会产生第二个档案');

// ---------------------------------------------------------------- HUD
section('3. HUD 与技能条');
sandbox.EmberfieldUI.showHud(true, bootedState);
eq(getEl('hud').className, 'on', 'HUD 显示');
eq(getEl('skills').children.length, sandbox.GameConfig.SKILL_ORDER.length,
   '技能条槽位数量等于技能数量', getEl('skills').children.length);

// 造一个战斗中的状态
const L = sandbox.GameLogic, C = sandbox.GameConfig;
L.startRun(bootedState, 'wood');
const run = bootedState.run;
run.player.hp = 35;
run.loot.coins = 77;
run.loot.seeds = 4;
sandbox.EmberfieldUI.updateHud(bootedState);
eq(getEl('hpNum').textContent, '35 / ' + run.player.maxHp, 'HUD 生命数值正确');
eq(getEl('lootCoin').textContent, 77, 'HUD 铜币正确');
eq(getEl('lootSeed').textContent, 4, 'HUD 种子正确');
ok(/第 1 \/ 3 波/.test(getEl('waveChip').textContent), 'HUD 波次正确',
   getEl('waveChip').textContent);

// 冷却显示
run.player.cooldowns.whirl = 4.2;
sandbox.EmberfieldUI.updateHud(bootedState);
const whirlEl = getEl('skills').children.find(c => c.id === 'sk-whirl');
ok(whirlEl && whirlEl.className.indexOf('cooling') >= 0, '冷却中的技能显示遮罩',
   whirlEl && whirlEl.className);

// ---------------------------------------------------------------- 面板
section('4. 场景面板');
L.endRun(bootedState, true);           // 结束这一局，回到可经营状态
sandbox.EmberfieldUI.showHud(false);
bootedState.meta.coins = 300;
bootedState.meta.seeds = 5;

const gate = sandbox.GameHub.ZONES.find(z => z.id === 'gate');
let startedDifficulty = null;
const fakeScene = { startRun: (d) => { startedDifficulty = d; } };
sandbox.EmberfieldUI.openPanel(gate, bootedState, () => {}, (a) => {
  if (a.kind === 'run') { startedDifficulty = a.payload.difficultyId; return; }
});
eq(getEl('panelTitle').textContent, '远征之门', '面板标题为区域名');
ok(getEl('panelBody').children.length >= C.DIFFICULTIES.length, '门口列出全部难度',
   getEl('panelBody').children.length);

// 点第一个难度的「出发」
const actionRows = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
const firstRow = actionRows[0];
const btn = firstRow.children[1];
ok(!!btn, '每个动作都有按钮');
btn.click();
eq(startedDifficulty, C.DIFFICULTIES[0].id, '点击出发把难度传给了场景');

// 铁匠铺：钱够时按钮可点，点后真的扣钱
const anvil = sandbox.GameHub.ZONES.find(z => z.id === 'anvil');
let performed = [];
sandbox.EmberfieldUI.openPanel(anvil, bootedState, () => {}, (a) => {
  performed.push(a.payload.key);
  sandbox.GameHub.perform(bootedState, a);
  sandbox.EmberfieldUI.refreshPanel(anvil, bootedState);
});
const anvilRows = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
eq(anvilRows.length, 3, '铁匠铺三条强化');
const coinBefore = bootedState.meta.coins;
anvilRows[0].children[1].click();
eq(performed.length, 1, '点击强化按钮触发了动作');
ok(bootedState.meta.coins < coinBefore, '强化后铜币减少',
   coinBefore + ' -> ' + bootedState.meta.coins);

// 钱为 0 时按钮应当禁用
bootedState.meta.coins = 0;
sandbox.EmberfieldUI.refreshPanel(anvil, bootedState);
const brokeRows = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
ok(brokeRows.every(r => r.children[1].disabled), '没钱时强化按钮全部禁用');

// 祭坛：技能条目带等级与冷却变化
const altar = sandbox.GameHub.ZONES.find(z => z.id === 'altar');
sandbox.EmberfieldUI.openPanel(altar, bootedState, () => {}, () => {});
const altarRows = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
eq(altarRows.length, C.SKILL_ORDER.length, '祭坛列出全部技能');
ok(altarRows[altarRows.length - 1].className.indexOf('ult') >= 0, '大招条目有独立样式');

// 关闭面板
getEl('panelX').click();
eq(getEl('panel').className, 'overlay', '点 ✕ 关闭面板');

// ---------------------------------------------------------------- 兵器架三态（V14）
section('4b. 兵器架：按钮写动作 + 页签只筛行');
{
  /*
   * 这一节钉两件玩家一眼就能看见的事：
   *   1. 按钮文案来自动作本身（购买 / 穿戴 / 升级 / 卸掉），
   *      而不是物品名，也不是旧的 "cost 为 0 就写执行" 阶梯；
   *   2. 页签（全部/未拥有/已拥有/已穿戴/特殊）只决定"这一屏显示哪一类"，
   *      不改变每一行给的是哪个动作 —— 否则"未拥有"页签里的件会丢掉购买动作。
   */
  const forgewear = sandbox.GameHub.ZONES.find(z => z.id === 'forgewear');
  const smith = L.createState(777);
  sandbox.GameHub.ensureHub(smith);
  smith.meta.coins = 3000;

  const panelRows = () => getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
  const tabsEl = () => getEl('panelBody').children.filter(c => c.className === 'tabs')[0];
  const tabByLabel = (label) => (tabsEl() ? tabsEl().children.filter(b => b.textContent === label)[0] : null);
  // 取不到就记一条失败并在空白元素上继续：崩掉整个文件会把后面的断言全藏起来。
  const mustTab = (label) => {
    const t = tabByLabel(label);
    ok(!!t, '页签「' + label + '」存在');
    return t || { click() {}, className: '', children: [] };
  };
  // 从 .txt 的 innerHTML 里精确取物品名（不能用 indexOf：'雷鸣角盔' 也含 '角盔'）
  const labelOf = (r) => {
    const m = /<div class="t">([^<]*)<\/div>/.exec(r.children[0].innerHTML);
    return m ? m[1] : '';
  };
  const rowsWithLabel = (label) => panelRows().filter(r => labelOf(r) === label);
  const btnOf = (row) => (row && row.children[1]) || { click() {}, textContent: '', disabled: true };
  const textOf = (row) => String(btnOf(row).textContent);

  sandbox.EmberfieldUI.openPanel(forgewear, smith, () => {}, (a) => {
    sandbox.GameHub.perform(smith, a);
    sandbox.EmberfieldUI.refreshPanel(forgewear, smith);
  });

  const total = Object.keys(C.ALL_EQUIPMENT).length;
  const tabs0 = tabsEl() || { children: [] };
  ok(!!tabsEl(), '兵器架有页签条');
  eq(tabs0.children.length, 5, '五个页签');
  eq(tabs0.children.map(b => b.textContent).join('/'), '全部/未拥有/已拥有/已穿戴/特殊',
     '页签文案与顺序（全部 / 未拥有 / 已拥有 / 已穿戴 / 特殊）');
  eq(tabs0.children[0] && tabs0.children[0].className, 'tab on', '默认停在"全部"页签');
  eq(panelRows().length, total, '全部页签列出 ' + total + ' 行');
  ok(panelRows().every(r => textOf(r).length > 0),
     '每行按钮都有文案（不会出现空按钮）');

  // ① 没买 → 按钮写"购买"，价格还在（改名不能把价格吞掉）
  const before = rowsWithLabel('角盔');
  eq(before.length, 1, '没买时角盔只有一行');
  const firstHelm = before[0] || { children: [{ innerHTML: '' }, { click() {}, textContent: '' }] };
  eq(textOf(firstHelm).indexOf('购买'), 0, '未买时按钮写"购买"',
     textOf(firstHelm));
  ok(textOf(firstHelm).indexOf(String(C.equipDef('hornHelm').price)) > 0,
     '按钮上仍写着价格', btnOf(before[0]).textContent);

  // ② 买下 → 当场变"穿戴"
  btnOf(firstHelm).click();
  eq(rowsWithLabel('角盔').length, 1, '买完仍是一行（没有多出副本行）');
  eq(String(btnOf(rowsWithLabel('角盔')[0]).textContent), '穿戴', '买完按钮当场变"穿戴"');

  // ③ 穿上 → 两个按钮：升级（带价）+ 卸掉
  btnOf(rowsWithLabel('角盔')[0]).click();
  const worn = rowsWithLabel('角盔');
  eq(worn.length, 2, '穿上后同一件出现两行');
  eq(textOf(worn[0]).indexOf('升级'), 0, '第一个按钮写"升级"',
     textOf(worn[0]));
  ok(textOf(worn[0]).indexOf(String(C.equipPrice('hornHelm', 2))) > 0,
     '升级按钮写着下一级价格', textOf(worn[0]));
  eq(textOf(worn[1]), '卸掉', '第二个按钮写"卸掉"');

  // ④ 点"卸掉"真的落地
  btnOf(worn[1]).click();
  eq(smith.meta.equipment.head, null, '点"卸掉"后头部槽空了');
  eq(rowsWithLabel('角盔').length, 1, '卸掉后又只剩一行');
  eq(String(btnOf(rowsWithLabel('角盔')[0]).textContent), '穿戴', '卸掉后按钮回到"穿戴"');

  // ⑤ 页签：未拥有只剩没买的件
  mustTab('未拥有').click();
  eq((tabsEl() ? tabsEl().children : []).filter(b => b.className.indexOf('on') >= 0).length, 1,
     '同时只有一个页签选中');
  eq(mustTab('未拥有').className, 'tab on', '点中的页签变成选中态');
  eq(panelRows().length, total - 1, '未拥有页签少掉已买的角盔');
  ok(!panelRows().some(r => labelOf(r) === '角盔'),
     '已买的角盔不在"未拥有"页签里');
  ok(panelRows().every(r => textOf(r).indexOf('购买') === 0),
     '未拥有页签里每行都是"购买"动作');

  // ⑥ 已穿戴页签只有身上那件的两条动作
  mustTab('全部').click();
  btnOf(rowsWithLabel('角盔')[0]).click();      // 再穿上（上一步卸掉了）
  mustTab('已穿戴').click();
  eq(panelRows().length, 2, '已穿戴页签只有角盔那两条动作');
  eq(String(btnOf(panelRows()[0]).textContent).indexOf('升级'), 0, '已穿戴页签第一条是升级');
  eq(String(btnOf(panelRows()[1]).textContent), '卸掉', '已穿戴页签第二条是卸掉');

  // ⑦ 特殊页签只列特效装备
  const specials = Object.keys(C.ALL_EQUIPMENT).filter(id => C.equipDef(id).kind === 'special');
  mustTab('特殊').click();
  eq(panelRows().length, specials.length, '特殊页签只列特效装备');
  ok(panelRows().every(r => r.className.indexOf('ult') >= 0), '特殊页签每行都是特效样式');

  mustTab('全部').click();
  // 注意：此刻角盔穿在身上，"全部"是 35 件 + 身上那件多出的 1 行（升级+卸掉）＝ 36 行。
  // 用"与不过滤时逐行一致"来断言，而不是写死 35 —— 后者会把'穿戴件两行'这个
  // 新口径误判成页签失效。
  const allRows = panelRows();
  eq(allRows.length, sandbox.GameHub.zoneActions(smith, 'forgewear').length,
     '切回"全部"与不过滤时的行数一致');
  const names = {};
  allRows.forEach(r => { names[labelOf(r)] = true; });
  eq(Object.keys(names).length, total, '切回"全部"件数仍为 ' + total + '（一件不少）');
}

// ---------------------------------------------------------------- 结算
section('5. 结算界面');
L.startRun(bootedState, 'wood');
L.endRun(bootedState, false);
let backCalled = false;
sandbox.EmberfieldUI.showResult(bootedState, () => { backCalled = true; });
eq(getEl('panelTitle').textContent, '倒下了', '失败标题正确');
ok(getEl('panelBody').innerHTML.indexOf('只保留一半') >= 0, '失败文案提示战利品减半');
// 结算界面现在把两个按钮放在一行里（div > button）：
// 「再来一局」是 restart（原文对游戏形态的必需项），「回基地」去经营。
// 断言要按 id 找，而不是按位置 —— 按位置找会在布局调整时静默失灵。
function findByIdIn(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of (node.children || [])) {
    const hit = findByIdIn(c, id);
    if (hit) return hit;
  }
  return null;
}
const panelBody = getEl('panelBody');
const backBtn = findByIdIn(panelBody, 'btn-back');
const againBtn = findByIdIn(panelBody, 'btn-again');
ok(!!backBtn, '结算有「回基地」按钮');
ok(!!againBtn, '结算有「再来一局」按钮（restart 是游戏形态的必需项）');

// ✕ 必须和"回基地"等价。它会先让 closePanel 走一遍 onClose，
// 所以 onClose 里不能再调 closePanel（会无限递归，实测栈溢出）。
backCalled = false;
getEl('panelX').click();
ok(backCalled, '结算卡点 ✕ 也会回基地（不会卡在死界面）');

// 回基地按钮本身也要work
backCalled = false;
sandbox.EmberfieldUI.showResult(bootedState, () => { backCalled = true; });
findByIdIn(getEl('panelBody'), 'btn-back').click();
ok(backCalled, '点回基地按钮会触发回调');

// 再来一局会调用场景注册的实现
let againCalled = false;
sandbox.EmberfieldUI.setAgainHandler(() => { againCalled = true; });
sandbox.EmberfieldUI.showResult(bootedState, () => {});
const again2 = findByIdIn(getEl('panelBody'), 'btn-again');
ok(!!again2, '再来一局按钮存在');
if (again2) { again2.click(); ok(againCalled, '点再来一局触发了场景的重开实现'); }

// ---------------------------------------------------------------- 存档码
section('6. 存档码导入');
const code = sandbox.GameProfile.exportCode('老档', L.serialize(bootedState));
getEl('codeBox').value = code;
let importErr = null;
try { getEl('btnImport').click(); } catch (e) { importErr = e; }
ok(!importErr, '导入按钮不抛异常', importErr && importErr.message);
// 注意传 localStorage 包装而不是裸 Map：listProfiles 内部有 try/catch，
// 传错对象会静默返回空列表，不报错但结果永远是 false。
ok(sandbox.GameProfile.exists(sandbox.localStorage, '老档'), '存档码导入后档案存在');

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
