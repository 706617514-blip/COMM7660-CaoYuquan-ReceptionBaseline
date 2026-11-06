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
  'vendor/phaser.min.js', 'config.js', 'logic.js', 'profile.js', 'hub.js', 'app.js',
]), '脚本加载顺序正确（Phaser 先于 app.js）');

let bootErr = null;
try {
  loadModule('game/config.js');
  loadModule('game/logic.js');
  loadModule('game/profile.js');
  loadModule('game/hub.js');
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

// ---------------------------------------------------------------- 结算
section('5. 结算界面');
L.startRun(bootedState, 'wood');
L.endRun(bootedState, false);
let backCalled = false;
sandbox.EmberfieldUI.showResult(bootedState, () => { backCalled = true; });
eq(getEl('panelTitle').textContent, '倒下了', '失败标题正确');
ok(getEl('panelBody').innerHTML.indexOf('只保留一半') >= 0, '失败文案提示战利品减半');
const backBtn = getEl('panelBody').children.find(c => c.className.indexOf('buy') >= 0);
ok(!!backBtn, '结算有回基地按钮');

// ✕ 必须和"回基地"等价。它会先让 closePanel 走一遍 onClose，
// 所以 onClose 里不能再调 closePanel（会无限递归，实测栈溢出）。
backCalled = false;
getEl('panelX').click();
ok(backCalled, '结算卡点 ✕ 也会回基地（不会卡在死界面）');

// 回基地按钮本身也要work
backCalled = false;
sandbox.EmberfieldUI.showResult(bootedState, () => { backCalled = true; });
const backBtn2 = getEl('panelBody').children.find(c => c.className.indexOf('buy') >= 0);
backBtn2.click();
ok(backCalled, '点回基地按钮会触发回调');

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
