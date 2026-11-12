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
    dataset: {},
    setAttribute(k, v) { this['attr_' + k] = v; },
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
    // baghud 用 toggle(名, 条件) 摆页面态（页签高亮 / 工具条隐藏）；缺了它
    // 一条 TypeError 会把整段背包断言吞掉，看起来像"取图链路全崩"。
    toggle: (c, on) => {
      if (on === undefined) { if (cls.has(c)) cls.delete(c); else cls.add(c); return; }
      if (on) cls.add(c); else cls.delete(c);
    },
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
  'vendor/phaser.min.js', 'config.js', 'sprites.js', 'audio.js', 'logic.js', 'profile.js',
  'hub.js', 'baghud.js', 'app.js',
]), '脚本加载顺序正确（Phaser 先于 app.js；sprites.js 早于 baghud.js/app.js，它们要用）');

let bootErr = null;
try {
  loadModule('game/config.js');
  // sprites.js 只依赖"调用时"存在的 global.__game，求值时不需要引擎，
  // 但必须在 baghud.js / index.html 用到它之前加载（否则取贴图会退化成 null）。
  loadModule('game/sprites.js');
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
ok(typeof sandbox.SpriteLib === 'object', 'SpriteLib 已挂在全局（贴图键 → dataURL，铁匠铺与兵器架共用）');
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
   *   2. 页签（全部/头部/躯干/背部/武器/脚部/特殊）只决定"这一屏显示哪一类"，
   *      不改变每一行给的是哪个动作 —— 否则部位页签里的未买件会丢掉购买动作。
   *
   * Task 21 把页签从**状态**维度（全部/未拥有/已拥有/已穿戴/特殊）换成
   * **部位**维度（全部/头部/躯干/背部/武器/脚部/特殊），与背包一致。
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
  eq(tabs0.children.length, 7, '七个部位页签');
  eq(tabs0.children.map(b => b.textContent).join('/'),
     '全部/头部/躯干/背部/武器/脚部/特殊',
     '页签文案与顺序（全部 / 头部 / 躯干 / 背部 / 武器 / 脚部 / 特殊）');
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

  // ⑤ 页签：头部页签只剩头部件（含 special 的头部件）
  // 口径：这一屏的行数按部位现算，不写死 —— 穿戴中的件给两条动作。
  const expectRowsFor = (slot) => Object.keys(C.ALL_EQUIPMENT).reduce((n, id) => {
    const def = C.equipDef(id);
    if (def.slot !== slot) return n;
    return n + (L.equipOwned(smith, id) === 'equipped' ? 2 : 1);
  }, 0);
  const idOfLabel = (label) => Object.keys(C.ALL_EQUIPMENT)
    .filter(k => C.equipDef(k).name === label)[0];
  mustTab('头部').click();
  eq((tabsEl() ? tabsEl().children : []).filter(b => b.className.indexOf('on') >= 0).length, 1,
     '同时只有一个页签选中');
  eq(mustTab('头部').className, 'tab on', '点中的页签变成选中态');
  eq(panelRows().length, expectRowsFor('head'),
     '头部页签行数 = 头部件现算（穿戴件算 2 行）');
  ok(panelRows().every(r => {
    const id = idOfLabel(labelOf(r));
    return !!id && C.equipDef(id).slot === 'head';
  }), '头部页签里每一行都是头部件');
  // 非头部件一件都不许出现
  ok(!panelRows().some(r => C.equipDef(idOfLabel(labelOf(r)) || '').slot === 'torso'),
     '躯干件不在头部页签里');
  ok(!panelRows().some(r => C.equipDef(idOfLabel(labelOf(r)) || '').slot === 'weapon'),
     '武器件不在头部页签里');
  // 三态不受页签影响：每行按钮仍写动作（购买 / 穿戴 / 升级 / 卸掉 / 已满级）
  ok(panelRows().every(r => /^(购买|穿戴|升级|卸掉|已满级)/.test(textOf(r))),
     '头部页签里每行按钮仍写动作（页签不改三态）');
  // special 的头部件必须还在（部位页签不排除 special）
  const headSpecial = Object.keys(C.ALL_EQUIPMENT).filter(id =>
    C.equipDef(id).slot === 'head' && C.equipDef(id).kind === 'special');
  eq(headSpecial.length, 2, '头部件里有 2 件 special（雷鸣角盔 / 雷鸣指环）');
  headSpecial.forEach(id => {
    ok(panelRows().some(r => labelOf(r) === C.equipDef(id).name),
       '头部页签含 special 件「' + C.equipDef(id).name + '」（部位页签不排除 special）');
  });

  // ⑥ 武器页签：行数 = 武器件现算值，且不含其它部位
  mustTab('武器').click();
  eq(panelRows().length, expectRowsFor('weapon'), '武器页签行数 = 武器件现算');
  ok(panelRows().every(r => {
    const id = idOfLabel(labelOf(r));
    return !!id && C.equipDef(id).slot === 'weapon';
  }), '武器页签里每一行都是武器件');
  ok(!panelRows().some(r => labelOf(r) === '角盔'), '头部件不在武器页签里');

  // ⑦ 特殊页签只列特效装备（跨部位：与部位页签是两套独立维度）
  const specials = Object.keys(C.ALL_EQUIPMENT).filter(id => C.equipDef(id).kind === 'special');
  mustTab('特殊').click();
  eq(panelRows().length, specials.length, '特殊页签只列特效装备');
  ok(panelRows().every(r => r.className.indexOf('ult') >= 0), '特殊页签每行都是特效样式');
  const specialSlots = {};
  specials.forEach(id => { specialSlots[C.equipDef(id).slot] = true; });
  eq(Object.keys(specialSlots).length, 5,
     '特殊件覆盖全部五个部位（所以「特殊」是稀有度维度，不能与部位页签叠罗汉）');

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

// ---------------------------------------------------------------- 设施面板的页签与图标（Task 17）
section('4c. 设施面板：按区域的页签 + 行内图标（Task 17）');
{
  /*
   * 为什么要有这一节
   * ----------------
   * PM 的抱怨是"铁匠铺没有分类、没有图"。数据层（cat / icon 字段）在
   * test_game_meta.js 里钉过了，但**页签配置写在 index.html 里** ——
   * 页签文案、顺序、以及"哪个区域才有页签"都只活在这一层，逻辑测试看不到它。
   * DOM 桩的 innerHTML 只是字符串、数不到图，所以这里断言的是"UI 交给渲染器的
   * 模型"，真要看见像素由 smoke 负责。
   */
  const ui = sandbox.EmberfieldUI;
  ok(typeof ui.panelTabsFor === 'function', '导出 panelTabsFor（页签配置的唯一来源）');
  ok(typeof ui.panelRowModel === 'function', '导出 panelRowModel（行渲染的唯一来源）');
  // 取不到就退化成空实现：崩掉整个文件会把后面三十多条断言一起藏起来，
  // 只剩一行 TypeError，看不出到底缺什么（同 4b 的 mustTab 做法）。
  const tabsFor = typeof ui.panelTabsFor === 'function'
    ? ui.panelTabsFor : () => [];
  const rowModel = typeof ui.panelRowModel === 'function'
    ? ui.panelRowModel : () => ({});

  const anvilTabs = tabsFor('anvil');
  eq(anvilTabs.length, 4, '铁匠铺有四个页签');
  eq(anvilTabs.map(t => t.label).join('/'), '全部/攻击/生存/机动', '铁匠铺页签文案与顺序');
  eq(anvilTabs.map(t => t.id).join('/'), 'all/attack/defense/move', '铁匠铺页签 id');
  const wearTabs = tabsFor('forgewear');
  eq(wearTabs.length, 7, '兵器架换成七个部位页签');
  eq(wearTabs.map(t => t.label).join('/'), '全部/头部/躯干/背部/武器/脚部/特殊',
     '兵器架页签文案与顺序（部位维度，与背包一致）');
  eq(wearTabs.map(t => t.id).join('/'), 'all/head/torso/back/weapon/feet/special',
     '兵器架页签 id = all + C.EQUIP_SLOTS + special');
  // 顺序必须与 C.EQUIP_SLOTS 逐字一致：`全部` + 五个部位 + `特殊`
  eq(wearTabs.slice(1, 6).map(t => t.id).join('/'),
     sandbox.GameConfig.EQUIP_SLOTS.join('/'),
     '中间五个页签 id 依次等于 C.EQUIP_SLOTS（顺序一致）');
  // 文案必须与**背包面板**那套逐字一致（PM 要的是"和背包一致"）。
  // 注意不能拿 C.EQUIP_SLOT_NAMES 来比：那里 feet 是「鞋」，而背包页签写的是
  // 「脚部」（baghud.js 的 TABS 自己硬编码了七个文案）。权威是背包的文案表。
  const BAG_TAB_LABELS = ['全部', '头部', '躯干', '背部', '武器', '脚部', '特殊'];
  eq(wearTabs.map(t => t.label).join('/'), BAG_TAB_LABELS.join('/'),
     '兵器架七个文案与背包面板逐字一致');
  eq(wearTabs.map(t => t.id).join('/'),
     ['all'].concat(sandbox.GameConfig.EQUIP_SLOTS).concat(['special']).join('/'),
     '兵器架页签 id = 全部 + C.EQUIP_SLOTS + 特殊（与背包同构）');
  // 旧的三个状态页签 id 必须彻底消失（不给兼容分支，靠 currentTab 自动退回 'all'）
  ['unowned', 'owned', 'worn'].forEach(oldId => {
    ok(!wearTabs.some(t => t.id === oldId),
       '旧状态页签 id「' + oldId + '」已从配置里删掉');
  });
  eq(tabsFor('altar').length, 0, '祭坛没有页签配置（返回空数组，不渲染页签条）');
  eq(tabsFor('shop').length, 0, '药水铺没有页签配置');
  eq(tabsFor('field').length, 0, '田地没有页签配置');

  // SpriteLib：没有引擎（Node 桩 / 纹理没烘好）时必须返回 null 而不是抛，
  // 否则 refreshPanel 会在渲染中途炸掉整个面板。
  eq(sandbox.SpriteLib.url('hero'), null, '取不到纹理时 url() 返回 null（不抛）');
  eq(sandbox.SpriteLib.equipUrl('head', 'leatherHelm'), null, 'equipUrl 走同一入口');
  eq(typeof sandbox.SpriteLib.clear, 'function', 'SpriteLib.clear 存在（测试可重置缓存）');

  // ---- Task 18：fitUrl（按内容紧裁切 + 整数倍放大）----
  /*
   * 为什么这一层要单独测
   * ------------------
   * url() 交出去的是 40×60 的整身画布，头部装备只占其中一条横带；塞进
   * object-fit:contain 的小盒子后按 0.7 倍缩小，画面上就是一条色带
   * （Task 17 报告 §4 自己记下的问题）。fitUrl 负责"先裁到内容、再整数倍放大"，
   * 真像素由 smoke 量。这里钉三件事：函数存在、所有退化路径返回 null 不抛、
   * 以及 panelRowModel/refreshPanel 真的在用它。
   *
   * 取不到就退化成空实现：桩里连 canvas 都没有，一条 TypeError 会把这一节
   * 后面几十条断言一起吞掉（Task 17 的教训）。
   */
  const fitUrl = typeof sandbox.SpriteLib.fitUrl === 'function'
    ? sandbox.SpriteLib.fitUrl : () => null;
  ok(typeof sandbox.SpriteLib.fitUrl === 'function',
     '导出 fitUrl（紧裁切 + 整数倍放大，面板行图标靠它变可读）');
  eq(fitUrl('hero', 32, 44), null, '没有引擎时 fitUrl 返回 null（不抛，面板不会空白）');
  eq(fitUrl(null, 32, 44), null, 'key 为空时 fitUrl 返回 null');
  eq(fitUrl('hero', 0, 0), null, '盒子尺寸非法时 fitUrl 返回 null');

  // 桩里的 document.createElement('canvas') 没有 getContext —— 这正是
  // "取不到离屏 2D context" 那条分支，必须优雅退回 null 而不是抛。
  sandbox.__game = {
    textures: { get: () => ({ source: [{ image: { width: 40, height: 60 } }] }) },
  };
  let fitErr = null;
  let fitOut;
  try { fitOut = fitUrl('eq-head-leatherHelm', 32, 44); } catch (e) { fitErr = e; }
  eq(fitErr, null, '取不到离屏 canvas 的 2D context 时不抛（优雅退回）');
  eq(fitOut, null, '取不到 2D context 时 fitUrl 返回 null（调用方退回 url()）');
  eq(fitUrl('eq-head-leatherHelm', 32, 44), null,
     '失败结果不进缓存（等真纹理/真 canvas 就绪时还能成功）');
  delete sandbox.__game;

  const st = L.createState(778);
  sandbox.GameHub.ensureHub(st);
  st.meta.coins = 3000;

  // 每个页签 id 都必须能筛出东西 —— 配了页签却过滤不生效，界面上就是一片空白
  anvilTabs.forEach((t) => {
    const rows = sandbox.GameHub.zoneActions(st, 'anvil', t.id);
    ok(rows.length > 0, '铁匠铺页签「' + t.label + '」筛出至少一行', rows.length);
  });

  // 行模型：UI 拿到的就是它要渲染的东西
  const acts = sandbox.GameHub.zoneActions(st, 'anvil');
  const m0 = rowModel(acts[0]);
  eq(m0.iconKey, 'ic-damage', '第一行模型带图标键 ic-damage');
  eq(m0.label, '锋刃', '行模型的 label 来自动作');
  ok(typeof m0.sub === 'string' && m0.sub.indexOf('Lv.') === 0, '行模型带说明行', m0.sub);
  eq(m0.buttonText, '25', '按钮文字仍是价格字符串（加图标没动按钮语义）');
  eq(m0.enabled, true, '钱够时行模型 enabled');
  eq(m0.disabledReason, '', '可用时没有禁用原因');
  const poor = L.createState(779);
  sandbox.GameHub.ensureHub(poor);
  poor.meta.coins = 0;
  const pm = rowModel(sandbox.GameHub.zoneActions(poor, 'anvil')[0]);
  eq(pm.enabled, false, '钱不够时行模型 enabled=false');
  eq(pm.disabledReason, '铜币不够', '行模型带禁用原因');
  // 兵器架的行模型也要能给出贴图键（35 行靠它取图）
  const wearActs = sandbox.GameHub.zoneActions(st, 'forgewear');
  const helmAct = wearActs.filter(a => a.payload.id === 'leatherHelm')[0];
  eq(rowModel(helmAct).iconKey, 'eq-head-leatherHelm', '兵器架行模型带装备贴图键');

  // 真面板结构：资源行 + 页签条 + 3 行
  const anvilZone = sandbox.GameHub.ZONES.find(z => z.id === 'anvil');
  ui.openPanel(anvilZone, st, () => {}, () => {});
  const kids = getEl('panelBody').children;
  eq(kids.length, 5, '铁匠铺面板 = 资源行 1 + 页签条 1 + 强化 3 行', kids.length);
  eq(kids[1] && kids[1].className, 'tabs', '第二个节点是页签条（资源行之后）');
  eq(kids[1] ? kids[1].children.length : -1, 4, '页签条上有 4 个页签');
  eq(kids[1] ? kids[1].children.map(b => b.textContent).join('/') : '',
     '全部/攻击/生存/机动', '页签挂在真面板上文案正确');
  eq(kids[1] && kids[1].children[0].className, 'tab on', '默认停在「全部」');
  const anvilRows = kids.slice(2).filter(c => c.className.indexOf('act') >= 0);
  eq(anvilRows.length, 3, '页签之后是 3 行强化');
  eq(anvilRows.map(r => String(r.children[1].textContent)).join('/'), '25/30/28',
     '三行按钮写的是各自的价格');
  ok(anvilRows.every(r => r.children.length === 2),
     '桩里取不到 dataURL 时不留空 img 节点（渲染器不插、不抛）',
     anvilRows.map(r => r.children.length).join(','));

  // 点「攻击」：只剩一行；点回「全部」：三行回来
  const tabsBar0 = kids.filter(c => c.className === 'tabs')[0];
  const attackBtn = tabsBar0
    ? tabsBar0.children.filter(b => b.textContent === '攻击')[0] : null;
  ok(!!attackBtn, '页签「攻击」存在');
  if (attackBtn) attackBtn.click();
  const rowsAttack = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
  eq(rowsAttack.length, 1, '点「攻击」后只剩 1 行');
  ok(rowsAttack[0] && /锋刃/.test(rowsAttack[0].children[0].innerHTML), '剩下的是锋刃');
  const tabsBar1 = getEl('panelBody').children.filter(c => c.className === 'tabs')[0];
  const allBtn = tabsBar1
    ? tabsBar1.children.filter(b => b.textContent === '全部')[0] : null;
  if (allBtn) allBtn.click();
  eq(getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0).length, 3,
     '点回「全部」恢复 3 行');

  // 兵器架面板：页签位置不变、行数不变
  const wearZone = sandbox.GameHub.ZONES.find(z => z.id === 'forgewear');
  ui.openPanel(wearZone, st, () => {}, () => {});
  const wearKids = getEl('panelBody').children;
  eq(wearKids[1] && wearKids[1].className, 'tabs', '兵器架页签条仍在资源行之后');
  eq(wearKids[1] ? wearKids[1].children.length : -1, 7, '兵器架换成 7 个部位页签');
  eq(wearKids.filter(c => c.className.indexOf('act') >= 0).length,
     sandbox.GameHub.zoneActions(st, 'forgewear').length, '兵器架行数与不过滤时一致');

  // ---- Task 18：行首图必须走 fitUrl，盒子尺寸就是 CSS 的 32×44 ----
  /*
   * 改前 refreshPanel 只调 url()：fitUrl 一次都不会被调到，交出去的是整身
   * 40×60 画布，头部装备被压成色带。这条用 spy 钉"真的调了、参数对、有结果
   * 就用它、没结果退回整图"—— 具体像素由 smoke 量。
   */
  const fitCalls = [];
  const realFit = sandbox.SpriteLib.fitUrl;
  const realUrl = sandbox.SpriteLib.url;
  sandbox.SpriteLib.fitUrl = function (k, w, h) {
    fitCalls.push(String(k) + '@' + w + 'x' + h);
    return null;
  };
  sandbox.SpriteLib.url = function (k) { return 'data:image/png;base64,STUB-' + k; };
  ui.openPanel(anvilZone, st, () => {}, () => {});
  eq(fitCalls.join('/'), 'ic-damage@32x44/ic-maxHp@32x44/ic-speed@32x44',
     '三行图标都先问 fitUrl(32, 44)（盒子跟着 CSS 走，不是贴图原尺寸 40×60）');
  const fitRowsA = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
  ok(fitRowsA[0] && fitRowsA[0].children[0] && fitRowsA[0].children[0].src
     === 'data:image/png;base64,STUB-ic-damage',
     'fitUrl 取不到时退回整图 url()（不让这一行没图）',
     fitRowsA[0] && fitRowsA[0].children[0] && fitRowsA[0].children[0].src);
  sandbox.SpriteLib.fitUrl = function (k) {
    fitCalls.push(String(k));
    return 'data:image/png;base64,FIT-' + k;
  };
  ui.openPanel(anvilZone, st, () => {}, () => {});
  const fitRowsB = getEl('panelBody').children.filter(c => c.className.indexOf('act') >= 0);
  ok(fitRowsB[0] && fitRowsB[0].children[0] && fitRowsB[0].children[0].src
     === 'data:image/png;base64,FIT-ic-damage',
     'fitUrl 有结果时优先用它（紧裁切过的图，不是整身画布）',
     fitRowsB[0] && fitRowsB[0].children[0] && fitRowsB[0].children[0].src);
  sandbox.SpriteLib.fitUrl = realFit;
  sandbox.SpriteLib.url = realUrl;

  // ---- Task 19：背包格子与穿戴槽也走 fitUrl（盒子 32x46 / 20x28）----
  /*
   * 为什么在界面层测"调用序列"而不是"图长什么样"
   * ------------------------------------------
   * 桩里的 makeEl().querySelector() 每次返回新节点，测试拿不到 BagHud 内部建的
   * ui.cells / ui.slots，所以没法直接读 <img>.src。能钉的是**取图链路**：
   * 谁先被问、盒子多大、键拼得对不对、拿不到裁切图时退回哪条路。
   * 真像素由 smoke 量（naturalWidth x naturalHeight + 内容包围盒）。
   *
   * 键为什么必须一致：sprites.js 里没有导出的键构造器，baghud 只能按同一个
   * 约定再拼一次 'eq-' + slot + '-' + id。拼错的时候 fitUrl 拿到的是 Phaser 的
   * __MISSING 占位纹理（Task 18 实测：不是 null，是一张 630 字符的图）——
   * 画面上照样"有图"，只是内容全错，只有断言能抓住它。
   */
  ok(typeof sandbox.BagHud === 'object' && typeof sandbox.BagHud.open === 'function',
     'BagHud 已挂在全局（背包取图在它里面）');
  eq(Object.keys(sandbox.BagHud).sort().join(','), 'clamp,close,isOpen,open,refresh,setHost',
     'BagHud 公开 API 一个没多一个没少（open/close/refresh/isOpen/clamp 签名不动）');

  const bagSt19 = L.createState(781);
  sandbox.GameHub.ensureHub(bagSt19);
  bagSt19.meta.bag.length = 0;
  ['leatherHelm', 'ironHelm', 'rustySword'].forEach(function (id) { L.bagAdd(bagSt19, id, 1); });
  bagSt19.meta.equipment = {
    head: { id: 'leatherHelm', level: 2 },
    torso: { id: 'chestPlate', level: 1 },
    back: { id: 'shortCape', level: 1 },
    weapon: { id: 'rustySword', level: 1 },
    feet: { id: 'windBoots', level: 1 },
  };

  const log19 = [];
  const realFit19 = sandbox.SpriteLib.fitUrl;
  const realEquip19 = sandbox.SpriteLib.equipUrl;
  const realUrl19 = sandbox.SpriteLib.url;
  const stubFit19 = function (k, w, h) {
    log19.push('fit:' + String(k) + '@' + w + 'x' + h);
    return null;                       // 先装成"取不到裁切图"，量退回路径
  };
  sandbox.SpriteLib.fitUrl = stubFit19;
  sandbox.SpriteLib.equipUrl = function (slot, id) {
    log19.push('equip:' + String(slot) + ':' + String(id));
    return 'data:image/png;base64,EQ-' + id;
  };
  sandbox.SpriteLib.url = function (k) {
    log19.push('url:' + String(k));
    return 'data:image/png;base64,U-' + k;
  };
  let bagErr19 = null;
  let bagOpened19 = false;
  try { bagOpened19 = sandbox.BagHud.open(bagSt19); } catch (e) { bagErr19 = e; }
  ok(bagErr19 === null, '桩里打开背包不抛（取图链路没有 TypeError）',
     bagErr19 && String(bagErr19.stack || bagErr19).split('\n').slice(0, 2).join(' | '));
  ok(bagOpened19 === true, 'BagHud.open 返回 true（build 成功，说明桩够用）');
  ok(log19.length > 0, '取图链路真的跑到了（否则下面几条是在量空气）');

  const pick19 = function (tag) {
    return log19.filter(function (s) { return s.indexOf(tag) === 0; });
  };
  const fits19 = pick19('fit:');
  const equips19 = pick19('equip:');
  const urls19 = pick19('url:');
  // 日志前缀 'fit:' 只是分类用的：比 key 的时候统一削掉
  const fitArgs19 = fits19.map(function (s) { return s.slice(4); });
  eq(fitArgs19.slice(0, 3).join('/'),
     'eq-head-leatherHelm@32x46/eq-head-ironHelm@32x46/eq-weapon-rustySword@32x46',
     '三个背包格子按 CSS 盒子 32x46 先问 fitUrl（改前从不问）', fitArgs19.join('/'));
  // 左右两列指向同一个部位，paintSlots 按部位遍历、每个部位画它那两个节点，
  // 所以顺序是 head,head,torso,torso,... —— 不是"左列五个再右列五个"。
  eq(fitArgs19.slice(3).join('/'),
     ['eq-head-leatherHelm@20x28', 'eq-head-leatherHelm@20x28',
       'eq-torso-chestPlate@20x28', 'eq-torso-chestPlate@20x28',
       'eq-back-shortCape@20x28', 'eq-back-shortCape@20x28',
       'eq-weapon-rustySword@20x28', 'eq-weapon-rustySword@20x28',
       'eq-feet-windBoots@20x28', 'eq-feet-windBoots@20x28'].join('/'),
     '十个穿戴槽（5 部位 x 左右两列）一律按 20x28 问 fitUrl', fitArgs19.slice(3).join('/'));
  eq(equips19.length, 18,
     'fitUrl 拿不到时 13 处（3 格 + 10 槽）退回整身图，纸娃娃再取 5 层',
     equips19.join('/'));
  eq(urls19.map(function (s) { return s.slice(4); }).join('/'), 'hero',
     '纸娃娃底图仍走 url(hero)（只有这一处，没有别的整身取图）', urls19.join('/'));

  const fitKeys19 = fits19.map(function (s) { return s.slice(4).split('@')[0]; });
  const equipKeys19 = equips19.map(function (s) {
    const p = s.slice(6).split(':');
    return 'eq-' + p[0] + '-' + p[1];
  });
  eq(fitKeys19.join('/'), equipKeys19.slice(0, 13).join('/'),
     '每条 fitUrl 的键与 equipUrl 自己拼的键逐条相同（拼错会拿到 __MISSING 占位图，不是 null）');

  // 拿到了裁切图：退回次数必须归零 —— 证明交出去的是 fitUrl 的那张
  log19.length = 0;
  sandbox.SpriteLib.fitUrl = function (k, w, h) {
    log19.push('fit:' + String(k) + '@' + w + 'x' + h);
    return 'data:image/png;base64,FIT-' + k;
  };
  sandbox.BagHud.refresh();
  const fitsB19 = pick19('fit:');
  const equipsB19 = pick19('equip:');
  eq(fitsB19.length, 13, '一次刷新问 13 次 fitUrl（3 格 + 10 槽）', fitsB19.length);
  eq(equipsB19.length, 5,
     '拿到裁切图后格子与槽位不再退回整身图（只剩纸娃娃那 5 层）',
     equipsB19.join('/'));
  eq(pick19('url:').map(function (s) { return s.slice(4); }).join('/'), 'hero',
     '纸娃娃底图没变（那层刻意没改）', pick19('url:').join('/'));
  ok(equipsB19.every(function (s) { return s.indexOf('equip:') === 0 && s.length > 6; }),
     '纸娃娃的五层仍然是"整身取图"那条路（不传盒子尺寸时行为与改前完全一致）',
     equipsB19.join('/'));

  sandbox.BagHud.close();
  sandbox.SpriteLib.fitUrl = realFit19;
  sandbox.SpriteLib.equipUrl = realEquip19;
  sandbox.SpriteLib.url = realUrl19;

  // ---- Task 18：图标盒子的 CSS 决定"内容占多大" ----
  /*
   * 为什么在这里断言 CSS：url()/fitUrl 交出的是位图，"盒子多宽"完全由 CSS 决定。
   * 改前 width:28px;height:42px 是硬盒，宽扁的头部装备只能 contain 到 0.7 倍，
   * 内容被压成横条。改成 max-width/max-height 后图片按自身比例落进盒子，
   * 配合 fitUrl 的整数倍放大，内容才是 1:1 像素、放大而不是缩小。
   */
  const icoRule = /\.act\s+\.ico\s*\{[^}]*\}/.exec(html);
  ok(!!icoRule, 'index.html 里有 .act .ico 规则');
  const icoCss = icoRule ? icoRule[0] : '';
  ok(/max-width:\s*32px/.test(icoCss) && /max-height:\s*44px/.test(icoCss),
     '图标盒子改成按图片自身比例（max 32×44），不再被硬盒掰成色带', icoCss);
  ok(!/width:\s*28px/.test(icoCss), '不再把宽度写死 28px（色带的直接来源）', icoCss);
  ok(!/margin-right/.test(icoCss), '不加 margin-right（.act 已有 gap:12px）', icoCss);
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

// 种子腐烂量必须写在结算卡上（V12）：种子变少如果没解释，玩家会以为存档坏了。
{
  const spoilState = L.createState(9);
  spoilState.meta.seeds = 30;
  L.startRun(spoilState, 'wood');
  L.endRun(spoilState, true);
  const spoils = spoilState.lastResult.seedSpoiled;
  // 承重条件：没有真的腐烂，"显示腐烂"和"不显示"就区分不开。
  ok(spoils > 0, '构造出真的腐烂（否则下面几条是恒真）', spoils);
  sandbox.EmberfieldUI.showResult(spoilState, () => {});
  const htmlSpoil = getEl('panelBody').innerHTML;
  ok(htmlSpoil.indexOf('腐烂') >= 0, '结算卡写明了腐烂', htmlSpoil);
  ok(htmlSpoil.indexOf('腐烂 ' + spoils) >= 0,
     '腐烂数量与 lastResult.seedSpoiled 一致', htmlSpoil);

  // 没腐烂时不能出现 —— 那句"（腐烂 0）"是纯噪音，还会让人以为机制出了问题。
  sandbox.EmberfieldUI.showResult(bootedState, () => {});
  ok(getEl('panelBody').innerHTML.indexOf('腐烂') < 0,
     '没有腐烂时不显示腐烂文案', getEl('panelBody').innerHTML);
}

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
