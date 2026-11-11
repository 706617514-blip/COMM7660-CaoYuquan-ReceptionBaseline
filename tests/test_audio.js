/**
 * test_audio.js — 自建 AudioContext 音效层的测试。
 *
 * 为什么要单独一层，而不是借 Phaser 的声音
 * ----------------------------------------
 * boot() 里显式写了 audio: { noAudio: true }（见 game/app.js）。
 * 于是 Phaser 用的是 NoAudioSoundManager：play() 恒返回 false，**没有 .context**。
 * 这个决定是对的（Phaser 的音频解码在 Canvas/无音频环境下会给玩家留一堆死音轨），
 * 但它意味着音效必须自己 new AudioContext()。
 *
 * 这条测试要守住的不是"函数被调用过"，而是那些**如果坏了玩家立刻听得出**的事实：
 *   - play() 真的向 AudioContext 建了振荡器/增益节点（空函数也能"不抛错"）
 *   - 用的是我们自建的 ctx，不是 Phaser 的 game.sound.context
 *   - 自动播放策略：首次用户手势里调过 resume()
 *   - 同音效 25ms 内重复触发被合并（连段攻击同帧三下，不合并就是爆音）
 *   - 静音是 masterGain.gain = 0，**不许** ctx.close()（关掉就再也开不回来了）
 *   - 音量/静音读写 meta.settings，跨会话保留
 *
 * stub 说明：Node 里没有 WebAudio。stub 只桩 play() 真正用到的 API。
 * 实现里若新增 createXxx / AudioParam 方法，必须在这里补同名方法，
 * 否则会抛 TypeError: ... is not a function —— 那是 stub 不全，不是音效坏了。
 * 提交前用 `grep -o 'create[A-Za-z]*' game/audio.js | sort -u` 对一遍。
 *
 * 用法: node tests/test_audio.js
 */
'use strict';

const path = require('path');

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

// 段落包一层：段内抛异常（例如 API 还没实现）记一次失败并继续，
// 不让整个套件崩掉把后面的断言全藏起来。
function group(label, fn) {
  try { fn(); }
  catch (e) { ok(false, label + '（段落抛异常）', e.message); }
}

// ---------------------------------------------------------------- WebAudio stub

// AudioParam：记录每一次自动化事件，value 跟着走。
function makeParam(initial) {
  return {
    value: initial === undefined ? 0 : initial,
    events: [],
    setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, c) { this.value = v; this.events.push(['target', v, t, c]); return this; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; },
  };
}

const contexts = [];

function StubAudioContext() {
  this.state = 'running';
  this.currentTime = 0;
  this.sampleRate = 44100;
  this.destination = { connect() {}, disconnect() {} };
  // 每一次 create* 都进这张表：数量为 0 就说明 play() 是空函数。
  this.created = [];
  this.resumed = false;
  this.resumeCount = 0;
  this.closed = false;
  contexts.push(this);
}

StubAudioContext.prototype.resume = function () {
  this.resumed = true;
  this.resumeCount += 1;
  if (this.state === 'suspended') this.state = 'running';
  return { then(fn) { return fn && fn(); }, catch() { return this; } };
};
StubAudioContext.prototype.close = function () { this.closed = true; this.state = 'closed'; };

StubAudioContext.prototype.createGain = function () {
  const g = {
    __kind: 'gain', gain: makeParam(1),
    connectedTo: null,
    connect(node) { this.connectedTo = node; return node; },
    disconnect() {},
  };
  this.created.push(g);
  return g;
};
StubAudioContext.prototype.createOscillator = function () {
  const o = {
    __kind: 'osc', type: 'sine', frequency: makeParam(440), detune: makeParam(0),
    started: false, stopped: false, startAt: null, stopAt: null,
    connect(node) { return node; }, disconnect() {},
    start(t) { this.started = true; this.startAt = t; },
    stop(t) { this.stopped = true; this.stopAt = t; },
    onended: null,
  };
  this.created.push(o);
  return o;
};
StubAudioContext.prototype.createBufferSource = function () {
  const s = {
    __kind: 'src', buffer: null, loop: false,
    started: false, stopped: false, startAt: null, stopAt: null,
    connect(node) { return node; }, disconnect() {},
    start(t) { this.started = true; this.startAt = t; },
    stop(t) { this.stopped = true; this.stopAt = t; },
    onended: null,
  };
  this.created.push(s);
  return s;
};
StubAudioContext.prototype.createBuffer = function (channels, length, rate) {
  const data = new Float32Array(length);
  return {
    __kind: 'buffer', numberOfChannels: channels, length, sampleRate: rate,
    getChannelData() { return data; },
  };
};
StubAudioContext.prototype.createBiquadFilter = function () {
  const f = {
    __kind: 'filter', type: 'lowpass', frequency: makeParam(350), Q: makeParam(1),
    gain: makeParam(0), connectedTo: null,
    connect(node) { this.connectedTo = node; return node; }, disconnect() {},
  };
  this.created.push(f);
  return f;
};
StubAudioContext.prototype.createDynamicsCompressor = function () {
  const c = {
    __kind: 'comp',
    threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12),
    attack: makeParam(0.003), release: makeParam(0.25),
    connect(node) { return node; }, disconnect() {},
  };
  this.created.push(c);
  return c;
};

// 浏览器里 window === global。测试里给 global 补一个 addEventListener，
// 模拟"audio.js 在加载时注册首次手势监听"，并让测试能手动触发那一次手势。
const gestures = [];
global.addEventListener = function (type, fn) { gestures.push({ type: type, fn: fn }); };

global.AudioContext = StubAudioContext;
// 有的实现会查 webkit 前缀；桩上，避免加载时报错。
global.webkitAudioContext = StubAudioContext;

const C = require(path.join(__dirname, '..', 'game', 'config.js'));

let A = null;
let loadErr = null;
try {
  A = require(path.join(__dirname, '..', 'game', 'audio.js'));
} catch (e) { loadErr = e; }

// 让 currentTime 往前走。stub 的时钟不会自己走，节流断言必须手动推进。
function tick(seconds) {
  contexts.forEach((c) => { c.currentTime += seconds; });
}
function nodeCount() { return A && A.context ? A.context.created.length : 0; }
function gains() { return A.context.created.filter((n) => n.__kind === 'gain'); }
function masterGains() {
  return gains().filter((n) => n.connectedTo === A.context.destination);
}

// ---------------------------------------------------------------- 1. 模块与配置
section('1. 模块加载与 17 个音效的配置表');
ok(loadErr === null, 'game/audio.js 能被加载', loadErr && loadErr.message);
if (!A) {
  console.log('\n' + '='.repeat(56));
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}

const NAMES = ['slash', 'hit', 'crit', 'hurt', 'coin', 'seed', 'dropNew', 'dropDup',
  'potion', 'skill', 'special', 'upgrade', 'sell', 'bagOpen', 'wave', 'boss', 'death'];

group('17 个音效名', function () {
  const sfx = C.AUDIO && C.AUDIO.sfx;
  ok(!!sfx, 'config.js 里有 AUDIO.sfx 表');
  const keys = Object.keys(sfx || {});
  eq(keys.length, 17, 'AUDIO.sfx 恰好 17 个音效');
  const missing = NAMES.filter((n) => !sfx[n]);
  ok(missing.length === 0, '17 个名字一个不少', JSON.stringify(missing));
  const extra = keys.filter((k) => NAMES.indexOf(k) < 0);
  ok(extra.length === 0, '没有多出来的孤儿音效（避免"配了没人播"）', JSON.stringify(extra));
});

group('每个音效都有可听的合成参数', function () {
  const sfx = C.AUDIO.sfx;
  const bad = [];
  NAMES.forEach(function (n) {
    const s = sfx[n] || {};
    const voices = s.voices;
    if (!Array.isArray(voices) || voices.length === 0) { bad.push(n + ': 没有 voices'); return; }
    voices.forEach(function (v) {
      if (typeof v.wave !== 'string') bad.push(n + ': wave 不是字符串');
      if (!(v.dur > 0 && v.dur <= 1.5)) bad.push(n + ': dur=' + v.dur + '（应为 (0, 1.5]）');
      if (!(v.gain > 0 && v.gain <= 1)) bad.push(n + ': gain=' + v.gain + '（应为 (0, 1]）');
      // 噪声声部靠滤波器成形，没有 f0 时必须有 filter，否则只是"白噪声全带"
      if (v.wave === 'noise' && !v.filter) bad.push(n + ': 噪声声部没有 filter');
    });
  });
  ok(bad.length === 0, '每个声部的波形/时长/增益都合法', JSON.stringify(bad));
});

group('节流与总音量是配置而非魔数', function () {
  eq(C.AUDIO.throttle, 0.025, '节流 25ms 写在 config（不是散在代码里）');
  ok(C.AUDIO.volume > 0 && C.AUDIO.volume <= 1, '默认总音量在 (0, 1]', C.AUDIO.volume);
});

// ---------------------------------------------------------------- 2. 惰性创建
section('2. 加载时不建 AudioContext（Node 里没有 WebAudio 也不能炸）');
eq(contexts.length, 0, '模块加载时没有构造 AudioContext（惰性，等用户手势）');
ok(gestures.length > 0, '加载时注册了首次手势监听（自动播放策略）',
   gestures.map((g) => g.type).join(','));

// ---------------------------------------------------------------- 3. 17 个音效真的发声
section('3. 17 个音效都真的建了音频节点');
const before = nodeCount();
NAMES.forEach(function (n) {
  const n0 = nodeCount();
  let threw = null;
  let ret = null;
  try { ret = A.play(n); } catch (e) { threw = e.message; }
  ok(threw === null, n + ' 可播放且不抛错' + (threw ? '（抛了：' + threw + '）' : ''));
  ok(ret === true, n + ' 的 play() 返回 true（真的播了，不是被吞掉）', ret);
  ok(nodeCount() > n0, n + ' 至少建了一个音频节点（play 不是空函数）',
     nodeCount() - n0);
});
ok(A.context && A.context.created && A.context.created.length > 0,
   '真的向 AudioContext 里建了音频节点（play 不是空函数）', before);
ok(A.context instanceof StubAudioContext, '用的是自建的 AudioContext，不是 Phaser 的 game.sound');
eq(contexts.length, 1, '单例：17 个音效共用同一个 context（不是每次播放新建）');
eq(A.context.created.filter((n) => n.__kind === 'osc' || n.__kind === 'src').length > 0, true,
   '建了振荡器/噪声源（不是只建了个 gain 摆样子）');

// ctx.state === 'running' 这条本身证明不了实现（stub 一开始就是 running），
// 断言留到浏览器侧（smoke）去测真实状态；这里只断言我们没把它关掉。
ok(A.context.closed !== true && A.context.state !== 'closed', '播放后 context 没有被 close');

// 每个音效都必须真的被 stop()：用完即弃，不预建常驻音轨。
group('节点用完即弃', function () {
  const sources = A.context.created.filter((n) => n.__kind === 'osc' || n.__kind === 'src');
  const notStopped = sources.filter((n) => !n.stopped);
  ok(notStopped.length === 0, '每个音源都安排了 stop()（不会永久占用音轨）',
     notStopped.length);
  const noStart = sources.filter((n) => !n.started);
  ok(noStart.length === 0, '每个音源都 start() 过', noStart.length);
});

// ---------------------------------------------------------------- 4. 手势启动
section('4. 自动播放策略：首个用户手势里 resume()');
group('手势', function () {
  eq(A.context.resumeCount, 0, '加载与播放阶段没有擅自 resume（首次手势之前）');
  gestures.forEach((g) => { try { g.fn({ type: g.type }); } catch (e) { ok(false, '手势回调抛异常', e.message); } });
  ok(A.resumed === true || A.context.resumed === true,
     'ensureStarted() 调过 resume()（自动播放策略要求在用户手势里启动）');
  ok(gestures.filter((g) => g.type === 'pointerdown' || g.type === 'keydown').length > 0,
     '监听的正是 pointerdown / keydown 这类真实手势',
     gestures.map((g) => g.type).join(','));
});

// ---------------------------------------------------------------- 5. 节流
section('5. 同音效 25ms 节流（连段同帧三下不爆音）');
group('节流', function () {
  tick(0.2);                       // 先让时钟离开上一次播放的时刻
  const n1 = nodeCount();
  eq(A.play('coin'), true, 'clock 走开后第一声可以播');
  const oneShot = nodeCount() - n1;
  ok(oneShot > 0, '第一声建了节点', oneShot);

  const n2 = nodeCount();
  eq(A.play('coin'), false, '同一帧（0ms 后）再来一次被节流');
  eq(A.play('coin'), false, '第三下同样被节流');
  eq(nodeCount(), n2, '被节流时不建任何节点（不是"静音播放"）');

  const n3 = nodeCount();
  eq(A.play('seed'), true, '别的音效不受这一条影响（节流按名字分开）');
  ok(nodeCount() > n3, '别的音效照常建节点', nodeCount() - n3);

  tick(C.AUDIO.throttle + 0.001);
  const n4 = nodeCount();
  eq(A.play('coin'), true, '超过 25ms 之后同一个音效可以再播');
  ok(nodeCount() > n4, '重新建了节点', nodeCount() - n4);
});

// ---------------------------------------------------------------- 6. 音量与静音
section('6. 音量与静音（静音 = masterGain.gain = 0，不 close）');
group('音量', function () {
  const masters = masterGains();
  eq(masters.length, 1, '恰好一个 masterGain 接在 destination 上');
  const master = masters[0];
  ok(master.gain.value > 0, '默认总音量不是 0', master.gain.value);
  // 外面只能靠这个句柄证明"静音真的是把增益压到 0"，
  // 所以它必须是同一个节点，而不是另建一个谁也没接上的。
  eq(A.masterGain, master, 'A.masterGain 就是接在 destination 上的那个节点');

  A.setMasterVolume(0);
  eq(master.gain.value, 0, 'setMasterVolume(0) 让 masterGain.gain 真的归零');
  ok(A.context.closed !== true, '静音没有 close 掉 context（关了就读不回来了）');
  eq(A.context.state === 'closed', false, '静音后 context 仍是活的', A.context.state);

  // 静音状态下仍然允许"播"（只是听不到），否则节流/状态会变得不可预测；
  // 关键断言是：不许因为静音就跳过建节点，也不许任何操作 close。
  tick(0.2);
  ok(A.play('hit') === true, '静音时 play 仍然返回 true（音量由 masterGain 统一压掉）');

  A.setMasterVolume(0.5);
  eq(master.gain.value, 0.5, 'setMasterVolume(0.5) 恢复');

  A.setMuted(true);
  eq(A.isMuted(), true, 'isMuted() 反映静音状态');
  eq(master.gain.value, 0, 'setMuted(true) 同样把 masterGain 压到 0');
  A.setMuted(false);
  eq(A.isMuted(), false, 'setMuted(false) 解除静音');
  eq(master.gain.value, 0.5, '解除静音后回到静音前的音量（不是回到 1）');

  // 越界值必须被夹住：滑块或旧存档都可能给出 3 或 -1
  A.setMasterVolume(3);
  eq(master.gain.value, 1, '音量上限夹到 1');
  A.setMasterVolume(-1);
  eq(master.gain.value, 0, '音量下限夹到 0');
  A.setMasterVolume(0.5);
});

// ---------------------------------------------------------------- 7. 存档
section('7. 音量/静音存进 meta.settings（跨会话保留）');
group('持久化', function () {
  const st = { meta: { settings: { volume: 0.8, muted: false } } };
  A.syncSettings(st);
  eq(masterGains()[0].gain.value, 0.8, 'syncSettings 读到存档里的音量');

  A.setMasterVolume(0.4);
  eq(st.meta.settings.volume, 0.4, '调音量会写回 meta.settings.volume');

  A.setMuted(true);
  eq(st.meta.settings.muted, true, '静音会写回 meta.settings.muted');
  eq(masterGains()[0].gain.value, 0, '写回的同时当场生效');
  A.setMuted(false);

  // 旧存档可能没有 settings：要补默认值，而不是崩在 undefined.volume 上
  const old = { meta: {} };
  A.syncSettings(old);
  ok(old.meta.settings && typeof old.meta.settings.volume === 'number',
     '没有 settings 的旧存档补上默认值', JSON.stringify(old.meta.settings));
  eq(old.meta.settings.volume, C.AUDIO.volume, '补的默认音量来自 config');
});

// ---------------------------------------------------------------- 8. 未知名字
section('8. 未知音效名不炸、也不响');
group('未知名字', function () {
  tick(0.2);
  const n = nodeCount();
  let threw = null; let ret = null;
  try { ret = A.play('no_such_sfx'); } catch (e) { threw = e.message; }
  ok(threw === null, 'play(未知名) 不抛异常', threw);
  eq(ret, false, '返回 false 表示没播');
  eq(nodeCount(), n, '不建任何节点');
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
