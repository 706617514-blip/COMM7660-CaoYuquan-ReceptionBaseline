/**
 * test_game_page.js — 对 game/index.html 的集成测试（DOM 桩，无需浏览器）。
 *
 * 为什么需要这一层
 * ----------------
 * tests/test_game_logic.js 只测纯逻辑。页面里的接线错误 —— 元素 id 拼错、
 * 事件没绑上、按钮点了没反应、渲染调用抛错 —— 逻辑测试全抓不到，
 * 而这些东西恰好是"玩家一打开就发现坏了"的那类问题。
 *
 * 做法：用最小 DOM 桩执行 index.html 里真实的 inline 脚本，
 * 再通过包装 GameRender.drawScene 拿到页面内部的 state，
 * 于是可以断言"点空田真的播种了""按 D 真的移动了""敌人真的刷出来了"。
 *
 * 用法: node tests/test_game_page.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'game', 'index.html');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}` + (detail !== undefined ? `  -> ${detail}` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(t) { console.log(`\n=== ${t} ===`); }

// ---------------------------------------------------------------- DOM 桩
function makeClassList(el) {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    _set: set,
  };
}

function makeEl(id) {
  const el = {
    id: id || '',
    textContent: '',
    _innerHTML: '',
    title: '',
    disabled: false,
    className: '',
    style: {},
    children: [],
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeEl(''); },
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; },
    click() { (this._handlers.click || []).forEach(fn => fn({ preventDefault() {} })); },
  };
  el.classList = makeClassList(el);
  // 真实 DOM 里给 innerHTML 赋值会替换掉全部子节点，
  // 桩若只存字符串，children 会不断累积，测试就会读到过期元素。
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; this.children.length = 0; },
  });
  return el;
}

const CTX_NOPS = ['fillRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'arc', 'arcTo', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate',
  'scale', 'rotate', 'rect', 'strokeRect', 'setTransform', 'quadraticCurveTo',
  'bezierCurveTo', 'clip', 'fillText', 'strokeText', 'drawImage'];

function makeCtx() {
  const ctx = { calls: 0 };
  CTX_NOPS.forEach(name => {
    ctx[name] = function () { ctx.calls++; };
  });
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  ctx.measureText = () => ({ width: 10 });
  ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font',
    'textAlign', 'textBaseline', 'shadowBlur', 'shadowColor'].forEach(p => { ctx[p] = ''; });
  return ctx;
}

// ---------------------------------------------------------------- 环境
const elements = new Map();
const rafQueue = [];
const winHandlers = {};
const store = new Map();

function getEl(id) {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
}

const sandbox = {
  console,
  Math, Date, JSON, Set, Map, Array, Object, String, Number, Boolean, Error,
  isFinite, parseInt, parseFloat,
  setTimeout, clearTimeout,
};

// 关键：浏览器里 window === globalThis。模块脚本把 API 挂到 globalThis，
// 页面脚本却从 window 读 —— 如果桩里把两者拆成不同对象，window.GameLogic 就是 undefined。
// 所以 window 必须就是沙箱本身。
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.addEventListener = function (type, fn) {
  (winHandlers[type] = winHandlers[type] || []).push(fn);
};
sandbox.removeEventListener = function () {};
sandbox.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
sandbox.cancelAnimationFrame = function () {};
sandbox.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
};
sandbox.confirm = () => true;
sandbox.alert = () => {};
sandbox.document = {
  getElementById: getEl,
  createElement: (tag) => makeEl(tag),
  addEventListener() {},
  querySelector: () => makeEl(''),
};

vm.createContext(sandbox);

function runFile(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  vm.runInContext(code, sandbox, { filename: rel });
}

// ---------------------------------------------------------------- 启动
section('1. 页面脚本能启动');
const html = fs.readFileSync(HTML_PATH, 'utf-8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok(inlineScripts.length === 1, 'index.html 里只有一个 inline 脚本', inlineScripts.length);

let bootError = null;
try {
  runFile('game/config.js');
  runFile('game/logic.js');
  runFile('game/render.js');

  // 包装渲染函数以取得页面内部 state（IIFE 里的 state 无法直接访问）
  let captured = null;
  const realDrawScene = sandbox.GameRender.drawScene;
  sandbox.GameRender.drawScene = function (ctx, st, t) {
    captured = st;
    return realDrawScene(ctx, st, t);
  };
  sandbox.__captured = () => captured;

  vm.runInContext(inlineScripts[0], sandbox, { filename: 'index.html:inline' });
} catch (e) {
  bootError = e;
}
ok(!bootError, '脚本执行不抛异常', bootError && (bootError.message + '\n' + bootError.stack));

// ---------------------------------------------------------------- 农庄
section('2. 农庄界面初始化');
ok(rafQueue.length > 0, '注册了动画帧回调');
eq(getEl('st-seeds').textContent, 3, '初始种子显示为 3');
eq(getEl('st-coins').textContent, 0, '初始铜币显示为 0');
ok(getEl('farmgrid').children.length === 9, '渲染出 9 块田',
   getEl('farmgrid').children.length);
ok(getEl('difflist').children.length === 4, '渲染出 4 个难度档',
   getEl('difflist').children.length);
ok(getEl('upgrades').children.length === 3, '渲染出 3 条强化线',
   getEl('upgrades').children.length);
ok(getEl('scr-farm').classList.contains('on'), '农庄界面默认可见');

// ---------------------------------------------------------------- 播种
section('3. 点空田能真的播种');
const plotEls = getEl('farmgrid').children;
ok(plotEls.length === 9 && typeof plotEls[0].click === 'function', '田块是可点击元素');
plotEls[0].click();
eq(getEl('st-seeds').textContent, 2, '播种后种子从 3 减到 2');
// 播种会触发 renderFarm()，整个网格被重建 —— 必须重新取元素，不能复用旧引用
const plotElsAfter = getEl('farmgrid').children;
eq(plotElsAfter.length, 9, '重渲染后仍是 9 块田（没有累积）', plotElsAfter.length);
ok(plotElsAfter[0].className.indexOf('growing') >= 0, '播种后该田进入 growing 样式',
   plotElsAfter[0].className);
eq(getEl('farmgrid').children.filter(c => c.className.indexOf('growing') >= 0).length, 1,
   '只有一块田进入生长状态');

// ---------------------------------------------------------------- 开局
section('4. 点「下地」进入战斗');
getEl('btn-start').click();
ok(getEl('hud').classList.contains('on'), 'HUD 显示');
ok(!getEl('scr-farm').classList.contains('on'), '农庄界面隐藏');

let frameCb = rafQueue[rafQueue.length - 1];
let ts = 0;
let drawError = null;
try {
  for (let i = 0; i < 20; i++) { ts += 16.7; frameCb(ts); }
} catch (e) { drawError = e; }
ok(!drawError, '渲染 20 帧不抛异常', drawError && drawError.message);

const getState = sandbox.__captured;
ok(!!getState(), '通过渲染调用拿到了页面内部 state');
const st0 = getState();
eq(st0.phase, 'run', '页面已进入 run 阶段');

// ---------------------------------------------------------------- 输入
section('5. 键盘输入真的驱动了移动');
const x0 = st0.run.player.x;
const downHandlers = winHandlers.keydown || [];
ok(downHandlers.length > 0, '注册了 keydown 监听');
downHandlers.forEach(fn => fn({ code: 'KeyD', preventDefault() {} }));
frameCb = rafQueue[rafQueue.length - 1];
for (let i = 0; i < 40; i++) { ts += 16.7; frameCb(ts); }
const x1 = getState().run.player.x;
ok(x1 > x0 + 5, '按住 D 后玩家向右移动', `${x0.toFixed(1)} -> ${x1.toFixed(1)}`);

// 深度轴：按 S 应当让 z 变大
const z0 = getState().run.player.z;
(winHandlers.keydown || []).forEach(fn => fn({ code: 'KeyS', preventDefault() {} }));
for (let i = 0; i < 30; i++) { ts += 16.7; frameCb(ts); }
const z1 = getState().run.player.z;
ok(z1 > z0 + 2, '按住 S 后玩家沿景深向后走（W/S 轴有效）', `${z0.toFixed(1)} -> ${z1.toFixed(1)}`);

// 松开按键
(winHandlers.keyup || []).forEach(fn => fn({ code: 'KeyD', preventDefault() {} }));
(winHandlers.keyup || []).forEach(fn => fn({ code: 'KeyS', preventDefault() {} }));

// ---------------------------------------------------------------- 敌人
section('6. 敌人会刷新且 HUD 在更新');
let sawEnemy = false;
for (let i = 0; i < 240; i++) {
  ts += 16.7; frameCb(ts);
  const s = getState();
  if (s && s.run && s.run.enemies.length > 0) sawEnemy = true;
  if (s && s.phase !== 'run') break;
}
ok(sawEnemy, '战斗中有敌人被刷出');
ok(getEl('wave-label').textContent.indexOf('波') >= 0, 'HUD 波次标签有内容',
   getEl('wave-label').textContent);
ok(/\d/.test(getEl('hp-num').textContent), 'HUD 显示生命数值',
   getEl('hp-num').textContent);

// ---------------------------------------------------------------- 存档
section('7. 存档写入 localStorage');
ok(store.size > 0, '有存档写入');
const saved = JSON.parse(store.get('emberfield_save_v2') || '{}');
eq(saved.version, 2, '存档版本正确');
ok(saved.meta && typeof saved.meta.coins === 'number', '存档里含 meta.coins');

// ---------------------------------------------------------------- 结算
section('8. 对局结束会切换到结果界面');
// 把玩家血量打到 0，逼一次失败结算
const stNow = getState();
if (stNow && stNow.run) {
  stNow.run.player.hp = 1;
  stNow.run.enemies.length = 0;
  // 手动塞一个贴脸的敌人
  const e = sandbox.GameLogic.makeEnemy(stNow, 'crawler', stNow.run.diff);
  e.x = stNow.run.player.x; e.z = stNow.run.player.z; e.damage = 999;
  stNow.run.enemies.push(e);
  frameCb = rafQueue[rafQueue.length - 1];
  for (let i = 0; i < 60; i++) { ts += 16.7; frameCb(ts); if (getState() === null) break; }
  ok(getEl('scr-result').classList.contains('on'), '结果界面显示');
  ok(getEl('rs-title').textContent.length > 0, '结果标题有文案',
     getEl('rs-title').textContent);
  ok(getEl('rs-delta').innerHTML.indexOf('难度') >= 0, '结果里列出了难度与战利品');
}

// ---------------------------------------------------------------- 坐标映射
section('9. 2.5D 坐标映射（深度不能搞反、不能画到屏幕外）');
{
  const R = sandbox.GameRender, C = sandbox.GameConfig;
  const near = R.toScreen(480, 0, 0);            // 最近处、贴地
  const far = R.toScreen(480, C.FIELD_D, 0);     // 最远处、贴地
  const jump = R.toScreen(480, 0, 120);          // 跳起来

  ok(far.sy < near.sy, '远的比近的画得更高（深度方向没有搞反）',
     `near.sy=${near.sy} far.sy=${far.sy}`);
  ok(far.scale < near.scale, '远的比近的更小（近大远小成立）',
     `near=${near.scale.toFixed(2)} far=${far.scale.toFixed(2)}`);
  ok(jump.sy < near.sy, '跳起来会画得更高', `ground=${near.sy} air=${jump.sy}`);

  // 场上任意位置都必须落在画布内（960x600）
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let x = 0; x <= C.FIELD_W; x += 40) {
    for (let z = 0; z <= C.FIELD_D; z += 30) {
      const s = R.toScreen(x, z, 0);
      minX = Math.min(minX, s.sx); maxX = Math.max(maxX, s.sx);
      minY = Math.min(minY, s.sy); maxY = Math.max(maxY, s.sy);
    }
  }
  ok(minX >= 0 && maxX <= 960, '水平方向都在画布内', `${minX}..${maxX}`);
  ok(minY >= 0 && maxY <= 600, '竖直方向都在画布内', `${minY}..${maxY}`);
  // 小怪抬到最高处（血条在 sy-48*scale）也不能跑到画布顶部之外
  ok(minY - 60 >= 0, '最远处目标连同血条/头顶仍在画布内', minY - 60);
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
